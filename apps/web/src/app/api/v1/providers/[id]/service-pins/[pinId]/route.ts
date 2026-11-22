import type { NextRequest } from 'next/server';
import { providerIdParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string; pinId: string }> },
) {
  const { id, pinId } = await context.params;
  return handleAuthedRequest(req, { id, pinId }, async ({ actor, params }) => {
    providerIdParamsSchema.parse({ id: params.id });
    await getServices().onboarding.removeServicePin(actor, params.id, params.pinId);
    return { data: { deleted: true } };
  });
}
