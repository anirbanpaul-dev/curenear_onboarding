import type { NextRequest } from 'next/server';
import { providerIdParamsSchema, reviewDecisionSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/admin/review/[id]/decisions
 *
 * Approve, request changes, reject, suspend or reinstate. Every decision is a
 * state-machine transition, so audit rows and outbox events are written for it.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(
    req,
    { id },
    async ({ actor, params, requestId, ipAddress, userAgent }) => {
      providerIdParamsSchema.parse({ id: params.id });
      const input = await parseBody(req, reviewDecisionSchema);
      const result = await getServices().reviews.decide(actor, params.id, input, {
        requestId,
        ipAddress,
        userAgent,
      });
      return { data: result };
    },
  );
}
