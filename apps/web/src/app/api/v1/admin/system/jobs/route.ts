import type { NextRequest } from 'next/server';
import { jobRunsQuerySchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseQuery } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** GET /api/v1/admin/system/jobs — scheduled job history, newest first. */
export async function GET(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => {
    const query = parseQuery(req, jobRunsQuerySchema);
    return { data: await getServices().system.jobs(actor, query) };
  });
}
