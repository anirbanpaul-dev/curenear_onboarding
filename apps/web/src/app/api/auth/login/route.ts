import type { NextRequest } from 'next/server';
import { getServerEnv, homePathFor, loginSchema } from '@curenear/shared';
import { handlePublicRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';
import { SESSION_TTL_MS } from '@/server/services/auth-service';

export const dynamic = 'force-dynamic';

/** POST /api/auth/login — email + password, sets the session cookie. */
export async function POST(req: NextRequest) {
  return handlePublicRequest(req, {}, async ({ requestId, ipAddress, userAgent }) => {
    const input = await parseBody(req, loginSchema);
    const env = getServerEnv();

    const result = await getServices().auth.login(input.email, input.password, {
      requestId,
      ipAddress,
      userAgent,
    });

    return {
      data: {
        user: result.user,
        expiresAt: result.expiresAt.toISOString(),
        mustChangePassword: result.mustChangePassword,
        redirectTo: result.mustChangePassword ? '/change-password' : homePathFor(result.user),
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
