import type { NextRequest } from 'next/server';
import { duplicatePreviewSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** Duplicate warnings for the start page, before a draft exists. */
export async function POST(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => {
    const input = await parseBody(req, duplicatePreviewSchema);
    return { data: await getServices().onboarding.previewDuplicates(actor, input) };
  });
}
