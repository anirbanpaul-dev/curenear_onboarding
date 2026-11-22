const testUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const env = process.env as Record<string, string | undefined>;

if (testUrl) {
  env.DATABASE_URL = testUrl;
}

env.NODE_ENV = env.NODE_ENV ?? 'test';
env.APP_URL = env.APP_URL ?? 'http://localhost:3000';
env.LOG_LEVEL = env.LOG_LEVEL ?? 'silent';

// Throwaway values so the strict server-env parser accepts the worker context.
env.SESSION_SECRET = env.SESSION_SECRET ?? 'integration-test-session-secret-value';
env.S3_ENDPOINT = env.S3_ENDPOINT ?? 'http://127.0.0.1:9000';
env.S3_REGION = env.S3_REGION ?? 'us-east-1';
env.S3_BUCKET = env.S3_BUCKET ?? 'curenear-test';
env.S3_ACCESS_KEY_ID = env.S3_ACCESS_KEY_ID ?? 'test-access-key';
env.S3_SECRET_ACCESS_KEY = env.S3_SECRET_ACCESS_KEY ?? 'test-secret-key';
env.SMTP_HOST = env.SMTP_HOST ?? '127.0.0.1';
env.SMTP_PORT = env.SMTP_PORT ?? '1025';
env.SMTP_FROM = env.SMTP_FROM ?? 'no-reply@curenear.test';
