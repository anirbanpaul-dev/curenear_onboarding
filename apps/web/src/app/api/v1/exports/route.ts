import type { NextRequest } from 'next/server';
import { exportRequestSchema, exportsQuerySchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody, parseQuery } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/exports — the caller's own export history.
 * POST /api/v1/exports — queue one export; the worker writes the file.
 *
 * The response is 202: the CSV does not exist yet. The requester gets an in-app
 * notification when it is ready.
 */
export async function GET(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => {
    const query = parseQuery(req, exportsQuerySchema);
    return { data: await getServices().exports.list(actor, query) };
  });
}

export async function POST(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor, requestId, ipAddress, userAgent }) => {
    const input = await parseBody(req, exportRequestSchema);
    const job = await getServices().exports.create(actor, input, {
      requestId,
      ipAddress,
      userAgent,
    });
    return { data: job, status: 202 };
  });
}
