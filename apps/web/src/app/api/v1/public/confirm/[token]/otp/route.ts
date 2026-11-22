import type { NextRequest } from 'next/server';
import {
  AppError,
  confirmationOtpRequestSchema,
  confirmationTokenParamsSchema,
} from '@curenear/shared';
import { handlePublicRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';
import { createInMemoryRateLimiter } from '@/server/auth/rate-limiter';

export const dynamic = 'force-dynamic';

const limiter = createInMemoryRateLimiter();

/** Sends a one-time code to the provider contact for OTP confirmation. */
export async function POST(req: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  return handlePublicRequest(req, { token }, async ({ params, ipAddress }) => {
    const parsed = confirmationTokenParamsSchema.parse(params);
    const limit = await limiter.consume(
      `confirm:otp:${ipAddress ?? 'unknown'}:${parsed.token.slice(0, 8)}`,
      {
        limit: 5,
        windowMs: 60 * 60 * 1000,
        now: new Date(),
      },
    );
    if (!limit.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many codes requested. Try again later.', {
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }
    const input = await parseBody(req, confirmationOtpRequestSchema);
    return {
      data: await getServices().consents.requestOtp(parsed.token, input.mobile),
    };
  });
}
