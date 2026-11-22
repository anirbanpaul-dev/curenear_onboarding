import { describe, expect, it } from 'vitest';
import { AppError } from '@curenear/shared';
import { hashPassword } from '@curenear/db';
import { createInMemoryRepositories, type InMemoryStore } from '@/test/in-memory';
import { createMemoryEmailService } from '@/server/email';
import { createInMemoryRateLimiter } from '@/server/auth/rate-limiter';
import { LOCKOUT_MS, LOCKOUT_THRESHOLD, RESET_RATE_LIMIT, createAuthService } from './auth-service';

const START = new Date('2026-01-15T10:00:00.000Z');
const PASSWORD = 'correct-horse-battery-1';
const WRONG = 'definitely-not-the-password';

const ctx = (ip: string = '203.0.113.9') => ({
  requestId: 'req-auth',
  ipAddress: ip,
  userAgent: 'vitest',
});

function setup() {
  const { repositories, store } = createInMemoryRepositories();
  const email = createMemoryEmailService();
  let clock = START;
  let counter = 0;

  const service = createAuthService({
    repositories,
    email,
    rateLimiter: createInMemoryRateLimiter(),
    appUrl: 'http://localhost:3000',
    now: () => clock,
    newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
  });

  return {
    service,
    store,
    email,
    now: () => clock,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

async function seedUser(store: InMemoryStore, password: string = PASSWORD): Promise<string> {
  const id = '11111111-1111-4111-8111-111111111111';
  store.users.push({
    id,
    email: 'doctor@curenear.in',
    name: 'Dr Test',
    role: 'ADMIN',
    isActive: true,
    status: 'ACTIVE',
    mustChangePassword: false,
    failedLoginCount: 0,
    lockedUntil: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    passwordHash: await hashPassword(password),
  });
  return id;
}

async function failTimes(
  service: ReturnType<typeof setup>['service'],
  times: number,
  ip?: string,
): Promise<void> {
  for (let attempt = 0; attempt < times; attempt += 1) {
    await expect(service.login('doctor@curenear.in', WRONG, ctx(ip))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  }
}

describe('auth service — lockout edges', () => {
  it('locks for 15 minutes after five failures and audits every step', async () => {
    const { service, store, now } = setup();
    const userId = await seedUser(store);

    await failTimes(service, LOCKOUT_THRESHOLD);

    const user = store.users.find((row) => row.id === userId);
    expect(user?.status).toBe('LOCKED');
    expect(user?.failedLoginCount).toBe(LOCKOUT_THRESHOLD);
    expect(user?.lockedUntil?.getTime()).toBe(now().getTime() + LOCKOUT_MS);

    expect(store.audits.filter((row) => row.action === 'auth.login.failed')).toHaveLength(5);
    expect(store.audits.filter((row) => row.action === 'auth.login.locked')).toHaveLength(1);

    // The lock wins even when the password is right.
    await expect(service.login('doctor@curenear.in', PASSWORD, ctx())).rejects.toBeInstanceOf(
      AppError,
    );
    expect(store.sessions).toHaveLength(0);
    expect(store.audits.at(-1)?.action).toBe('auth.login.locked');
  });

  it('lets the right password through once the lock expires and clears the counters', async () => {
    const { service, store, advance } = setup();
    const userId = await seedUser(store);

    await failTimes(service, LOCKOUT_THRESHOLD);

    advance(LOCKOUT_MS - 1);
    await expect(service.login('doctor@curenear.in', PASSWORD, ctx())).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(store.sessions).toHaveLength(0);

    advance(1); // exactly 15 minutes after the lock was set
    const result = await service.login('doctor@curenear.in', PASSWORD, ctx());

    expect(result.user.id).toBe(userId);
    expect(result.token).toHaveLength(43);
    expect(store.sessions).toHaveLength(1);

    const user = store.users.find((row) => row.id === userId);
    expect(user?.failedLoginCount).toBe(0);
    expect(user?.lockedUntil).toBeNull();
    expect(user?.status).toBe('ACTIVE');
    expect(store.audits.filter((row) => row.action === 'auth.login.succeeded')).toHaveLength(1);
  });

  it('resets failed_login_count when a sign-in succeeds below the threshold', async () => {
    const { service, store } = setup();
    const userId = await seedUser(store);

    await failTimes(service, LOCKOUT_THRESHOLD - 2);
    expect(store.users.find((row) => row.id === userId)?.failedLoginCount).toBe(3);
    expect(store.users.find((row) => row.id === userId)?.status).toBe('ACTIVE');

    const result = await service.login('doctor@curenear.in', PASSWORD, ctx());

    expect(result.mustChangePassword).toBe(false);
    const user = store.users.find((row) => row.id === userId);
    expect(user?.failedLoginCount).toBe(0);
    expect(user?.lockedUntil).toBeNull();
    expect(store.audits.filter((row) => row.action === 'auth.login.succeeded')).toHaveLength(1);
  });

  it('counts a failure after an expired lock from the old counter', async () => {
    const { service, store, advance, now } = setup();
    const userId = await seedUser(store);

    await failTimes(service, LOCKOUT_THRESHOLD);
    advance(LOCKOUT_MS + 1_000);

    await failTimes(service, 1);

    const user = store.users.find((row) => row.id === userId);
    expect(user?.failedLoginCount).toBe(LOCKOUT_THRESHOLD + 1);
    expect(user?.status).toBe('LOCKED');
    expect(user?.lockedUntil?.getTime()).toBe(now().getTime() + LOCKOUT_MS);
  });
});

describe('auth service — reset-request limiter', () => {
  it('mints at most ten reset links per IP per window, per address', async () => {
    const { service, store, email, advance } = setup();
    await seedUser(store);

    for (let attempt = 0; attempt < RESET_RATE_LIMIT.limit; attempt += 1) {
      await service.requestPasswordReset('doctor@curenear.in', ctx('198.51.100.7'));
    }
    expect(email.sent).toHaveLength(RESET_RATE_LIMIT.limit);
    // Only the newest link stays valid.
    expect(store.passwordResets.filter((row) => !row.usedAt)).toHaveLength(1);

    // The next request from the same IP is dropped silently: no mail, no token.
    await service.requestPasswordReset('doctor@curenear.in', ctx('198.51.100.7'));
    expect(email.sent).toHaveLength(RESET_RATE_LIMIT.limit);
    expect(store.passwordResets.filter((row) => !row.usedAt)).toHaveLength(1);

    // Another IP has its own budget.
    await service.requestPasswordReset('doctor@curenear.in', ctx('198.51.100.8'));
    expect(email.sent).toHaveLength(RESET_RATE_LIMIT.limit + 1);

    // A fresh window restores the first IP's budget.
    advance(RESET_RATE_LIMIT.windowMs);
    await service.requestPasswordReset('doctor@curenear.in', ctx('198.51.100.7'));
    expect(email.sent).toHaveLength(RESET_RATE_LIMIT.limit + 2);
  });

  it('gives the same silent answer to unknown addresses without spending a token', async () => {
    const { service, store, email } = setup();
    await seedUser(store);

    await service.requestPasswordReset('nobody@curenear.in', ctx('198.51.100.9'));

    expect(email.sent).toHaveLength(0);
    expect(store.passwordResets).toHaveLength(0);
  });
});
