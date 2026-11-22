import type { NextRequest } from 'next/server';
import { adminProviderListQuerySchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseQuery } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/admin/providers — the provider directory.
 *
 * The list carries `meta.total`, `meta.facets` (type and status counts under
 * the same filters) and a page of rows; every filter is applied server-side.
 */
export async function GET(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => {
    const query = parseQuery(req, adminProviderListQuerySchema);
    const { rows, facets, meta } = await getServices().directory.list(actor, query);
    return { data: rows, meta: { ...meta, facets } };
  });
}
