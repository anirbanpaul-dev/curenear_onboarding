import type { NextRequest } from 'next/server';
import { forgotPasswordSchema } from '@curenear/shared';
import { handlePublicRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

const GENERIC_MESSAGE = 'If that address belongs to an account, a reset link is on its way.';

/** POST /api/auth/forgot-password — same answer for every address. */
export async function POST(req: NextRequest) {
  return handlePublicRequest(req, {}, async ({ requestId, ipAddress, userAgent, req: request }) => {
    const input = await parseBody(request, forgotPasswordSchema);
    await getServices().auth.requestPasswordReset(input.email, {
      requestId,
      ipAddress,
      userAgent,
    });
    return { data: { message: GENERIC_MESSAGE } };
  });
}
