import type { NextRequest } from 'next/server';
import { providerIdParamsSchema, sectionSaveSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; sectionKey: string }> },
) {
  const { id, sectionKey } = await context.params;
  return handleAuthedRequest(
    req,
    { id, sectionKey },
    async ({ actor, params, requestId, ipAddress, userAgent }) => {
      providerIdParamsSchema.parse({ id: params.id });
      const input = await parseBody(req, sectionSaveSchema);
      const result = await getServices().onboarding.saveSection(
        actor,
        params.id,
        params.sectionKey,
        input,
        { requestId, ipAddress, userAgent },
      );
      return { data: result };
    },
  );
}
