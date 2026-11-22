import type { NextRequest } from 'next/server';
import { webhookEndpointCreateSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** GET /api/v1/admin/system/webhooks — registered subscribers. */
export async function GET(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => {
    return { data: await getServices().system.webhooks(actor) };
  });
}

/** POST /api/v1/admin/system/webhooks — register a subscriber. */
export async function POST(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor, requestId, ipAddress, userAgent }) => {
    const input = await parseBody(req, webhookEndpointCreateSchema);
    const endpoint = await getServices().system.saveWebhook(actor, input, {
      requestId,
      ipAddress,
      userAgent,
    });
    return { data: endpoint, status: 201 };
  });
}
