import type { NextRequest } from 'next/server';
import { agreementAcceptanceSchema, providerIdParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(
    req,
    { id },
    async ({ actor, params, requestId, ipAddress, userAgent }) => {
      providerIdParamsSchema.parse(params);
      const input = await parseBody(req, agreementAcceptanceSchema);
      return {
        data: await getServices().consents.acceptAgreement(actor, params.id, input, {
          requestId,
          ipAddress,
          userAgent,
        }),
        status: 201,
      };
    },
  );
}
