/**
 * Rate limiting runs behind an interface so the in-memory counter can be replaced
 * by a Redis (or Postgres) implementation without touching call sites. The
 * in-memory version is per process: fine for a single node, not for a fleet.
 */

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  now: Date;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(key: string, options: RateLimitOptions): Promise<RateLimitResult>;
  reset(): void;
}

interface Window {
  count: number;
  resetAt: number;
}

export function createInMemoryRateLimiter(): RateLimiter {
  const windows = new Map<string, Window>();

  function sweep(nowMs: number): void {
    if (windows.size < 1_000) return;
    for (const [key, window] of windows) {
      if (window.resetAt <= nowMs) windows.delete(key);
    }
  }

  return {
    async consume(key, options) {
      const nowMs = options.now.getTime();
      sweep(nowMs);

      const existing = windows.get(key);
      const window =
        existing && existing.resetAt > nowMs
          ? existing
          : { count: 0, resetAt: nowMs + options.windowMs };

      window.count += 1;
      windows.set(key, window);

      const retryAfterSeconds = Math.max(1, Math.ceil((window.resetAt - nowMs) / 1000));
      return {
        allowed: window.count <= options.limit,
        remaining: Math.max(0, options.limit - window.count),
        retryAfterSeconds,
      };
    },

    reset() {
      windows.clear();
    },
  };
}

/** Used by tests and single-node deployments. */
export const defaultRateLimiter: RateLimiter = createInMemoryRateLimiter();
