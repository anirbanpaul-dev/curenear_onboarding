import type { NextRequest } from 'next/server';
import { deactivateStaffSchema, staffIdParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** POST /api/v1/admin/staff/:id/deactivate — revokes every session immediately. */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(req, { id }, async ({ actor, requestId, ipAddress, userAgent }) => {
    staffIdParamsSchema.parse({ id });
    const input = await parseBody(req, deactivateStaffSchema);
    const staff = await getServices().staff.deactivate(actor, id, input.reason, {
      requestId,
      ipAddress,
      userAgent,
    });
    return { data: staff };
  });
}
