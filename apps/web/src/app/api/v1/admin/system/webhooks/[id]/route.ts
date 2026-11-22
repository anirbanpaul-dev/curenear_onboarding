import type { NextRequest } from 'next/server';
import { webhookEndpointParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** DELETE /api/v1/admin/system/webhooks/[id] — remove a subscriber. */
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(
    req,
    { id },
    async ({ actor, params, requestId, ipAddress, userAgent }) => {
      webhookEndpointParamsSchema.parse({ id: params.id });
      const result = await getServices().system.deleteWebhook(actor, params.id, {
        requestId,
        ipAddress,
        userAgent,
      });
      return { data: result };
    },
  );
}
