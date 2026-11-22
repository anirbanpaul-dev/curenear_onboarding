import type { NextRequest } from 'next/server';
import { clinicDoctorUpdateSchema, providerIdParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; linkId: string }> };

export async function PATCH(req: NextRequest, context: Params) {
  const { id, linkId } = await context.params;
  return handleAuthedRequest(req, { id, linkId }, async ({ actor, params }) => {
    providerIdParamsSchema.parse({ id: params.id });
    const input = await parseBody(req, clinicDoctorUpdateSchema);
    return {
      data: await getServices().onboarding.updateClinicDoctor(
        actor,
        params.id,
        params.linkId,
        input,
      ),
    };
  });
}

export async function DELETE(req: NextRequest, context: Params) {
  const { id, linkId } = await context.params;
  return handleAuthedRequest(req, { id, linkId }, async ({ actor, params }) => {
    providerIdParamsSchema.parse({ id: params.id });
    await getServices().onboarding.removeClinicDoctor(actor, params.id, params.linkId);
    return { data: { deleted: true } };
  });
}
