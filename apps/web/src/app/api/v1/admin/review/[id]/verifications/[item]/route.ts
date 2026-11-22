import type { NextRequest } from 'next/server';
import { providerIdParamsSchema, reviewVerificationUpdateSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** PATCH /api/v1/admin/review/[id]/verifications/[item] */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; item: string }> },
) {
  const { id, item } = await context.params;
  return handleAuthedRequest(
    req,
    { id, item },
    async ({ actor, params, requestId, ipAddress, userAgent }) => {
      providerIdParamsSchema.parse({ id: params.id });
      const input = await parseBody(req, reviewVerificationUpdateSchema);
      const verification = await getServices().reviews.updateVerification(
        actor,
        params.id,
        params.item,
        input,
        { requestId, ipAddress, userAgent },
      );
      return { data: verification };
    },
  );
}
