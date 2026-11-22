import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError, providerIdParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { createS3ObjectStorage } from '@/server/documents/object-storage';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

const paramsSchema = providerIdParamsSchema.extend({ acceptanceId: z.string().uuid() });

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string; acceptanceId: string }> },
) {
  const { id, acceptanceId } = await context.params;
  return handleAuthedRequest(
    req,
    { id, acceptanceId },
    async ({ actor, params, requestId, ipAddress, userAgent }) => {
      const parsed = paramsSchema.parse(params);
      const evidence = await getServices().consents.agreementEvidence(
        actor,
        parsed.id,
        parsed.acceptanceId,
        { requestId, ipAddress, userAgent },
      );
      if (!evidence.storageKey) {
        throw new AppError('NOT_FOUND', 'The signed agreement is not stored');
      }
      const url = await createS3ObjectStorage().createDownloadUrl({
        key: evidence.storageKey,
        expiresInSeconds: 600,
      });
      return { data: { url, fileName: evidence.fileName } };
    },
  );
}
