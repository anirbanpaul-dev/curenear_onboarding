import type { NextRequest } from 'next/server';
import { insuranceUpdateSchema, providerIdParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; insuranceId: string }> };

export async function PATCH(req: NextRequest, context: Params) {
  const { id, insuranceId } = await context.params;
  return handleAuthedRequest(req, { id, insuranceId }, async ({ actor, params }) => {
    providerIdParamsSchema.parse({ id: params.id });
    const input = await parseBody(req, insuranceUpdateSchema);
    return {
      data: await getServices().onboarding.updateInsurance(
        actor,
        params.id,
        params.insuranceId,
        input,
      ),
    };
  });
}

export async function DELETE(req: NextRequest, context: Params) {
  const { id, insuranceId } = await context.params;
  return handleAuthedRequest(req, { id, insuranceId }, async ({ actor, params }) => {
    providerIdParamsSchema.parse({ id: params.id });
    await getServices().onboarding.deleteInsurance(actor, params.id, params.insuranceId);
    return { data: { deleted: true } };
  });
}
