import type { NextRequest } from 'next/server';
import { doctorProfileSaveSchema, providerIdParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(req, { id }, async ({ actor, params }) => {
    providerIdParamsSchema.parse(params);
    return { data: await getServices().onboarding.getDoctorProfile(actor, params.id) };
  });
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(
    req,
    { id },
    async ({ actor, params, requestId, ipAddress, userAgent }) => {
      providerIdParamsSchema.parse(params);
      const input = await parseBody(req, doctorProfileSaveSchema);
      return {
        data: await getServices().onboarding.saveDoctorProfile(actor, params.id, input, {
          requestId,
          ipAddress,
          userAgent,
        }),
      };
    },
  );
}
