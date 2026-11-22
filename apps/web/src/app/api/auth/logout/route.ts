import type { NextRequest } from 'next/server';
import { getServerEnv } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** POST /api/auth/logout — revokes this session only. */
export async function POST(req: NextRequest) {
  return handleAuthedRequest(
    req,
    {},
    async ({ actor, sessionToken, requestId, ipAddress, userAgent }) => {
      await getServices().auth.logout(sessionToken, actor, { requestId, ipAddress, userAgent });
      return {
        data: { signedOut: true },
        clearCookies: [getServerEnv().SESSION_COOKIE_NAME],
      };
    },
  );
}
