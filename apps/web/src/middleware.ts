import { NextResponse, type NextRequest } from 'next/server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? 'curenear_session';

/** Reachable without a session cookie; each page decides what it needs. */
const PUBLIC_PATHS = new Set([
  '/login',
  '/forgot-password',
  '/reset-password',
  '/change-password',
  '/forbidden',
]);

/** Static files in `public/` (logo, icons) must not be behind the session gate. */
const STATIC_FILE = /\.[a-zA-Z0-9]+$/;

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Tokenised confirmation links are opened by providers with no account.
  if (pathname === '/confirm' || pathname.startsWith('/confirm/')) return true;
  if (pathname === '/login/' || pathname === '/forbidden/') return true;
  if (pathname.startsWith('/_next/') || pathname === '/favicon.ico') return true;
  return STATIC_FILE.test(pathname);
}

/**
 * Two jobs: give every request a request id, and keep anonymous visitors out of
 * the portal. Role checks live in the layouts (`requireRole`) because the edge
 * runtime here cannot read the session row.
 */
export function middleware(req: NextRequest): NextResponse {
  const incoming = req.headers.get('x-request-id');
  const requestId =
    incoming && UUID_PATTERN.test(incoming) ? incoming : globalThis.crypto.randomUUID();

  const headers = new Headers(req.headers);
  headers.set('x-request-id', requestId);

  const { pathname, search } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  if (!pathname.startsWith('/api/') && !isPublic(pathname)) {
    if (!hasSession) {
      const login = new URL('/login', req.url);
      if (pathname !== '/') login.searchParams.set('next', `${pathname}${search}`);
      const redirect = NextResponse.redirect(login);
      redirect.headers.set('x-request-id', requestId);
      return redirect;
    }
  }

  const response = NextResponse.next({ request: { headers } });
  response.headers.set('x-request-id', requestId);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)'],
};
