import type { NextRequest } from 'next/server';
import { overviewQuerySchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseQuery } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/admin/analytics/overview
 *
 * Totals, the Draft → Submitted → Approved funnel, average review time (days
 * from submission to approval) and onboarding per day for the last `days`.
 */
export async function GET(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => {
    const query = parseQuery(req, overviewQuerySchema);
    const overview = await getServices().analytics.overview(actor, query);
    return { data: overview };
  });
}
