import type { NextRequest } from 'next/server';
import { systemEventsQuerySchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseQuery } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** GET /api/v1/admin/system/events — outbox console, dead letters included. */
export async function GET(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => {
    const query = parseQuery(req, systemEventsQuerySchema);
    return { data: await getServices().system.events(actor, query) };
  });
}
