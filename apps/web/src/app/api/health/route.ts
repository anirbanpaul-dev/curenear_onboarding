import type { NextRequest } from 'next/server';
import { withApiHandler } from '@/server/http';

export const dynamic = 'force-dynamic';

/** Liveness: never touches dependencies, so it stays up while they recover. */
export async function GET(req: NextRequest) {
  return withApiHandler(
    async ({ requestId }) => ({
      data: {
        status: 'ok',
        check: 'liveness',
        requestId,
        time: new Date().toISOString(),
      },
    }),
    { log: false },
  )(req);
}
