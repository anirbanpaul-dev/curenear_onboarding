import type { NextRequest } from 'next/server';
import { masterListQuerySchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseQuery } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** GET /api/v1/master/specialties — active specialties, optionally filtered. */
export async function GET(req: NextRequest) {
  return handleAuthedRequest(req, {}, async () => {
    const { q, includeInactive } = parseQuery(req, masterListQuerySchema);
    const rows = await getServices().master.listSpecialties({ search: q, includeInactive });
    return { data: rows, headers: { 'cache-control': 'private, max-age=300' } };
  });
}
