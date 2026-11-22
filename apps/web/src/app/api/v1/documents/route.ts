import type { NextRequest } from 'next/server';
import { documentListQuerySchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseQuery } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => ({
    data: await getServices().documents.list(actor, parseQuery(req, documentListQuerySchema)),
  }));
}
