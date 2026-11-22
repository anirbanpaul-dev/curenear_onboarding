import { canonicalEventType, validateEventPayload, type OutboxEventRecord } from '@curenear/shared';
import type { AppContext } from './context';
import type { EventHandler } from './handlers';
import { nextAttemptAt } from './queues';

export interface PublisherConfig {
  batchSize: number;
  /** Attempts (including the current claim) before an event is dead-lettered. */
  maxAttempts: number;
  retryDelaySeconds: (attempts: number) => number;
}

export interface PublishSummary {
  claimed: number;
  published: number;
  failed: number;
  deadLettered: number;
}

/**
 * Claims a batch of outbox rows with `FOR UPDATE SKIP LOCKED`, runs every
 * interested handler once per event, then marks the event published.
 *
 * Failures back off exponentially. After `maxAttempts` the row is dead-lettered
 * and stops being claimed; it stays on /admin/system/events where an
 * administrator can retry it after fixing the cause.
 */
export async function publishBatch(
  ctx: AppContext,
  handlers: EventHandler[],
  config: PublisherConfig,
  options: { now?: Date } = {},
): Promise<PublishSummary> {
  const now = options.now ?? ctx.now();
  const summary: PublishSummary = { claimed: 0, published: 0, failed: 0, deadLettered: 0 };

  const batch = await ctx.repositories.outbox.claimBatch(config.batchSize, now);
  summary.claimed = batch.length;

  for (const event of batch) {
    try {
      await processEvent(event, ctx, handlers);
      await ctx.repositories.outbox.markPublished(event.id, ctx.now());
      summary.published += 1;
      ctx.logger.info({ eventId: event.id, type: event.eventType }, 'outbox_event_published');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      if (event.attempts >= config.maxAttempts) {
        await ctx.repositories.outbox.markDeadLettered(
          event.id,
          message,
          ctx.now(),
          event.attempts,
        );
        summary.deadLettered += 1;
        ctx.logger.error(
          { eventId: event.id, type: event.eventType, attempts: event.attempts, err: message },
          'outbox_event_dead_lettered',
        );
      } else {
        await ctx.repositories.outbox.markFailed(
          event.id,
          message,
          nextAttemptAt(event.attempts, ctx.now(), config.retryDelaySeconds),
        );
        summary.failed += 1;
        ctx.logger.warn(
          { eventId: event.id, type: event.eventType, attempts: event.attempts, err: message },
          'outbox_event_failed',
        );
      }
    }
  }

  return summary;
}

async function processEvent(
  event: OutboxEventRecord,
  ctx: AppContext,
  handlers: EventHandler[],
): Promise<void> {
  const validation = validateEventPayload(event.eventType, event.payload);
  if (!validation.success) {
    throw new Error(
      `Invalid payload for ${event.eventType}: ${validation.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
        .join('; ')}`,
    );
  }

  const canonical = canonicalEventType(event.eventType);
  for (const handler of handlers) {
    if (!handler.handles(canonical)) continue;

    if (await ctx.repositories.system.alreadyProcessed(event.id, handler.name)) continue;

    await handler.handle(event, ctx);
    await ctx.repositories.system.markProcessed(event.id, handler.name, ctx.now());
  }
}
