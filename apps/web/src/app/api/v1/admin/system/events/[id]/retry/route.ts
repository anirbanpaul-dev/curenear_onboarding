import type { NextRequest } from 'next/server';
import { eventIdParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** POST /api/v1/admin/system/events/[id]/retry — requeue a dead-lettered event. */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(
    req,
    { id },
    async ({ actor, params, requestId, ipAddress, userAgent }) => {
      eventIdParamsSchema.parse({ id: params.id });
      const result = await getServices().system.retry(actor, params.id, {
        requestId,
        ipAddress,
        userAgent,
      });
      return { data: result };
    },
  );
}
