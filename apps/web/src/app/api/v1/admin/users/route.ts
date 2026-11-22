import type { NextRequest } from 'next/server';
import { createUserSchema, listUsersQuerySchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody, parseQuery } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => {
    const query = parseQuery(req, listUsersQuerySchema);
    const { rows, meta } = await getServices().users.list(actor, query);
    return { data: rows, meta };
  });
}

export async function POST(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor, requestId, ipAddress, userAgent }) => {
    const input = await parseBody(req, createUserSchema);
    const user = await getServices().users.create(actor, input, {
      requestId,
      ipAddress,
      userAgent,
    });
    return { data: user, status: 201 };
  });
}
