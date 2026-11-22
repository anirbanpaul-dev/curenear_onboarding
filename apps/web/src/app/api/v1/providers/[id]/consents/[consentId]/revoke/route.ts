import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { consentRevokeSchema, providerIdParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

const paramsSchema = providerIdParamsSchema.extend({ consentId: z.string().uuid() });

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string; consentId: string }> },
) {
  const { id, consentId } = await context.params;
  return handleAuthedRequest(
    req,
    { id, consentId },
    async ({ actor, params, requestId, ipAddress, userAgent }) => {
      const parsed = paramsSchema.parse(params);
      const input = await parseBody(req, consentRevokeSchema);
      return {
        data: await getServices().consents.revoke(
          actor,
          parsed.id,
          parsed.consentId,
          input.reason,
          { requestId, ipAddress, userAgent },
        ),
      };
    },
  );
}
