import type { NextRequest } from 'next/server';
import { deactivateUserSchema, providerIdParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(req, { id }, async ({ actor, requestId, ipAddress, userAgent }) => {
    providerIdParamsSchema.parse({ id });
    const input = await parseBody(req, deactivateUserSchema);
    const user = await getServices().users.deactivate(actor, id, input.reason, {
      requestId,
      ipAddress,
      userAgent,
    });
    return { data: user };
  });
}
