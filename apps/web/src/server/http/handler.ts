import { randomUUID } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { AppError } from '@curenear/shared';
import { logger } from '@/lib/logger';
import { isHttpError } from './errors';
import { jsonFailure, jsonSuccess, type ApiResult } from './envelope';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Reuses a caller-supplied request id (via middleware or proxy) when it is a UUID. */
export function resolveRequestId(req: NextRequest): string {
  const supplied = req.headers.get('x-request-id');
  return supplied && UUID_PATTERN.test(supplied) ? supplied : randomUUID();
}

export function clientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip') ?? null;
}

export interface ApiHandlerContext<P extends Record<string, string> = Record<string, never>> {
  req: NextRequest;
  requestId: string;
  params: P;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface ApiHandlerOptions {
  /** Set to false for probes that must not add log volume per poll. */
  log?: boolean;
}

/**
 * Wraps a route handler so every response carries a request id, outcomes are
 * logged structurally, and thrown errors become the API error envelope.
 *
 *   export async function GET(req: NextRequest) {
 *     return withApiHandler(async ({ requestId }) => ({ data: { requestId } }))(req);
 *   }
 */
export function withApiHandler<P extends Record<string, string> = Record<string, never>>(
  handler: (ctx: ApiHandlerContext<P>) => Promise<ApiResult> | ApiResult,
  options: ApiHandlerOptions = {},
) {
  return async (req: NextRequest, context?: { params?: Promise<P> }): Promise<NextResponse> => {
    const requestId = resolveRequestId(req);
    const started = Date.now();
    const params = ((context?.params ? await context.params : {}) ?? {}) as P;

    try {
      const result = await handler({
        req,
        requestId,
        params,
        ipAddress: clientIp(req),
        userAgent: req.headers.get('user-agent'),
      });

      if (options.log !== false) {
        logger.info(
          {
            requestId,
            method: req.method,
            path: req.nextUrl.pathname,
            status: result.status ?? 200,
            durationMs: Date.now() - started,
          },
          'api_request',
        );
      }

      return jsonSuccess(result, requestId);
    } catch (error) {
      const known = isHttpError(error) || error instanceof AppError;
      if (!known) {
        logger.error(
          {
            requestId,
            method: req.method,
            path: req.nextUrl.pathname,
            err: error instanceof Error ? error.message : 'unknown',
          },
          'api_error',
        );
      }
      return jsonFailure(error, requestId);
    }
  };
}
