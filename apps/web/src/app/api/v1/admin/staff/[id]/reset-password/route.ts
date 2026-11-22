import type { NextRequest } from 'next/server';
import { staffIdParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** POST /api/v1/admin/staff/:id/reset-password — new temporary password, shown once. */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(req, { id }, async ({ actor, requestId, ipAddress, userAgent }) => {
    staffIdParamsSchema.parse({ id });
    const result = await getServices().staff.resetPassword(actor, id, {
      requestId,
      ipAddress,
      userAgent,
    });
    return { data: result };
  });
}
