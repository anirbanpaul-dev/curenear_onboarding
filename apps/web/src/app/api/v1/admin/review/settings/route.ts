import type { NextRequest } from 'next/server';
import { reviewSettingsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** GET/PUT /api/v1/admin/review/settings — SLA ageing thresholds. */
export async function GET(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => {
    const settings = await getServices().reviews.settings(actor);
    return { data: settings };
  });
}

export async function PUT(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor, requestId, ipAddress, userAgent }) => {
    const input = await parseBody(req, reviewSettingsSchema);
    const settings = await getServices().reviews.saveSettings(actor, input, {
      requestId,
      ipAddress,
      userAgent,
    });
    return { data: settings };
  });
}
