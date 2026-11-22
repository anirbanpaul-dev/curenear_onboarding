import type { NextRequest } from 'next/server';
import { providerDirectoryViewIdSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseParams } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** DELETE /api/v1/admin/provider-views/[id] — scoped to the signed-in admin. */
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(req, { id }, async ({ actor, params }) => {
    const parsed = parseParams(params, providerDirectoryViewIdSchema);
    return { data: await getServices().directory.deleteView(actor, parsed.id) };
  });
}
