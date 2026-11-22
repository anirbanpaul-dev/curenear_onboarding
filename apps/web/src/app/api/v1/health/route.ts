import type { NextRequest } from 'next/server';
import { handlePublicRequest } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handlePublicRequest(req, {}, async () => ({
    data: {
      status: 'ok',
      apiVersion: 'v1',
      time: new Date().toISOString(),
    },
  }));
}
