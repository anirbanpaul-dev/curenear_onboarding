import type { AppContext } from '../context';

const DAY_MS = 86_400_000;

export interface OutboxCleanupSummary extends Record<string, unknown> {
  removed: number;
}

/**
 * Deletes published events older than `OUTBOX_RETENTION_DAYS` and dead letters
 * older than `DEAD_LETTER_RETENTION_DAYS`. Unpublished, live events are never
 * touched.
 */
export async function runOutboxCleanup(
  ctx: AppContext,
  options: { now?: Date } = {},
): Promise<OutboxCleanupSummary> {
  const now = options.now ?? ctx.now();
  const removed = await ctx.repositories.system.purgeOutbox({
    publishedBefore: new Date(now.getTime() - ctx.env.OUTBOX_RETENTION_DAYS * DAY_MS),
    deadBefore: new Date(now.getTime() - ctx.env.DEAD_LETTER_RETENTION_DAYS * DAY_MS),
  });
  return { removed };
}
