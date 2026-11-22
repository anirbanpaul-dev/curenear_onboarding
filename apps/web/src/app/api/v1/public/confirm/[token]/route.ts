import type { NextRequest } from 'next/server';
import {
  AppError,
  confirmationTokenParamsSchema,
  publicConfirmationSchema,
} from '@curenear/shared';
import { handlePublicRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';
import { createInMemoryRateLimiter } from '@/server/auth/rate-limiter';

export const dynamic = 'force-dynamic';

/** One window per process: confirmation links are low-volume and single-use. */
const limiter = createInMemoryRateLimiter();

async function assertWithinLimit(key: string, limit: number): Promise<void> {
  const result = await limiter.consume(key, {
    limit,
    windowMs: 15 * 60 * 1000,
    now: new Date(),
  });
  if (!result.allowed) {
    throw new AppError('RATE_LIMITED', 'Too many attempts. Try again later.', {
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }
}

export async function GET(req: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  return handlePublicRequest(req, { token }, async ({ params, ipAddress }) => {
    const parsed = confirmationTokenParamsSchema.parse(params);
    await assertWithinLimit(
      `confirm:read:${ipAddress ?? 'unknown'}:${parsed.token.slice(0, 8)}`,
      30,
    );
    return { data: await getServices().consents.getConfirmation(parsed.token) };
  });
}

export async function POST(req: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  return handlePublicRequest(
    req,
    { token },
    async ({ params, requestId, ipAddress, userAgent }) => {
      const parsed = confirmationTokenParamsSchema.parse(params);
      await assertWithinLimit(
        `confirm:write:${ipAddress ?? 'unknown'}:${parsed.token.slice(0, 8)}`,
        8,
      );
      const input = await parseBody(req, publicConfirmationSchema);
      return {
        data: await getServices().consents.confirm(parsed.token, input, {
          requestId,
          ipAddress,
          userAgent,
        }),
      };
    },
  );
}
