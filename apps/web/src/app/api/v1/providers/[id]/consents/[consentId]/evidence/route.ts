import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError, providerIdParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { createS3ObjectStorage } from '@/server/documents/object-storage';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

const paramsSchema = providerIdParamsSchema.extend({ consentId: z.string().uuid() });

/** Presigned evidence download. The consent service audits every access. */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string; consentId: string }> },
) {
  const { id, consentId } = await context.params;
  return handleAuthedRequest(
    req,
    { id, consentId },
    async ({ actor, params, requestId, ipAddress, userAgent }) => {
      const parsed = paramsSchema.parse(params);
      const evidence = await getServices().consents.evidence(actor, parsed.id, parsed.consentId, {
        requestId,
        ipAddress,
        userAgent,
      });
      if (!evidence.storageKey) {
        throw new AppError('NOT_FOUND', 'The evidence file is not stored');
      }
      const url = await createS3ObjectStorage().createDownloadUrl({
        key: evidence.storageKey,
        expiresInSeconds: 600,
      });
      return { data: { url, fileName: evidence.fileName } };
    },
  );
}
