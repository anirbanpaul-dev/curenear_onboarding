import type { NextRequest } from 'next/server';
import { createStaffSchema, listStaffQuerySchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody, parseQuery } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** GET /api/v1/admin/staff — admin directory with search, status filter and paging. */
export async function GET(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => {
    const query = parseQuery(req, listStaffQuerySchema);
    const { rows, meta } = await getServices().staff.list(actor, query);
    return { data: rows, meta };
  });
}

/** POST /api/v1/admin/staff — the temporary password is returned once. */
export async function POST(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor, requestId, ipAddress, userAgent }) => {
    const input = await parseBody(req, createStaffSchema);
    const result = await getServices().staff.create(actor, input, {
      requestId,
      ipAddress,
      userAgent,
    });
    return { data: result, status: 201 };
  });
}
