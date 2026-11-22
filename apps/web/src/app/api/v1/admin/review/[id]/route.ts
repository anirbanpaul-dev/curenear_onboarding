import type { NextRequest } from 'next/server';
import { providerIdParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** GET /api/v1/admin/review/[id] — data, documents, checklist and comments. */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(req, { id }, async ({ actor, params }) => {
    providerIdParamsSchema.parse({ id: params.id });
    const detail = await getServices().reviews.detail(actor, params.id);
    return { data: detail };
  });
}
