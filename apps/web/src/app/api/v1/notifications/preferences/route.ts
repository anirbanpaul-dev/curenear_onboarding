import type { NextRequest } from 'next/server';
import { notificationPreferencesSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** GET /api/v1/notifications/preferences — catalogue merged with saved choices. */
export async function GET(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => {
    return { data: await getServices().notifications.preferences(actor) };
  });
}

/** PUT /api/v1/notifications/preferences */
export async function PUT(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => {
    const input = await parseBody(req, notificationPreferencesSchema);
    return { data: await getServices().notifications.savePreferences(actor, input) };
  });
}
