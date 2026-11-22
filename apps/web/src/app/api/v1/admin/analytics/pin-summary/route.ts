import type { NextRequest } from 'next/server';
import { pinSummaryQuerySchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseQuery } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/admin/analytics/pin-summary
 *
 * Providers per PIN by primary location. Filters: provider type, status, state,
 * district, onboarded_by, created date range, and a PIN prefix (`q`). Group by
 * `pin`, `district` or `state` for the drill-down; `gapsOnly=true` lists
 * directory PINs with no approved provider.
 */
export async function GET(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => {
    const query = parseQuery(req, pinSummaryQuerySchema);
    const summary = await getServices().analytics.pinSummary(actor, query);
    return { data: summary };
  });
}
