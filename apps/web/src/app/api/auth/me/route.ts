import type { NextRequest } from 'next/server';
import { AppError, permissionsFor } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** GET /api/auth/me — the signed-in user and what they may do. */
export async function GET(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => {
    const user = await getServices().auth.getUser(actor.userId);
    if (!user) throw new AppError('UNAUTHENTICATED', 'Session is no longer valid');
    return {
      data: { user, actor, permissions: permissionsFor(actor) },
    };
  });
}
