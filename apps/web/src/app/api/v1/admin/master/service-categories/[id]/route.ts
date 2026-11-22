import type { NextRequest } from 'next/server';
import { masterIdParamsSchema, updateServiceCategorySchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody, parseParams } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(req, { id }, async ({ actor, requestId, ipAddress, userAgent }) => {
    parseParams({ id }, masterIdParamsSchema);
    const input = await parseBody(req, updateServiceCategorySchema);
    const record = await getServices().master.updateServiceCategory(actor, id, input, {
      requestId,
      ipAddress,
      userAgent,
    });
    return { data: record };
  });
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(req, { id }, async ({ actor, requestId, ipAddress, userAgent }) => {
    parseParams({ id }, masterIdParamsSchema);
    const record = await getServices().master.deactivateServiceCategory(actor, id, {
      requestId,
      ipAddress,
      userAgent,
    });
    return { data: record };
  });
}
