import { describe, expect, it } from 'vitest';
import { authorize, assertAuthorized } from './policy';
import { AppError } from './errors';
import type { Actor } from './policy';

const admin: Actor = { userId: 'admin-1', role: 'ADMIN' };
const staff: Actor = { userId: 'staff-1', role: 'STAFF' };
const otherStaff: Actor = { userId: 'staff-2', role: 'STAFF' };

describe('central RBAC policy', () => {
  it('lets an admin perform every permission with full scope', () => {
    for (const permission of [
      'provider:read',
      'provider:review',
      'user:create',
      'audit:read',
    ] as const) {
      const decision = authorize(admin, permission);
      expect(decision.allowed).toBe(true);
      expect(decision.scope).toBe('all');
    }
  });

  it('scopes staff reads to their own providers', () => {
    expect(authorize(staff, 'provider:read').scope).toBe('own');
    expect(
      authorize(staff, 'provider:read', { ownerUserId: staff.userId, status: 'draft' }).allowed,
    ).toBe(true);
  });

  it('denies staff reads outside draft/changes_requested', () => {
    for (const status of ['submitted', 'approved_not_live', 'live', 'suspended'] as const) {
      expect(authorize(staff, 'provider:read', { ownerUserId: staff.userId, status }).allowed).toBe(
        false,
      );
    }
  });

  it('denies staff writes to providers they did not onboard', () => {
    const decision = authorize(otherStaff, 'provider:update', {
      ownerUserId: staff.userId,
      status: 'draft',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/onboarded/i);
  });

  it('denies staff writes once the provider leaves the editable states', () => {
    const decision = authorize(staff, 'provider:submit', {
      ownerUserId: staff.userId,
      status: 'submitted',
    });
    expect(decision.allowed).toBe(false);
  });

  it('never lets staff review, verify or administer accounts', () => {
    for (const permission of [
      'provider:review',
      'provider:verify',
      'provider:suspend',
      'user:create',
      'user:read',
      'audit:read',
      'analytics:read',
    ] as const) {
      expect(authorize(staff, permission).allowed).toBe(false);
    }
  });

  it('allows staff to create providers and delete their own draft', () => {
    expect(authorize(staff, 'provider:create').allowed).toBe(true);
    expect(
      authorize(staff, 'provider:delete', { ownerUserId: staff.userId, status: 'draft' }).allowed,
    ).toBe(true);
  });

  it('throws a FORBIDDEN AppError from assertAuthorized', () => {
    expect(() => assertAuthorized(staff, 'provider:review')).toThrowError(AppError);
    try {
      assertAuthorized(staff, 'provider:review');
    } catch (error) {
      expect((error as AppError).code).toBe('FORBIDDEN');
      expect((error as AppError).status).toBe(403);
    }
  });
});
