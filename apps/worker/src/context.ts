import PgBoss from 'pg-boss';
import pino, { type Logger } from 'pino';
import type { PrismaClient } from '@curenear/db';
import { createPersistenceFromEnv, createPrismaClient } from '@curenear/db';
import { getServerEnv, type Repositories, type ServerEnv, type UnitOfWork } from '@curenear/shared';
import { createSmtpEmailService, type EmailService } from './email';

/** Everything a handler or scheduled job needs. Tests build this by hand. */
export interface AppContext {
  env: ServerEnv;
  prisma: PrismaClient;
  repositories: Repositories;
  unitOfWork: UnitOfWork;
  logger: Logger;
  email: EmailService;
  now: () => Date;
  fetchImpl: typeof fetch;
}

export function createLogger(env: ServerEnv): Logger {
  return pino({
    level: env.LOG_LEVEL,
    base: { service: 'curenear-worker' },
    redact: { paths: ['token', '*.token', '*.password'], remove: true },
  });
}

export function createAppContext(): AppContext {
  const env = getServerEnv();
  const logger = createLogger(env);
  const prisma = createPrismaClient();
  const persistence = createPersistenceFromEnv();

  return {
    env,
    prisma,
    repositories: persistence.repositories,
    unitOfWork: persistence.unitOfWork,
    logger,
    email: createSmtpEmailService(
      {
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        from: env.SMTP_FROM,
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
      },
      logger,
    ),
    now: () => new Date(),
    fetchImpl: fetch,
  };
}

export function createBoss(env: ServerEnv, logger: Logger): PgBoss {
  const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: 'pgboss' });
  boss.on('error', (error) => logger.error({ err: error.message }, 'pgboss_error'));
  return boss;
}
