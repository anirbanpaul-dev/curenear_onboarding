import type { NextRequest } from 'next/server';
import { providerIdParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** POST /api/v1/admin/review/[id]/assign — take this provider into my queue. */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(req, { id }, async ({ actor, params }) => {
    providerIdParamsSchema.parse({ id: params.id });
    const result = await getServices().reviews.assignToMe(actor, params.id);
    return { data: result };
  });
}
