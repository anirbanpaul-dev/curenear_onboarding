import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createPrismaClient,
  generateResetToken,
  hashPassword,
  hashResetToken,
  hashSessionToken,
} from '@curenear/db';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as logoutRoute } from '@/app/api/auth/logout/route';
import { POST as changePasswordRoute } from '@/app/api/auth/change-password/route';
import { POST as forgotPasswordRoute } from '@/app/api/auth/forgot-password/route';
import { POST as resetPasswordRoute } from '@/app/api/auth/reset-password/route';
import { GET as providersRoute } from '@/app/api/v1/providers/route';
import { getServices } from '@/server/services';
import {
  LOCKOUT_THRESHOLD,
  RESET_TOKEN_TTL_MS,
  SESSION_TTL_MS,
} from '@/server/services/auth-service';

/**
 * Real PostgreSQL, real route handlers. Every test uses its own email and client
 * IP so lockout and IP rate limits cannot leak between cases.
 */
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

const PASSWORD = 'integration-password-123';
const COOKIE = process.env.SESSION_COOKIE_NAME ?? 'curenear_session';

let ipSeed = 0;
function nextIp(): string {
  ipSeed += 1;
  return `10.20.${Math.floor(ipSeed / 250)}.${(ipSeed % 250) + 1}`;
}

function jsonRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function sessionCookie(response: Response): string {
  const header = response.headers.get('set-cookie') ?? '';
  const match = new RegExp(`${COOKIE}=([^;]+)`).exec(header);
  if (!match?.[1]) throw new Error(`no session cookie in: ${header}`);
  return `${COOKIE}=${match[1]}`;
}

function tokenFromCookie(cookie: string): string {
  return cookie.split('=').slice(1).join('=');
}

