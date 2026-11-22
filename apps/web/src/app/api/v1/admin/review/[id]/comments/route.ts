import type { NextRequest } from 'next/server';
import { providerIdParamsSchema, reviewCommentSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** POST /api/v1/admin/review/[id]/comments — one thread per section. */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(
    req,
    { id },
    async ({ actor, params, requestId, ipAddress, userAgent }) => {
      providerIdParamsSchema.parse({ id: params.id });
      const input = await parseBody(req, reviewCommentSchema);
      const comment = await getServices().reviews.addComment(actor, params.id, input, {
        requestId,
        ipAddress,
        userAgent,
      });
      return { data: comment, status: 201 };
    },
  );
}
