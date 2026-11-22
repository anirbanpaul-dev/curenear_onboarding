import type { NextRequest } from 'next/server';
import { getServerEnv } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** POST /api/auth/logout-all — revokes every active session for the account. */
export async function POST(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor, requestId, ipAddress, userAgent }) => {
    const revoked = await getServices().auth.logoutAll(actor, {
      requestId,
      ipAddress,
      userAgent,
    });
    return {
      data: { revoked, signedOut: true },
      clearCookies: [getServerEnv().SESSION_COOKIE_NAME],
    };
  });
}
