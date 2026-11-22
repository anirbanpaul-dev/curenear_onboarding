import type { NextRequest } from 'next/server';
import { changePasswordSchema, getServerEnv } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';
import { SESSION_TTL_MS } from '@/server/services/auth-service';

export const dynamic = 'force-dynamic';

/** POST /api/auth/change-password — required before the portal opens. */
export async function POST(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor, requestId, ipAddress, userAgent }) => {
    const input = await parseBody(req, changePasswordSchema);
    const env = getServerEnv();

    const result = await getServices().auth.changePassword(
      actor,
      { currentPassword: input.currentPassword, newPassword: input.newPassword },
      { requestId, ipAddress, userAgent },
    );

    return {
      data: {
        user: result.user,
        expiresAt: result.expiresAt.toISOString(),
        mustChangePassword: false,
      },
      cookies: [
        {
          name: env.SESSION_COOKIE_NAME,
          value: result.token,
          maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000),
          httpOnly: true,
          sameSite: 'lax',
          secure: true,
        },
      ],
    };
  });
}
