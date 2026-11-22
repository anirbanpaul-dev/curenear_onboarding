import type { NextRequest } from 'next/server';
import { handleAuthedRequest } from '@/lib/api/handler';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** GET /api/v1/notifications/unread — the bell count. */
export async function GET(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => {
    return { data: await getServices().notifications.unreadCount(actor) };
  });
}
