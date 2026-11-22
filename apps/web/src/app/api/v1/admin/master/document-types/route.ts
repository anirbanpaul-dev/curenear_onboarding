import type { NextRequest } from 'next/server';
import { createDocumentTypeSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** POST /api/v1/admin/master/document-types — add a document type (ADMIN). */
export async function POST(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor, requestId, ipAddress, userAgent }) => {
    const input = await parseBody(req, createDocumentTypeSchema);
    const record = await getServices().master.createDocumentType(actor, input, {
      requestId,
      ipAddress,
      userAgent,
    });
    return { data: record, status: 201 };
  });
}
