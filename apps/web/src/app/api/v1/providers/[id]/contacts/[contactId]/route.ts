import type { NextRequest } from 'next/server';
import { providerIdParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string; contactId: string }> },
) {
  const { id, contactId } = await context.params;
  return handleAuthedRequest(req, { id, contactId }, async ({ actor, params }) => {
    providerIdParamsSchema.parse({ id: params.id });
    await getServices().onboarding.deleteContact(actor, params.id, params.contactId);
    return { data: { deleted: true } };
  });
}
