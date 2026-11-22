import type { NextRequest } from 'next/server';
import { masterListQuerySchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseQuery } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** GET /api/v1/master/service-categories?providerType= — categories per type. */
export async function GET(req: NextRequest) {
  return handleAuthedRequest(req, {}, async () => {
    const { q, providerType, includeInactive } = parseQuery(req, masterListQuerySchema);
    const rows = await getServices().master.listServiceCategories({
      search: q,
      providerType,
      includeInactive,
    });
    return { data: rows, headers: { 'cache-control': 'private, max-age=300' } };
  });
}
