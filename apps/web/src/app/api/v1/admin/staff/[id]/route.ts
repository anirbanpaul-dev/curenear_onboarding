import type { NextRequest } from 'next/server';
import { deactivateStaffSchema, staffIdParamsSchema, updateStaffSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(req, { id }, async ({ actor }) => {
    staffIdParamsSchema.parse({ id });
    const detail = await getServices().staff.get(actor, id);
    return { data: detail };
  });
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(req, { id }, async ({ actor, requestId, ipAddress, userAgent }) => {
    staffIdParamsSchema.parse({ id });
    const input = await parseBody(req, updateStaffSchema);
    const staff = await getServices().staff.update(actor, id, input, {
      requestId,
      ipAddress,
      userAgent,
    });
    return { data: staff };
  });
}

/** DELETE is a soft delete: the account and its territory stop working, the row stays. */
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(req, { id }, async ({ actor, requestId, ipAddress, userAgent }) => {
    staffIdParamsSchema.parse({ id });
    const input = await parseBody(req, deactivateStaffSchema);
    const staff = await getServices().staff.remove(actor, id, input.reason, {
      requestId,
      ipAddress,
      userAgent,
    });
    return { data: staff };
  });
}
