import { NextResponse } from 'next/server';
import { AppError, errorBody, getServerEnv, successBody, type PageMeta } from '@curenear/shared';
import { fromAppError, isHttpError } from './errors';

export interface ApiCookie {
  name: string;
  value: string;
  maxAgeSeconds: number;
  /** Defaults: HttpOnly on, Secure on, SameSite=Lax. */
  httpOnly?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  secure?: boolean;
}

export interface ApiResult {
  data: unknown;
  meta?: PageMeta | Record<string, unknown>;
  status?: number;
  headers?: Record<string, string>;
  cookies?: ApiCookie[];
  clearCookies?: string[];
}

/** `{ data, meta?, requestId }` with request id and no-store headers. */
export function jsonSuccess(result: ApiResult, requestId: string): NextResponse {
  const response = NextResponse.json(successBody(result.data, requestId, result.meta), {
    status: result.status ?? 200,
  });
  response.headers.set('x-request-id', requestId);
  response.headers.set('cache-control', 'no-store');

  for (const [name, value] of Object.entries(result.headers ?? {})) {
    response.headers.set(name, value);
  }

  const httpsApp = getServerEnv().APP_URL.startsWith('https://');
  for (const cookie of result.cookies ?? []) {
    response.cookies.set({
      name: cookie.name,
      value: cookie.value,
      httpOnly: cookie.httpOnly ?? true,
      sameSite: cookie.sameSite ?? 'lax',
      // Session cookies are Secure everywhere; localhost is a trustworthy origin,
      // so browsers still accept them over http during development.
      secure: cookie.secure ?? true,
      path: '/',
      maxAge: cookie.maxAgeSeconds,
    });
  }
  void httpsApp;
  for (const name of result.clearCookies ?? []) {
    response.cookies.set({ name, value: '', httpOnly: true, path: '/', maxAge: 0 });
  }

  return response;
}

/** `{ error: { code, message, details?, requestId } }` with the mapped status. */
export function jsonFailure(error: unknown, requestId: string): NextResponse {
  if (isHttpError(error)) {
    const response = NextResponse.json(errorBody(fromAppError(error), requestId), {
      status: error.status,
    });
    response.headers.set('x-request-id', requestId);
    response.headers.set('cache-control', 'no-store');
    return response;
  }

  if (error instanceof AppError) {
    const response = NextResponse.json(errorBody(error, requestId), { status: error.status });
    response.headers.set('x-request-id', requestId);
    response.headers.set('cache-control', 'no-store');
    return response;
  }

  const internal = new AppError('INTERNAL_ERROR', 'Something went wrong. Try again.');
  const response = NextResponse.json(errorBody(internal, requestId), { status: 500 });
  response.headers.set('x-request-id', requestId);
  response.headers.set('cache-control', 'no-store');
  return response;
}
