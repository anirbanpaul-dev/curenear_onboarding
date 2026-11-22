import type { NextRequest } from 'next/server';
import { staffIdParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** POST /api/v1/admin/staff/:id/reactivate — restores the account, not its sessions. */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(req, { id }, async ({ actor, requestId, ipAddress, userAgent }) => {
    staffIdParamsSchema.parse({ id });
    const staff = await getServices().staff.reactivate(actor, id, {
      requestId,
      ipAddress,
      userAgent,
    });
    return { data: staff };
  });
}
