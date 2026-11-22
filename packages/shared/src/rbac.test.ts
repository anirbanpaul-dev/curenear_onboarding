import { describe, expect, it } from 'vitest';
import { can, homePathFor, permissionsFor } from './rbac';

const admin = { id: 'admin-1', role: 'ADMIN' as const };
const staff = { id: 'staff-1', role: 'STAFF' as const };
const otherStaff = { id: 'staff-2', role: 'STAFF' as const };

describe('rbac permission matrix', () => {
  it('gives administrators every permission', () => {
    expect(permissionsFor(admin)).toContain('staff.manage');
    expect(permissionsFor(admin)).toContain('provider.read.all');
    expect(can(admin, 'staff.manage')).toBe(true);
    expect(can(admin, 'apikey.manage')).toBe(true);
    expect(can(admin, 'provider.read.all')).toBe(true);
  });

  it('keeps staff away from administration and review', () => {
    expect(can(staff, 'staff.manage')).toBe(false);
    expect(can(staff, 'provider.review')).toBe(false);
    expect(can(staff, 'audit.read')).toBe(false);
    expect(can(staff, 'provider.read.all')).toBe(false);
    expect(can(staff, 'apikey.manage')).toBe(false);
  });

  it('allows staff to create providers and read their own collection', () => {
    expect(can(staff, 'provider.create')).toBe(true);
    expect(can(staff, 'provider.read.own')).toBe(true);
    expect(can(staff, 'provider.update.own')).toBe(true);
  });

  it('applies the ownership rule to .own permissions', () => {
    expect(can(staff, 'provider.read.own', { ownerUserId: staff.id, status: 'draft' })).toBe(true);
    expect(can(staff, 'provider.read.own', { ownerUserId: otherStaff.id, status: 'draft' })).toBe(
      false,
    );
    expect(can(staff, 'provider.update.own', { ownerUserId: staff.id, status: 'draft' })).toBe(
      true,
    );
    expect(can(staff, 'provider.update.own', { ownerUserId: staff.id, status: 'submitted' })).toBe(
      false,
    );
    expect(can(staff, 'provider.update.own', { status: 'draft' })).toBe(false);
  });

  it('denies anonymous and unknown roles', () => {
    expect(can(null, 'provider.create')).toBe(false);
    expect(can(undefined, 'provider.create')).toBe(false);
    expect(can({ id: 'x', role: 'GUEST' as never }, 'provider.create')).toBe(false);
  });

  it('maps each role to its home route', () => {
    expect(homePathFor(admin)).toBe('/admin');
    expect(homePathFor(staff)).toBe('/staff');
  });
});
