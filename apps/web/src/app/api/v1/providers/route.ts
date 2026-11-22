import type { NextRequest } from 'next/server';
import { createOrganizationSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { idempotencyKeyFrom, parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/**
 * Normalized provider onboarding. The portal's flat provider records live on
 * `/api/v1/legacy/providers`; this path is only the normalized model.
 */

export async function GET(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor }) => ({
    data: await getServices().onboarding.list(actor),
  }));
}

export async function POST(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor, requestId, ipAddress, userAgent }) => {
    const input = await parseBody(req, createOrganizationSchema);
    const idempotencyKey = idempotencyKeyFrom(req);
    const { provider, warnings, replayed } = await getServices().onboarding.create(
      actor,
      input,
      { requestId, ipAddress, userAgent },
      idempotencyKey,
    );
    return {
      data: { provider, duplicateWarnings: warnings },
      status: replayed ? 200 : 201,
      meta: { idempotentReplay: replayed },
    };
  });
}
