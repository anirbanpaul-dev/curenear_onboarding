import type { NextRequest } from 'next/server';
import { pincodeSearchQuerySchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseQuery } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** GET /api/v1/master/pincodes/search?q= — prefix match on PIN and office name. */
export async function GET(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => {
    const { q } = parseQuery(req, pincodeSearchQuerySchema);
    const rows = await getServices().master.searchPincodes(actor, q);
    // The directory changes only when it is re-imported, so a short client cache
    // is safe; keep it private because the endpoint needs a session.
    return { data: rows, headers: { 'cache-control': 'private, max-age=60' } };
  });
}
