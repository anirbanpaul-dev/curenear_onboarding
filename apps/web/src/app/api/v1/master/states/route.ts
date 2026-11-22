import type { NextRequest } from 'next/server';
import { handleAuthedRequest } from '@/lib/api/handler';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** GET /api/v1/master/states — states and union territories. */
export async function GET(req: NextRequest) {
  return handleAuthedRequest(req, {}, async () => {
    const rows = await getServices().master.listStates();
    return { data: rows, headers: { 'cache-control': 'private, max-age=3600' } };
  });
}
