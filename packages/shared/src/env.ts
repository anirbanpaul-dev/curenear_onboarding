import { z } from 'zod';

/**
 * Secrets and connection settings come from the environment only, validated with
 * Zod. Nothing here may be imported by client components.
 *
 * Parsing is strict: a missing or malformed variable fails the process at startup
 * instead of surfacing as a confusing runtime error later.
 */

const databaseUrl = z
  .string()
  .min(1, 'DATABASE_URL is required')
  .refine((value) => /^postgres(ql)?:\/\//.test(value), 'DATABASE_URL must be a postgres URL');

const booleanFromEnv = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

const port = z.coerce.number().int().min(1).max(65_535);

// dotenv turns `NAME=` into an empty string; optional settings must treat that
// as absent rather than failing min(1)/url checks.
const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);
const optionalUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().url().optional(),
);

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: databaseUrl,
  APP_URL: z.string().url().default('http://localhost:3000'),

  // Reserved for signing future cookie/token payloads; validated now so a
  // missing secret cannot be discovered mid-rollout.
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_COOKIE_NAME: z.string().min(1).default('curenear_session'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // S3-compatible object storage (MinIO locally, any S3 API in production).
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z
    .string()
    .min(3, 'S3_BUCKET must be at least 3 characters')
    .max(63)
    .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/, 'S3_BUCKET must be a valid bucket name'),
  S3_ACCESS_KEY_ID: z.string().min(3),
  S3_SECRET_ACCESS_KEY: z.string().min(8),
  S3_FORCE_PATH_STYLE: booleanFromEnv.default(true),

  // Malware scanning hook for uploaded documents. Disabled by default; the
  // ClamAV provider is still a stub, so enabling it fails loudly instead of
  // releasing unscanned files.
  DOCUMENT_SCAN_ENABLED: booleanFromEnv.default(false),
  CLAMAV_HOST: z.string().min(1).default('127.0.0.1'),
  CLAMAV_PORT: port.default(3310),

  // Outbound mail (Mailpit locally).
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: port,
  SMTP_FROM: z.string().email('SMTP_FROM must be an email address'),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,

  // Public tokenised confirmation links (/confirm/[token]). Off by default
  // until counsel and the operations team sign off on the flow.
  PUBLIC_CONFIRMATION_LINK_ENABLED: booleanFromEnv.default(false),

  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(25),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).max(3_600_000).default(10_000),
  /** Attempts before an event is dead-lettered and surfaced to administrators. */
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(5),
  OUTBOX_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  DEAD_LETTER_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  /** Drafts untouched for this many days get a reminder. */
  STALE_DRAFT_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8),

  // CSV exports: the row cap keeps a careless filter from producing an
  // unbounded file, and the TTL is how long the finished file stays available.
  EXPORT_MAX_ROWS: z.coerce.number().int().min(1).max(1_000_000).default(50_000),
  EXPORT_RETENTION_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  EXPORT_JOBS_PER_RUN: z.coerce.number().int().min(1).max(50).default(5),
  AGGREGATOR_WEBHOOK_URL: optionalUrl,
  AGGREGATOR_WEBHOOK_TOKEN: optionalString.refine(
    (value) => value === undefined || value.length >= 16,
    'AGGREGATOR_WEBHOOK_TOKEN must be at least 16 characters',
  ),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export const seedEnvSchema = serverEnvSchema.extend({
  SEED_ADMIN_EMAIL: z.string().email(),
  SEED_ADMIN_NAME: z.string().min(1).default('Portal Admin'),
  SEED_ADMIN_PASSWORD: z.string().min(12, 'SEED_ADMIN_PASSWORD must be at least 12 characters'),
});

export type SeedEnv = z.infer<typeof seedEnvSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

/** Throws with every offending variable listed, so startup fails once and clearly. */
export function parseServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration (see .env.example):\n${formatIssues(parsed.error)}`,
    );
  }
  return parsed.data;
}

export function parseSeedEnv(source: NodeJS.ProcessEnv = process.env): SeedEnv {
  const parsed = seedEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid seed environment configuration:\n${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

let cached: ServerEnv | null = null;

/** Validated once per process; call at startup (instrumentation) and from server code. */
export function getServerEnv(): ServerEnv {
  if (!cached) cached = parseServerEnv();
  return cached;
}

/** Test helper: forget the memoised environment. */
export function resetServerEnvCache(): void {
  cached = null;
}
