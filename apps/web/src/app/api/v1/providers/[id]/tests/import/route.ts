import type { NextRequest } from 'next/server';
import { providerIdParamsSchema, testCatalogueImportSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** POST /api/v1/providers/[id]/tests/import — bulk catalogue upload (field-spec 8.3). */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(
    req,
    { id },
    async ({ actor, params, requestId, ipAddress, userAgent }) => {
      providerIdParamsSchema.parse(params);
      const input = await parseBody(req, testCatalogueImportSchema);
      return {
        data: await getServices().onboarding.importTestCatalogue(actor, params.id, input, {
          requestId,
          ipAddress,
          userAgent,
        }),
      };
    },
  );
}
