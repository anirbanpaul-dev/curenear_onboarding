import { isStaffEditableStatus, type ProviderStatus, type Role } from './enums';

/**
 * Central role-based access control. Every handler, service and server component
 * asks `can()` — nothing branches on `role === 'ADMIN'` inline.
 *
 * `.own` permissions are scoped to records whose `created_by_user_id` equals the
 * caller. Pass the record when you have it; pass nothing for a collection query,
 * where the caller must narrow the query to the user's own rows.
 */

export const permissionNames = [
  'staff.manage',
  'master.manage',
  'provider.create',
  'provider.read.own',
  'provider.read.all',
  'provider.update.own',
  'provider.submit.own',
  'provider.delete.own',
  'provider.review',
  'provider.verify',
  'report.export',
  'audit.read',
  'apikey.manage',
  'system.manage',
] as const;

export type Permission = (typeof permissionNames)[number];

export interface RbacUser {
  id: string;
  role: Role;
}

/** Accepts both the RBAC shape and the API `Actor` ({ userId, role }). */
export type RbacSubject = RbacUser | { userId: string; role: Role };

function subjectId(user: RbacSubject): string {
  return 'id' in user ? user.id : user.userId;
}

export interface RbacResource {
  ownerUserId?: string | null;
  status?: ProviderStatus | null;
}

/** Administrators hold every permission; staff get exactly this set. */
const STAFF_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  'provider.create',
  'provider.read.own',
  'provider.update.own',
  'provider.submit.own',
  'provider.delete.own',
]);

export function permissionsFor(user: RbacSubject): Permission[] {
  if (user.role === 'ADMIN') return [...permissionNames];
  if (user.role === 'STAFF') return [...STAFF_PERMISSIONS];
  return [];
}

export function can(
  user: RbacSubject | null | undefined,
  permission: Permission,
  resource?: RbacResource,
): boolean {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  if (user.role !== 'STAFF') return false;
  if (!STAFF_PERMISSIONS.has(permission)) return false;

  if (!permission.endsWith('.own')) return true;

  // Collection-level check: the query itself is restricted to the caller's rows.
  if (!resource) return true;

  // Record-level check: staff may only touch what they onboarded, and only while
  // the provider is still theirs to edit.
  if (!resource.ownerUserId || resource.ownerUserId !== subjectId(user)) return false;
  if (resource.status && !isStaffEditableStatus(resource.status)) return false;
  return true;
}

/** UI helper: first allowed destination for a role. */
export function homePathFor(user: RbacSubject): '/admin' | '/staff' {
  return user.role === 'ADMIN' ? '/admin' : '/staff';
}
