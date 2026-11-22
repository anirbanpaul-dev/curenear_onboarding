import type { NextRequest } from 'next/server';
import { locationUpdateSchema, providerIdParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; locationId: string }> };

export async function PATCH(req: NextRequest, context: Params) {
  const { id, locationId } = await context.params;
  return handleAuthedRequest(req, { id, locationId }, async ({ actor, params }) => {
    providerIdParamsSchema.parse({ id: params.id });
    const input = await parseBody(req, locationUpdateSchema);
    return {
      data: await getServices().onboarding.updateLocation(
        actor,
        params.id,
        params.locationId,
        input,
      ),
    };
  });
}

export async function DELETE(req: NextRequest, context: Params) {
  const { id, locationId } = await context.params;
  return handleAuthedRequest(req, { id, locationId }, async ({ actor, params }) => {
    providerIdParamsSchema.parse({ id: params.id });
    await getServices().onboarding.deleteLocation(actor, params.id, params.locationId);
    return { data: { deleted: true } };
  });
}
