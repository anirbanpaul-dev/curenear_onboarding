import type { NextRequest } from 'next/server';
import { doctorPracticeUpdateSchema, providerIdParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; practiceId: string }> };

export async function PATCH(req: NextRequest, context: Params) {
  const { id, practiceId } = await context.params;
  return handleAuthedRequest(
    req,
    { id, practiceId },
    async ({ actor, params, requestId, ipAddress, userAgent }) => {
      providerIdParamsSchema.parse({ id: params.id });
      const input = await parseBody(req, doctorPracticeUpdateSchema);
      return {
        data: await getServices().onboarding.updateDoctorPractice(
          actor,
          params.id,
          params.practiceId,
          input,
          { requestId, ipAddress, userAgent },
        ),
      };
    },
  );
}

export async function DELETE(req: NextRequest, context: Params) {
  const { id, practiceId } = await context.params;
  return handleAuthedRequest(req, { id, practiceId }, async ({ actor, params }) => {
    providerIdParamsSchema.parse({ id: params.id });
    await getServices().onboarding.deleteDoctorPractice(actor, params.id, params.practiceId);
    return { data: { deleted: true } };
  });
}