describeDb('authentication (real PostgreSQL)', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  const createdUserIds: string[] = [];

  beforeAll(() => {
    prisma = createPrismaClient(databaseUrl as string);
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: createdUserIds } } });
    // The accounts stay: audit_logs references them and the trail is append-only,
    // so deleting a user (which would NULL the audit actor) is rejected. Emails
    // are unique per run, so nothing leaks between runs.
    await prisma.$disconnect();
  });

  async function createUser(
    options: { mustChangePassword?: boolean; password?: string } = {},
  ): Promise<{ id: string; email: string; password: string }> {
    const email = `auth-${randomUUID()}@curenear.test`;
    const password = options.password ?? PASSWORD;
    const user = await prisma.user.create({
      data: {
        email,
        name: 'Auth Test',
        passwordHash: await hashPassword(password),
        role: 'ADMIN',
        status: 'ACTIVE',
        mustChangePassword: options.mustChangePassword ?? false,
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    return { id: user.id, email, password };
  }

  it('signs in, stores only the token hash and sets a hardened cookie', async () => {
    const user = await createUser();
    const response = await loginRoute(
      jsonRequest(
        '/api/auth/login',
        { email: user.email, password: PASSWORD },
        {
          'x-forwarded-for': nextIp(),
        },
      ),
    );

    expect(response.status).toBe(200);
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=lax/i);

    const body = (await response.json()) as {
      data: { user: { id: string }; mustChangePassword: boolean; redirectTo: string };
    };
    expect(body.data.user.id).toBe(user.id);
    expect(body.data.mustChangePassword).toBe(false);
    expect(body.data.redirectTo).toBe('/admin');

    const token = tokenFromCookie(sessionCookie(response));
    const session = await prisma.session.findFirst({ where: { userId: user.id } });
    expect(session?.tokenHash).toBe(hashSessionToken(token));
    expect(session?.tokenHash).not.toBe(token);
    expect(session?.revokedAt).toBeNull();

    const audit = await prisma.auditLog.count({
      where: { entityId: user.id, action: 'auth.login.succeeded' },
    });
    expect(audit).toBe(1);
  });

  it('answers unknown emails and wrong passwords identically', async () => {
    const user = await createUser();

    const unknown = await loginRoute(
      jsonRequest(
        '/api/auth/login',
        { email: `nobody-${randomUUID()}@curenear.test`, password: PASSWORD },
        {
          'x-forwarded-for': nextIp(),
        },
      ),
    );
    const wrong = await loginRoute(
      jsonRequest(
        '/api/auth/login',
        { email: user.email, password: 'definitely-wrong-123' },
        {
          'x-forwarded-for': nextIp(),
        },
      ),
    );

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    const unknownBody = (await unknown.json()) as { error: { code: string; message: string } };
    const wrongBody = (await wrong.json()) as { error: { code: string; message: string } };
    expect(unknownBody.error.message).toBe(wrongBody.error.message);
    expect(unknownBody.error.code).toBe('UNAUTHENTICATED');
    expect(wrongBody.error.code).toBe('UNAUTHENTICATED');
  });

  it('locks the account for 15 minutes after five failures and audits it', async () => {
    const user = await createUser();
    const ip = nextIp();

    for (let attempt = 0; attempt < LOCKOUT_THRESHOLD; attempt += 1) {
      const response = await loginRoute(
        jsonRequest(
          '/api/auth/login',
          { email: user.email, password: 'wrong-password-123' },
          {
            'x-forwarded-for': ip,
          },
        ),
      );
      expect(response.status).toBe(401);
    }

    const locked = await prisma.user.findUnique({
      where: { id: user.id },
      select: { status: true, failedLoginCount: true, lockedUntil: true },
    });
    expect(locked?.status).toBe('LOCKED');
    expect(locked?.failedLoginCount).toBe(LOCKOUT_THRESHOLD);
    expect(locked?.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    expect(locked?.lockedUntil?.getTime()).toBeLessThanOrEqual(Date.now() + 16 * 60 * 1000);

    // The correct password is still refused while the lock is on.
    const correct = await loginRoute(
      jsonRequest(
        '/api/auth/login',
        { email: user.email, password: PASSWORD },
        {
          'x-forwarded-for': nextIp(),
        },
      ),
    );
    expect(correct.status).toBe(401);

    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    expect(
      await prisma.auditLog.count({ where: { entityId: user.id, action: 'auth.login.failed' } }),
    ).toBeGreaterThanOrEqual(LOCKOUT_THRESHOLD);
    expect(
      await prisma.auditLog.count({ where: { entityId: user.id, action: 'auth.login.locked' } }),
    ).toBeGreaterThanOrEqual(1);
  });

  it('extends a live session but refuses an expired one', async () => {
    const user = await createUser();
    const token = `expiry-${randomUUID()}`;
    const tokenHash = hashSessionToken(token);

    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    const resolved = await getServices().auth.resolveSession(token);
    expect(resolved?.userId).toBe(user.id);
    const slid = await prisma.session.findUnique({ where: { tokenHash } });
    expect(slid?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 7 * 60 * 60 * 1000);
    expect(slid?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + SESSION_TTL_MS + 5_000);

    const expiredToken = `expired-${randomUUID()}`;
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(expiredToken),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    expect(await getServices().auth.resolveSession(expiredToken)).toBeNull();
  });

  it('revokes the session on logout and keeps the row', async () => {
    const user = await createUser();
    const login = await loginRoute(
      jsonRequest(
        '/api/auth/login',
        { email: user.email, password: PASSWORD },
        {
          'x-forwarded-for': nextIp(),
        },
      ),
    );
    const cookie = sessionCookie(login);
    const token = tokenFromCookie(cookie);
    expect(await getServices().auth.resolveSession(token)).not.toBeNull();

    const logout = await logoutRoute(
      new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
        headers: { cookie, 'x-forwarded-for': nextIp() },
      }),
    );
    expect(logout.status).toBe(200);

    expect(await getServices().auth.resolveSession(token)).toBeNull();
    const row = await prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
    });
    expect(row).not.toBeNull();
    expect(row?.revokedAt).toBeInstanceOf(Date);
  });

  it('blocks other routes until a temporary password is replaced', async () => {
    const user = await createUser({ mustChangePassword: true });
    const login = await loginRoute(
      jsonRequest(
        '/api/auth/login',
        { email: user.email, password: PASSWORD },
        {
          'x-forwarded-for': nextIp(),
        },
      ),
    );
    const loginBody = (await login.json()) as {
      data: { mustChangePassword: boolean; redirectTo: string };
    };
    expect(loginBody.data.mustChangePassword).toBe(true);
    expect(loginBody.data.redirectTo).toBe('/change-password');

    const cookie = sessionCookie(login);
    const blocked = await providersRoute(
      new NextRequest('http://localhost/api/v1/providers', {
        headers: { cookie, 'x-forwarded-for': nextIp() },
      }),
    );
    expect(blocked.status).toBe(403);
    const blockedBody = (await blocked.json()) as { error: { code: string } };
    expect(blockedBody.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await changePasswordRoute(
      jsonRequest(
        '/api/auth/change-password',
        {
          currentPassword: PASSWORD,
          newPassword: 'brand-new-password-987',
        },
        { cookie, 'x-forwarded-for': nextIp() },
      ),
    );
    expect(changed.status).toBe(200);
    const changedCookie = sessionCookie(changed);

    // The pre-change session is gone; the replacement works and the flag is off.
    expect(await getServices().auth.resolveSession(tokenFromCookie(cookie))).toBeNull();
    const allowed = await providersRoute(
      new NextRequest('http://localhost/api/v1/providers', {
        headers: { cookie: changedCookie, 'x-forwarded-for': nextIp() },
      }),
    );
    expect(allowed.status).toBe(200);

    const stored = await prisma.user.findUnique({
      where: { id: user.id },
      select: { mustChangePassword: true },
    });
    expect(stored?.mustChangePassword).toBe(false);
  });

  it('rejects a weak replacement password', async () => {
    const user = await createUser();
    const login = await loginRoute(
      jsonRequest(
        '/api/auth/login',
        { email: user.email, password: PASSWORD },
        {
          'x-forwarded-for': nextIp(),
        },
      ),
    );

    const weak = await changePasswordRoute(
      jsonRequest(
        '/api/auth/change-password',
        {
          currentPassword: PASSWORD,
          newPassword: 'short',
        },
        { cookie: sessionCookie(login), 'x-forwarded-for': nextIp() },
      ),
    );
    expect(weak.status).toBe(422);
    const body = (await weak.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('answers password-reset requests identically and only mints tokens for real accounts', async () => {
    const user = await createUser();

    const known = await forgotPasswordRoute(
      jsonRequest(
        '/api/auth/forgot-password',
        { email: user.email },
        {
          'x-forwarded-for': nextIp(),
        },
      ),
    );
    const unknownEmail = `missing-${randomUUID()}@curenear.test`;
    const unknown = await forgotPasswordRoute(
      jsonRequest(
        '/api/auth/forgot-password',
        { email: unknownEmail },
        {
          'x-forwarded-for': nextIp(),
        },
      ),
    );

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    const knownBody = (await known.json()) as { data: { message: string } };
    const unknownBody = (await unknown.json()) as { data: { message: string } };
    expect(unknownBody.data.message).toBe(knownBody.data.message);

    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(1);
    expect(
      await prisma.passwordResetToken.count({ where: { user: { email: unknownEmail } } }),
    ).toBe(0);
  });

  it('resets the password once, revokes sessions and rejects a reused token', async () => {
    const user = await createUser({ mustChangePassword: true });
    const login = await loginRoute(
      jsonRequest(
        '/api/auth/login',
        { email: user.email, password: PASSWORD },
        {
          'x-forwarded-for': nextIp(),
        },
      ),
    );
    const oldToken = tokenFromCookie(sessionCookie(login));

    const raw = generateResetToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(raw),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    const reset = await resetPasswordRoute(
      jsonRequest(
        '/api/auth/reset-password',
        { token: raw, password: 'reset-password-456' },
        {
          'x-forwarded-for': nextIp(),
        },
      ),
    );
    expect(reset.status).toBe(200);

    expect(await getServices().auth.resolveSession(oldToken)).toBeNull();
    const stored = await prisma.user.findUnique({
      where: { id: user.id },
      select: { mustChangePassword: true },
    });
    expect(stored?.mustChangePassword).toBe(false);

    const withNew = await loginRoute(
      jsonRequest(
        '/api/auth/login',
        { email: user.email, password: 'reset-password-456' },
        {
          'x-forwarded-for': nextIp(),
        },
      ),
    );
    expect(withNew.status).toBe(200);

    const reused = await resetPasswordRoute(
      jsonRequest(
        '/api/auth/reset-password',
        { token: raw, password: 'another-password-789' },
        {
          'x-forwarded-for': nextIp(),
        },
      ),
    );
    expect(reused.status).toBe(422);
  });

  it('refuses an expired reset token', async () => {
    const user = await createUser();
    const raw = generateResetToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(raw),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const response = await resetPasswordRoute(
      jsonRequest(
        '/api/auth/reset-password',
        { token: raw, password: 'expired-token-456' },
        {
          'x-forwarded-for': nextIp(),
        },
      ),
    );
    expect(response.status).toBe(422);
  });

  it('rejects a mutation coming from another origin', async () => {
    const user = await createUser();
    const response = await loginRoute(
      jsonRequest(
        '/api/auth/login',
        { email: user.email, password: PASSWORD },
        {
          origin: 'https://evil.example',
          'x-forwarded-for': nextIp(),
        },
      ),
    );

    expect(response.status).toBe(403);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });
});
