import type { AppContext } from '../context';

/**
 * Runs one scheduled job, records the outcome in `job_runs` for
 * /admin/system/jobs, and re-throws failures so pg-boss applies its retry policy.
 *
 * Every job is idempotent, so two worker instances may run the same schedule at
 * the same time: the duplicate work writes the same rows and the same dedupe
 * keys, and the second insert is ignored.
 */
export async function runJob<T extends Record<string, unknown>>(
  ctx: AppContext,
  queue: string,
  work: () => Promise<T>,
): Promise<T> {
  const startedAt = ctx.now();

  try {
    const summary = await work();
    const finishedAt = ctx.now();
    await ctx.repositories.system.recordJobRun({
      id: crypto.randomUUID(),
      queue,
      status: 'SUCCEEDED',
      startedAt,
      finishedAt,
      summary,
      error: null,
    });
    ctx.logger.info({ queue, ...(summary as Record<string, unknown>) }, 'job_succeeded');
    return summary;
  } catch (error) {
    const finishedAt = ctx.now();
    const message = error instanceof Error ? error.message : 'unknown error';
    await ctx.repositories.system.recordJobRun({
      id: crypto.randomUUID(),
      queue,
      status: 'FAILED',
      startedAt,
      finishedAt,
      summary: {},
      error: message.slice(0, 2000),
    });
    ctx.logger.error({ queue, err: message }, 'job_failed');
    throw error;
  }
}
