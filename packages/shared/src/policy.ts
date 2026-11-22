import { AppError } from './errors';
import { isStaffEditableStatus, type ProviderStatus, type Role } from './enums';
import { can, type Permission as RbacPermission } from './rbac';

/**
 * Compatibility layer over `rbac.ts`. Existing services call
 * `assertAuthorized(actor, 'provider:update', facts)` and receive the data scope
 * they must apply; the decision itself lives in the permission matrix.
 */

export const permissions = [
  'provider:read',
  'provider:create',
  'provider:update',
  'provider:delete',
  'provider:submit',
  'provider:review',
  'provider:verify',
  'provider:suspend',
  'provider:publish',
  'provider:terminate',
  'user:read',
  'user:create',
  'user:deactivate',
  'audit:read',
  'analytics:read',
] as const;
export type Permission = (typeof permissions)[number];

export interface Actor {
  userId: string;
  role: Role;
}

export interface ResourceFacts {
  /** Provider.createdByUserId. Absent for collection-level checks. */
  ownerUserId?: string | null;
  status?: ProviderStatus | null;
}

export type DataScope = 'all' | 'own';

export interface Authorization {
  allowed: boolean;
  scope: DataScope;
  reason: string;
}

const allow = (scope: DataScope): Authorization => ({
  allowed: true,
  scope,
  reason: 'allowed',
});
const deny = (reason: string): Authorization => ({ allowed: false, scope: 'own', reason });

function mapPermission(actor: Actor, permission: Permission): RbacPermission {
  switch (permission) {
    case 'provider:read':
      return actor.role === 'ADMIN' ? 'provider.read.all' : 'provider.read.own';
    case 'provider:create':
      return 'provider.create';
    case 'provider:update':
      return 'provider.update.own';
    case 'provider:submit':
      return 'provider.submit.own';
    case 'provider:delete':
      return 'provider.delete.own';
    case 'provider:review':
      return 'provider.review';
    case 'provider:verify':
      return 'provider.verify';
    case 'provider:suspend':
    case 'provider:publish':
    case 'provider:terminate':
      return 'provider.review';
    case 'user:read':
    case 'user:create':
    case 'user:deactivate':
      return 'staff.manage';
    case 'audit:read':
      return 'audit.read';
    case 'analytics:read':
      return 'report.export';
  }
}

export function authorize(
  actor: Actor,
  permission: Permission,
  facts: ResourceFacts = {},
): Authorization {
  if (actor.role === 'ADMIN') return allow('all');
  if (actor.role !== 'STAFF') return deny('Unknown role');

  const target = mapPermission(actor, permission);
  const requiresStatus =
    permission === 'provider:update' ||
    permission === 'provider:submit' ||
    permission === 'provider:delete';
  const isRead = permission === 'provider:read';

  if (requiresStatus && !facts.status) return deny('Provider status is required');

  const decision = can(
    { id: actor.userId, role: actor.role },
    target,
    facts.ownerUserId ? { ownerUserId: facts.ownerUserId, status: facts.status } : undefined,
  );

  if (!decision) {
    if (target.endsWith('.own') && facts.ownerUserId && facts.ownerUserId !== actor.userId) {
      return deny(
        isRead
          ? 'Staff may only read providers they onboarded'
          : 'Staff may only edit providers they onboarded',
      );
    }
    if (target.endsWith('.own') && facts.status && !isStaffEditableStatus(facts.status)) {
      return deny(
        isRead
          ? 'Staff may only read providers in draft or changes requested'
          : 'Staff may only edit providers in draft or changes requested',
      );
    }
    return deny(`Staff may not perform ${permission}`);
  }

  return allow('own');
}

export function assertAuthorized(
  actor: Actor,
  permission: Permission,
  facts: ResourceFacts = {},
): Authorization {
  const decision = authorize(actor, permission, facts);
  if (!decision.allowed) {
    throw new AppError('FORBIDDEN', decision.reason);
  }
  return decision;
}
