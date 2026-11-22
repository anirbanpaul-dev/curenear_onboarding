import type { NextRequest } from 'next/server';
import { pincodeParamSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseParams } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** GET /api/v1/master/pincodes/700016 — the PIN with its district and state. */
export async function GET(req: NextRequest, context: { params: Promise<{ pin: string }> }) {
  const { pin } = await context.params;
  return handleAuthedRequest(req, { pin }, async ({ actor }) => {
    const parsed = parseParams({ pin }, pincodeParamSchema);
    const row = await getServices().master.getPincode(actor, parsed.pin);
    return { data: row, headers: { 'cache-control': 'private, max-age=86400' } };
  });
}
