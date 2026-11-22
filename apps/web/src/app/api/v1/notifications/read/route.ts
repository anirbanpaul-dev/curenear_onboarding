import type { NextRequest } from 'next/server';
import { markNotificationsReadSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** POST /api/v1/notifications/read — mark the given ids, or everything, read. */
export async function POST(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => {
    const input = await parseBody(req, markNotificationsReadSchema);
    return { data: await getServices().notifications.markRead(actor, input) };
  });
}
