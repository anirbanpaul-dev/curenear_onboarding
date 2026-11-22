import type { NextRequest } from 'next/server';
import { documentUploadUrlSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor, requestId, ipAddress, userAgent }) => {
    const input = await parseBody(req, documentUploadUrlSchema);
    return {
      data: await getServices().documents.createUploadUrl(actor, input, {
        requestId,
        ipAddress,
        userAgent,
      }),
      status: 201,
    };
  });
}
