import { checkProviderPinStats } from '@curenear/db';
import type { AppContext } from '../context';

/** Deletes expired and revoked sessions that are past their expiry. */
export async function runSessionCleanup(ctx: AppContext): Promise<Record<string, unknown>> {
  const removed = await ctx.repositories.sessions.deleteExpired(ctx.now());
  return { removed };
}

/**
 * Nightly consistency check: compares the PIN read model with live counts. Drift
 * is logged (and recorded in job history) so it can be investigated; the repair
 * is `pnpm db:rebuild-stats`.
 */
export async function runPinStatsCheck(ctx: AppContext): Promise<Record<string, unknown>> {
  const { drift, driftCount } = await checkProviderPinStats(ctx.prisma);
  if (driftCount > 0) {
    ctx.logger.warn({ driftCount, sample: drift.slice(0, 10) }, 'pin_stats_drift_detected');
  }
  return { driftCount, sample: drift.slice(0, 10) };
}
