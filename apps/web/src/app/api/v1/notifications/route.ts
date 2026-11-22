import type { NextRequest } from 'next/server';
import { notificationsQuerySchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseQuery } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** GET /api/v1/notifications — the caller's own notifications, newest first. */
export async function GET(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => {
    const query = parseQuery(req, notificationsQuerySchema);
    return { data: await getServices().notifications.list(actor, query) };
  });
}
