import type { NextRequest } from 'next/server';
import { staffProviderListQuerySchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseQuery } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/staff/providers — the caller's own providers.
 *
 * The same row/facet shape as the admin directory, but the owner is always the
 * session user, so a staff member cannot list anybody else's records.
 */
export async function GET(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => {
    const query = parseQuery(req, staffProviderListQuerySchema);
    const { rows, facets, meta } = await getServices().staffWorkspace.list(actor, query);
    return { data: rows, meta: { ...meta, facets } };
  });
}
