import type { NextRequest } from 'next/server';
import { resetPasswordSchema } from '@curenear/shared';
import { handlePublicRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** POST /api/auth/reset-password — redeems a single-use token. */
export async function POST(req: NextRequest) {
  return handlePublicRequest(req, {}, async ({ requestId, ipAddress, userAgent, req: request }) => {
    const input = await parseBody(request, resetPasswordSchema);
    await getServices().auth.resetPassword(input.token, input.password, {
      requestId,
      ipAddress,
      userAgent,
    });
    return { data: { reset: true } };
  });
}
