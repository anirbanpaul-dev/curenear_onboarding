import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  can,
  getServerEnv,
  homePathFor,
  type Actor,
  type RbacPermission,
  type RbacResource,
  type Role,
  type UserRecord,
} from '@curenear/shared';
import { getServices } from './services';

export interface CurrentSession {
  actor: Actor;
  user: UserRecord;
  token: string;
  mustChangePassword: boolean;
}

export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(getServerEnv().SESSION_COOKIE_NAME)?.value ?? null;
}

/**
 * The one way server components and route handlers learn who is signed in.
 * Returns null for anonymous requests; never throws for a stale cookie.
 *
 * Cached per request: layouts and pages both call this, and resolving the
 * session costs a database round trip. React drops the cache after the render,
 * so a later request (and a later sign-out) is never served a stale session.
 */
export const getCurrentUser = cache(async (): Promise<CurrentSession | null> => {
  const token = await readSessionToken();
  if (!token) return null;

  const session = await getServices().auth.resolveSession(token);
  if (!session) return null;

  return {
    actor: { userId: session.userId, role: session.role },
    user: session.user,
    token,
    mustChangePassword: session.mustChangePassword,
  };
});

/** Kept for existing pages; same contract as `getCurrentUser`. */
export const getCurrentSession = getCurrentUser;

/**
 * Pages that require a session. An account on a temporary password can only
 * reach the change-password screen until it has been replaced.
 */
export async function requireUser(): Promise<CurrentSession> {
  const session = await getCurrentUser();
  if (!session) redirect('/login');
  if (session.mustChangePassword) redirect('/change-password');
  return session;
}

export const requireSession = requireUser;

/** Role-gated layouts: /admin/* uses ADMIN, /staff/* uses STAFF. */
export async function requireRole(role: Role): Promise<CurrentSession> {
  const session = await requireUser();
  if (session.user.role !== role) redirect('/forbidden');
  return session;
}

export async function requirePermission(
  permission: RbacPermission,
  resource?: RbacResource,
): Promise<CurrentSession> {
  const session = await requireUser();
  if (!can(session.actor, permission, resource)) redirect('/forbidden');
  return session;
}

export function homePathForRole(role: Role): '/admin' | '/staff' {
  return homePathFor({ id: '', role });
}

export function isAdmin(role: Actor['role']): boolean {
  return role === 'ADMIN';
}
