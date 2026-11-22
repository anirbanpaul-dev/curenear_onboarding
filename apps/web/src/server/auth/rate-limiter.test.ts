import { describe, expect, it } from 'vitest';
import { createInMemoryRateLimiter } from './rate-limiter';

const start = new Date('2026-01-15T10:00:00.000Z');
const at = (offsetMs: number) => new Date(start.getTime() + offsetMs);
const options = (now: Date) => ({ limit: 3, windowMs: 60_000, now });

describe('in-memory fixed-window rate limiter', () => {
  it('allows exactly the limit, then blocks with a retry hint', async () => {
    const limiter = createInMemoryRateLimiter();

    const first = await limiter.consume('login:1.2.3.4', options(start));
    const second = await limiter.consume('login:1.2.3.4', options(at(1_000)));
    const third = await limiter.consume('login:1.2.3.4', options(at(2_000)));
    const fourth = await limiter.consume('login:1.2.3.4', options(at(3_000)));

    expect([first.allowed, second.allowed, third.allowed]).toEqual([true, true, true]);
    expect([first.remaining, second.remaining, third.remaining]).toEqual([2, 1, 0]);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfterSeconds).toBe(57);
  });

  it('never reports a retry delay below one second', async () => {
    const limiter = createInMemoryRateLimiter();
    await limiter.consume('k', options(start));
    await limiter.consume('k', options(start));
    await limiter.consume('k', options(start));

    const blocked = await limiter.consume('k', options(at(59_500)));
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1);
  });

  it('starts a fresh window once the old one has elapsed', async () => {
    const limiter = createInMemoryRateLimiter();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await limiter.consume('k', options(start))).allowed).toBe(true);
    }
    expect((await limiter.consume('k', options(start))).allowed).toBe(false);

    const justBefore = await limiter.consume('k', options(at(59_999)));
    expect(justBefore.allowed).toBe(false);

    const afterReset = await limiter.consume('k', options(at(60_000)));
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(2);
    expect(afterReset.retryAfterSeconds).toBe(60);
  });

  it('keeps a separate budget per key', async () => {
    const limiter = createInMemoryRateLimiter();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await limiter.consume('login:1.2.3.4', options(start));
    }

    expect((await limiter.consume('login:1.2.3.4', options(start))).allowed).toBe(false);
    expect((await limiter.consume('login:5.6.7.8', options(start))).allowed).toBe(true);
    expect((await limiter.consume('password-reset:1.2.3.4', options(start))).allowed).toBe(true);
  });

  it('forgets every counter on reset', async () => {
    const limiter = createInMemoryRateLimiter();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await limiter.consume('k', options(start));
    }

    limiter.reset();

    const afterReset = await limiter.consume('k', options(start));
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(2);
  });
});
