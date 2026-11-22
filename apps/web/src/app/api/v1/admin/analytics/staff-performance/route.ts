import type { NextRequest } from 'next/server';
import { staffPerformanceQuerySchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseQuery } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/admin/analytics/staff-performance
 *
 * Per staff member: providers created, ever submitted, approved and currently
 * rejected, with the average time from creation to approval.
 */
export async function GET(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => {
    const query = parseQuery(req, staffPerformanceQuerySchema);
    const performance = await getServices().analytics.staffPerformance(actor, query);
    return { data: performance };
  });
}
