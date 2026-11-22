import type { NextRequest } from 'next/server';
import { licenceUpdateSchema, providerIdParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; licenceId: string }> };

export async function PATCH(req: NextRequest, context: Params) {
  const { id, licenceId } = await context.params;
  return handleAuthedRequest(req, { id, licenceId }, async ({ actor, params }) => {
    providerIdParamsSchema.parse({ id: params.id });
    const input = await parseBody(req, licenceUpdateSchema);
    return {
      data: await getServices().onboarding.updateLicence(actor, params.id, params.licenceId, input),
    };
  });
}

export async function DELETE(req: NextRequest, context: Params) {
  const { id, licenceId } = await context.params;
  return handleAuthedRequest(req, { id, licenceId }, async ({ actor, params }) => {
    providerIdParamsSchema.parse({ id: params.id });
    await getServices().onboarding.deleteLicence(actor, params.id, params.licenceId);
    return { data: { deleted: true } };
  });
}
