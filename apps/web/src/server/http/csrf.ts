import type { NextRequest } from 'next/server';
import { AppError } from '@curenear/shared';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isMutating(req: NextRequest): boolean {
  return MUTATING_METHODS.has(req.method.toUpperCase());
}

/**
 * CSRF defence for cookie-authenticated requests: a mutation must come from our
 * own origin. Browsers always send `Origin` on fetch/form POSTs, so a cross-site
 * form cannot reach this code; non-browser clients (scripts, curl) send neither
 * header and are unaffected because they do not carry ambient cookies.
 */
export function assertSameOrigin(req: NextRequest): void {
  if (!isMutating(req)) return;

  const source = req.headers.get('origin') ?? req.headers.get('referer');
  if (!source) return;

  let sourceHost: string;
  try {
    sourceHost = new URL(source).host;
  } catch {
    throw new AppError('FORBIDDEN', 'Request origin could not be verified');
  }

  const expected = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!expected || sourceHost !== expected) {
    throw new AppError('FORBIDDEN', 'Cross-site request blocked');
  }
}
