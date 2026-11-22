import type { NextRequest } from 'next/server';
import { providerIdParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string; documentId: string }> },
) {
  const { id, documentId } = await context.params;
  return handleAuthedRequest(req, { id, documentId }, async ({ actor, params }) => {
    providerIdParamsSchema.parse(params);
    await getServices().onboarding.deleteDocument(actor, params.id, params.documentId);
    return { data: { deleted: true } };
  });
}
