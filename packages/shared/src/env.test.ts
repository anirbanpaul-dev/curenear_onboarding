import { afterEach, describe, expect, it } from 'vitest';
import { getServerEnv, parseSeedEnv, parseServerEnv, resetServerEnvCache } from './env';

const base = {
  DATABASE_URL: 'postgresql://curenear:curenear@localhost:5432/curenear',
  SESSION_SECRET: 'a'.repeat(32),
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'curenear-documents',
  S3_ACCESS_KEY_ID: 'curenear',
  S3_SECRET_ACCESS_KEY: 'curenear-secret',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  SMTP_FROM: 'no-reply@curenear.in',
} satisfies NodeJS.ProcessEnv;

const source = (patch: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ ...base, ...patch });

describe('server environment', () => {
  afterEach(() => resetServerEnvCache());

  it('parses a minimal environment and applies documented defaults', () => {
    const env = parseServerEnv(source());
    expect(env.NODE_ENV).toBe('development');
    expect(env.APP_URL).toBe('http://localhost:3000');
    expect(env.SESSION_COOKIE_NAME).toBe('curenear_session');
    expect(env.S3_REGION).toBe('us-east-1');
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    expect(env.DOCUMENT_SCAN_ENABLED).toBe(false);
    expect(env.OUTBOX_BATCH_SIZE).toBe(25);
    expect(env.OUTBOX_MAX_ATTEMPTS).toBe(5);
    expect(env.EXPORT_MAX_ROWS).toBe(50_000);
    expect(env.SMTP_PORT).toBe(1025);
  });

  it('coerces booleans, ports and numeric limits', () => {
    const env = parseServerEnv(
      source({
        NODE_ENV: 'test',
        S3_FORCE_PATH_STYLE: '0',
        PUBLIC_CONFIRMATION_LINK_ENABLED: 'true',
        OUTBOX_BATCH_SIZE: '50',
        OUTBOX_POLL_INTERVAL_MS: '2500',
        EXPORT_RETENTION_HOURS: '12',
      }),
    );
    expect(env.NODE_ENV).toBe('test');
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
    expect(env.PUBLIC_CONFIRMATION_LINK_ENABLED).toBe(true);
    expect(env.OUTBOX_BATCH_SIZE).toBe(50);
    expect(env.OUTBOX_POLL_INTERVAL_MS).toBe(2500);
    expect(env.EXPORT_RETENTION_HOURS).toBe(12);
  });

  it('lists every offending variable instead of failing one at a time', () => {
    try {
      parseServerEnv(
        source({
          DATABASE_URL: 'mysql://nope',
          SESSION_SECRET: 'short',
          S3_BUCKET: 'Bad_Bucket',
          SMTP_FROM: 'not-an-email',
          SMTP_PORT: '99999',
        }),
      );
      throw new Error('expected parsing to fail');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('SESSION_SECRET');
      expect(message).toContain('S3_BUCKET');
      expect(message).toContain('SMTP_FROM');
      expect(message).toContain('SMTP_PORT');
    }
  });

  it('rejects unknown NODE_ENV values and malformed URLs', () => {
    expect(() => parseServerEnv(source({ NODE_ENV: 'staging' }))).toThrow(/NODE_ENV/);
    expect(() => parseServerEnv(source({ APP_URL: 'not a url' }))).toThrow(/APP_URL/);
    expect(() => parseServerEnv(source({ S3_ENDPOINT: 'not a url' }))).toThrow(/S3_ENDPOINT/);
  });

  it('requires the seed admin identity and password', () => {
    const seed = parseSeedEnv(
      source({
        SEED_ADMIN_EMAIL: 'Admin@CureNear.IN',
        SEED_ADMIN_PASSWORD: 'long-enough-password',
      }),
    );
    expect(seed.SEED_ADMIN_EMAIL).toBe('Admin@CureNear.IN');
    expect(seed.SEED_ADMIN_NAME).toBe('Portal Admin');
    expect(() => parseSeedEnv(source())).toThrow(/SEED_ADMIN/);
    expect(() =>
      parseSeedEnv(source({ SEED_ADMIN_EMAIL: 'a@b.co', SEED_ADMIN_PASSWORD: 'short' })),
    ).toThrow(/SEED_ADMIN_PASSWORD/);
  });

  it('caches the process environment until reset', () => {
    const previous = { ...process.env };
    Object.assign(process.env, base);
    try {
      const first = getServerEnv();
      expect(getServerEnv()).toBe(first);
      resetServerEnvCache();
      const second = getServerEnv();
      expect(second).not.toBe(first);
      expect(second.DATABASE_URL).toBe(first.DATABASE_URL);
    } finally {
      for (const key of Object.keys(base)) delete process.env[key];
      Object.assign(process.env, previous);
    }
  });
});
