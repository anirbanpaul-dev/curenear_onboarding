import type { NextRequest } from 'next/server';
import { pinSummaryQuerySchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseQuery } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/admin/analytics/pin-summary/export
 *
 * The current PIN view as CSV (same filters, grouping and sort as the table),
 * capped at 5000 rows. Returned as JSON so the shared success/error envelope is
 * kept; the browser turns it into a download.
 */
export async function GET(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => {
    const query = parseQuery(req, pinSummaryQuerySchema);
    const result = await getServices().analytics.exportPinSummary(actor, query);
    return { data: result };
  });
}
