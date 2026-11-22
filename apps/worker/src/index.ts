import 'dotenv/config';
import type PgBoss from 'pg-boss';
import { createAppContext, createBoss } from './context';
import { eventHandlers } from './handlers';
import { runExpiryScan } from './jobs/expiry';
import { runExportCleanup, runExportJobs } from './jobs/exports';
import { runPinStatsCheck, runSessionCleanup } from './jobs/maintenance';
import { runOutboxCleanup } from './jobs/outbox-cleanup';
import { runJob } from './jobs/run';
import { runStaleDraftReminders } from './jobs/stale-drafts';
import { runWebhookDeliveries } from './jobs/webhook-deliveries';
import { publishBatch } from './publisher';
import { queueList, queueNames, retryDelaySeconds } from './queues';

/**
 * CureNear background worker.
 *
 * - Publishes `outbox_events` to the internal handlers with exponential backoff
 *   and dead-lettering; unhandled events surface on /admin/system/events.
 * - Runs the pg-boss schedule: document and licence expiry, stale draft
 *   reminders, outbox cleanup, session cleanup, webhook delivery, CSV exports
 *   and the nightly PIN-stats consistency check. Every run is recorded in
 *   `job_runs`.
 *
 * All handlers and jobs are idempotent, so several workers may run side by side.
 * Event payloads never contain personal data.
 */

const ctx = createAppContext();
const { env, logger } = ctx;

let dispatching = false;

async function dispatchOutbox(): Promise<void> {
  if (dispatching) return;
  dispatching = true;
  try {
    await publishBatch(
      ctx,
      eventHandlers,
      {
        batchSize: env.OUTBOX_BATCH_SIZE,
        maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
        retryDelaySeconds,
      },
      { now: ctx.now() },
    );
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : 'unknown' },
      'outbox_dispatch_failed',
    );
  } finally {
    dispatching = false;
  }
}

async function registerQueues(boss: PgBoss): Promise<void> {
  // pg-boss v10 requires queues to exist before work/schedule; idempotent on restart.
  for (const name of queueList) {
    await boss.createQueue(name, { name });
  }
}

async function main(): Promise<void> {
  const boss = createBoss(env, logger);
  await boss.start();
  await registerQueues(boss);

  // pg-boss v10 passes a batch of jobs to each handler.
  await boss.work(queueNames.outbox, async () => {
    await dispatchOutbox();
  });
  await boss.work(queueNames.documentExpiry, async () => {
    await runJob(ctx, queueNames.documentExpiry, () => runExpiryScan(ctx));
  });
  await boss.work(queueNames.staleDrafts, async () => {
    await runJob(ctx, queueNames.staleDrafts, () => runStaleDraftReminders(ctx));
  });
  await boss.work(queueNames.outboxCleanup, async () => {
    await runJob(ctx, queueNames.outboxCleanup, () => runOutboxCleanup(ctx));
  });
  await boss.work(queueNames.sessionPrune, async () => {
    await runJob(ctx, queueNames.sessionPrune, () => runSessionCleanup(ctx));
  });
  await boss.work(queueNames.pinStatsCheck, async () => {
    await runJob(ctx, queueNames.pinStatsCheck, () => runPinStatsCheck(ctx));
  });
  await boss.work(queueNames.webhookDeliveries, async () => {
    await runJob(ctx, queueNames.webhookDeliveries, () => runWebhookDeliveries(ctx));
  });
  await boss.work(queueNames.exportJobs, async () => {
    await runJob(ctx, queueNames.exportJobs, () => runExportJobs(ctx));
  });
  await boss.work(queueNames.exportCleanup, async () => {
    await runJob(ctx, queueNames.exportCleanup, () => runExportCleanup(ctx));
  });

  await boss.schedule(queueNames.outbox, '* * * * *', {});
  await boss.schedule(queueNames.documentExpiry, '0 2 * * *', {});
  await boss.schedule(queueNames.pinStatsCheck, '15 2 * * *', {});
  await boss.schedule(queueNames.sessionPrune, '0 3 * * *', {});
  await boss.schedule(queueNames.outboxCleanup, '30 3 * * *', {});
  await boss.schedule(queueNames.staleDrafts, '0 4 * * *', {});
  await boss.schedule(queueNames.webhookDeliveries, '* * * * *', {});
  await boss.schedule(queueNames.exportJobs, '* * * * *', {});
  await boss.schedule(queueNames.exportCleanup, '45 3 * * *', {});

  // Low-latency dispatch loop in addition to the once-a-minute pg-boss schedule.
  const timer = setInterval(() => {
    void dispatchOutbox();
  }, env.OUTBOX_POLL_INTERVAL_MS);
  timer.unref();

  // Startup line keeps the queue list and handler registry visible in the logs.
  logger.info(
    {
      queues: queueList,
      handlers: eventHandlers.map((handler) => handler.name),
      maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
    },
    'worker_started',
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'worker_stopping');
    clearInterval(timer);
    await boss.stop({ graceful: true });
    await ctx.prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  logger.error({ err: error instanceof Error ? error.message : String(error) }, 'worker_crashed');
  process.exitCode = 1;
});
