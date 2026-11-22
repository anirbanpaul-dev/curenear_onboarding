import type { NextRequest, NextResponse } from 'next/server';
import { AppError, getServerEnv, type Actor } from '@curenear/shared';
import { logger } from '@/lib/logger';
import { getServices } from '@/server/services';
import {
  clientIp,
  isHttpError,
  jsonFailure,
  jsonSuccess,
  resolveRequestId,
  type ApiResult,
} from '@/server/http';
import { assertSameOrigin } from '@/server/http/csrf';

export type { ApiResult };

export interface RouteContext<P extends Record<string, string>> {
  req: NextRequest;
  requestId: string;
  params: P;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AuthedRouteContext<P extends Record<string, string>> extends RouteContext<P> {
  actor: Actor;
  sessionToken: string;
}

/**
 * Routes an account may still use while it owes a password change. Everything
 * else is refused so a temporary password cannot be used to work in the portal.
 */
const ALLOWED_WHILE_PASSWORD_CHANGE = [
  '/auth/change-password',
  '/auth/logout',
  '/auth/logout-all',
  '/auth/me',
];

function passwordChangePending(pathname: string): boolean {
  return !ALLOWED_WHILE_PASSWORD_CHANGE.some((suffix) => pathname.endsWith(suffix));
}

function logUnexpected(error: unknown, requestId: string, path: string): void {
  if (isHttpError(error) || error instanceof AppError) return;
  // Never log request bodies or personal data — identifiers only.
  logger.error(
    { requestId, path, err: error instanceof Error ? error.message : 'unknown' },
    'api_error',
  );
}

/** Authenticated route: resolves the session cookie or returns 401. */
export async function handleAuthedRequest<P extends Record<string, string>>(
  req: NextRequest,
  params: P,
  handler: (ctx: AuthedRouteContext<P>) => Promise<ApiResult>,
): Promise<NextResponse> {
  const requestId = resolveRequestId(req);
  const started = Date.now();

  try {
    assertSameOrigin(req);

    const cookieName = getServerEnv().SESSION_COOKIE_NAME;
    const token = req.cookies.get(cookieName)?.value ?? null;
    const session = token ? await getServices().auth.resolveSession(token) : null;
    if (!session || !token) {
      throw new AppError('UNAUTHENTICATED', 'Sign in to continue');
    }

    if (session.mustChangePassword && passwordChangePending(req.nextUrl.pathname)) {
      throw new AppError('PASSWORD_CHANGE_REQUIRED', 'Choose a new password before continuing');
    }

    const result = await handler({
      req,
      requestId,
      params,
      ipAddress: clientIp(req),
      userAgent: req.headers.get('user-agent'),
      actor: { userId: session.userId, role: session.role },
      sessionToken: token,
    });

    logger.info(
      {
        requestId,
        method: req.method,
        path: req.nextUrl.pathname,
        actorUserId: session.userId,
        status: result.status ?? 200,
        durationMs: Date.now() - started,
      },
      'api_request',
    );
    return jsonSuccess(result, requestId);
  } catch (error) {
    logUnexpected(error, requestId, req.nextUrl.pathname);
    return jsonFailure(error, requestId);
  }
}

/** Public route (login, password reset, probes). No session required. */
export async function handlePublicRequest<P extends Record<string, string>>(
  req: NextRequest,
  params: P,
  handler: (ctx: RouteContext<P>) => Promise<ApiResult>,
): Promise<NextResponse> {
  const requestId = resolveRequestId(req);
  try {
    assertSameOrigin(req);
    const result = await handler({
      req,
      requestId,
      params,
      ipAddress: clientIp(req),
      userAgent: req.headers.get('user-agent'),
    });
    return jsonSuccess(result, requestId);
  } catch (error) {
    logUnexpected(error, requestId, req.nextUrl.pathname);
    return jsonFailure(error, requestId);
  }
}
