import type { NextRequest } from 'next/server';
import { documentIdParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(
    req,
    { id },
    async ({ actor, params, requestId, ipAddress, userAgent }) => {
      const { id: documentId } = documentIdParamsSchema.parse(params);
      return {
        data: await getServices().documents.remove(actor, documentId, {
          requestId,
          ipAddress,
          userAgent,
        }),
      };
    },
  );
}
