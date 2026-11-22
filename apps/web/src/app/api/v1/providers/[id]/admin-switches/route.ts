import type { NextRequest } from 'next/server';
import { adminSwitchesSchema, providerIdParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** PATCH /api/v1/providers/[id]/admin-switches — admin-only switches (7.5). */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(
    req,
    { id },
    async ({ actor, params, requestId, ipAddress, userAgent }) => {
      providerIdParamsSchema.parse(params);
      const input = await parseBody(req, adminSwitchesSchema);
      return {
        data: await getServices().onboarding.updateAdminSwitches(actor, params.id, input, {
          requestId,
          ipAddress,
          userAgent,
        }),
      };
    },
  );
}
