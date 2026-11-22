import type { NextRequest } from 'next/server';
import { providerDirectoryViewInputSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** GET /api/v1/admin/provider-views — the signed-in admin's saved directory views. */
export async function GET(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => ({
    data: await getServices().directory.views(actor),
  }));
}

/** POST /api/v1/admin/provider-views — save (or overwrite) a named view. */
export async function POST(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => {
    const input = await parseBody(req, providerDirectoryViewInputSchema);
    return { data: await getServices().directory.saveView(actor, input), status: 201 };
  });
}
