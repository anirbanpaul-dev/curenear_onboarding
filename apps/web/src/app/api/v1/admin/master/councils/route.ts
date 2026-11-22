import type { NextRequest } from 'next/server';
import { createCouncilSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** POST /api/v1/admin/master/councils — add a registering council (ADMIN). */
export async function POST(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor, requestId, ipAddress, userAgent }) => {
    const input = await parseBody(req, createCouncilSchema);
    const record = await getServices().master.createCouncil(actor, input, {
      requestId,
      ipAddress,
      userAgent,
    });
    return { data: record, status: 201 };
  });
}
