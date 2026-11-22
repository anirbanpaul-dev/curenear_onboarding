import type { NextRequest } from 'next/server';
import { withApiHandler } from '@/server/http';
import { runReadinessChecks } from '@/server/health';
import { isShuttingDown } from '@/server/shutdown';

export const dynamic = 'force-dynamic';

/** Readiness: 200 only when PostgreSQL and S3-compatible storage both answer. */
export async function GET(req: NextRequest) {
  return withApiHandler(
    async ({ requestId }) => {
      const report = await runReadinessChecks();
      const ready = report.ok && !isShuttingDown();
      return {
        status: ready ? 200 : 503,
        data: {
          status: ready ? 'ready' : 'not_ready',
          check: 'readiness',
          checks: report.checks,
          requestId,
          time: new Date().toISOString(),
        },
      };
    },
    { log: false },
  )(req);
}
