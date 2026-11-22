import { describe, expect, it } from 'vitest';
import { AppError, type Actor, type CreateStaffInput } from '@curenear/shared';
import { createInMemoryRepositories, type InMemoryStore } from '@/test/in-memory';
import { createMemoryEmailService } from '@/server/email';
import { createStaffService } from './staff-service';

const admin: Actor = { userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'ADMIN' };
const staffActor: Actor = { userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', role: 'STAFF' };
const NOON = new Date('2026-02-01T09:00:00.000Z');

const ctx = { requestId: 'req-staff', ipAddress: '203.0.113.5', userAgent: 'vitest' };

let counter = 0;
function newId(): string {
  counter += 1;
  return `00000000-0000-4000-9000-${String(counter).padStart(12, '0')}`;
}

function setup(): {
  service: ReturnType<typeof createStaffService>;
  store: InMemoryStore;
  email: ReturnType<typeof createMemoryEmailService>;
} {
  const { repositories, store } = createInMemoryRepositories();
  const email = createMemoryEmailService();
  const service = createStaffService({
    repositories,
    unitOfWork: { transaction: (work) => work(repositories) },
    now: () => NOON,
    newId,
    email,
    appUrl: 'http://localhost:3000',
  });
  return { service, store, email };
}

function staffInput(overrides: Partial<CreateStaffInput> = {}): CreateStaffInput {
  counter += 1;
  return {
    name: 'Riya Das',
    email: `riya.${counter}@curenear.in`,
    mobile: '9876543210',
    employeeCode: `EMP${counter}`,
    pinCodes: ['700016', '700017'],
    ...overrides,
  };
}

async function create(service: ReturnType<typeof createStaffService>, input = staffInput()) {
  return service.create(admin, input, ctx);
}

describe('staff service', () => {
  it('creates a staff account with a temporary password, audit row and event', async () => {
    const { service, store, email } = setup();
    const input = staffInput();

    const { staff, temporaryPassword } = await create(service, input);

    expect(temporaryPassword).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(staff.role).toBe('STAFF');
    expect(staff.status).toBe('ACTIVE');
    expect(staff.mustChangePassword).toBe(true);
    expect(staff.mobile).toBe(input.mobile);
    expect(staff.employeeCode).toBe(input.employeeCode);
    expect(staff.pinCodes).toEqual(['700016', '700017']);
    expect(staff.createdByUserId).toBe(admin.userId);

    const row = store.users.find((user) => user.id === staff.id);
    expect(row?.mustChangePassword).toBe(true);
    expect(row?.status).toBe('ACTIVE');

    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]).toMatchObject({
      action: 'staff.created',
      entityType: 'user',
      entityId: staff.id,
      actorUserId: admin.userId,
    });

    expect(store.outbox).toHaveLength(1);
    expect(store.outbox[0]?.eventType).toBe('staff.created');
    expect(store.outbox[0]?.aggregateType).toBe('staff');
    expect(store.outbox[0]?.payload).toMatchObject({
      staffUserId: staff.id,
      role: 'STAFF',
      actorUserId: admin.userId,
    });
    // Minimum data: the event never carries the name or the address.
    expect(Object.keys(store.outbox[0]?.payload ?? {})).not.toContain('email');
    expect(Object.keys(store.outbox[0]?.payload ?? {})).not.toContain('name');

    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]?.to).toBe(input.email);
    expect(email.sent[0]?.text).toContain(temporaryPassword);
  });

  it('refuses a duplicate email or employee code', async () => {
    const { service } = setup();
    const first = await create(service, staffInput({ employeeCode: 'EMP-UNIQUE-1' }));

    await expect(
      create(
        service,
        staffInput({ email: first.staff.email, employeeCode: 'EMP-UNIQUE-2', pinCodes: [] }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    await expect(
      create(service, staffInput({ employeeCode: 'EMP-UNIQUE-1', pinCodes: [] })),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('keeps staff accounts out of every management operation', async () => {
    const { service } = setup();
    const { staff } = await create(service);

    await expect(
      service.list(staffActor, { page: 1, pageSize: 20, sort: 'name', order: 'asc' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.get(staffActor, staff.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.create(staffActor, staffInput(), ctx)).rejects.toBeInstanceOf(AppError);
    await expect(
      service.update(staffActor, staff.id, { name: 'Someone Else' }, ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.deactivate(staffActor, staff.id, 'nope', ctx)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(service.reactivate(staffActor, staff.id, ctx)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(service.resetPassword(staffActor, staff.id, ctx)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(service.remove(staffActor, staff.id, 'nope', ctx)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('replaces territory PINs on update and records the changed fields', async () => {
    const { service, store } = setup();
    const { staff } = await create(service);

    const updated = await service.update(
      admin,
      staff.id,
      { name: 'Riya Das Gupta', pinCodes: ['700091', '700091', '700092'] },
      ctx,
    );

    expect(updated.name).toBe('Riya Das Gupta');
    expect(updated.pinCodes).toEqual(['700091', '700092']);
    expect(updated.version).toBe(2);

    const audit = store.audits.find((entry) => entry.action === 'staff.updated');
    expect(audit?.changedFieldKeys).toEqual(['name', 'pinCodes']);
    expect(store.outbox.at(-1)?.eventType).toBe('staff.updated');
  });

  it('revokes every session the moment an account is deactivated', async () => {
    const { service, store } = setup();
    const { staff } = await create(service);

    store.sessions.push({
      id: 'sess-1',
      userId: staff.id,
      tokenHash: 'hash-1',
      expiresAt: new Date(NOON.getTime() + 3_600_000),
      createdAt: NOON,
      lastSeenAt: null,
      revokedAt: null,
      role: 'STAFF',
      mustChangePassword: false,
      user: {
        id: staff.id,
        email: staff.email,
        name: staff.name,
        role: 'STAFF',
        isActive: true,
        createdAt: NOON,
        deletedAt: null,
      },
    });

    const deactivated = await service.deactivate(admin, staff.id, 'Left the organisation', ctx);

    expect(deactivated.status).toBe('INACTIVE');
    expect(store.sessions[0]?.revokedAt).toBeInstanceOf(Date);
    expect(store.audits.at(-1)).toMatchObject({
      action: 'staff.deactivated',
      reason: 'Left the organisation',
    });
    expect(store.outbox.at(-1)).toMatchObject({ eventType: 'staff.deactivated' });
    expect(store.outbox.at(-1)?.payload).toMatchObject({ active: false });
  });

  it('issues a new temporary password on reset and ends existing sessions', async () => {
    const { service, store, email } = setup();
    const { staff, temporaryPassword } = await create(service);

    store.sessions.push({
      id: 'sess-2',
      userId: staff.id,
      tokenHash: 'hash-2',
      expiresAt: new Date(NOON.getTime() + 3_600_000),
      createdAt: NOON,
      lastSeenAt: null,
      revokedAt: null,
      role: 'STAFF',
      mustChangePassword: false,
      user: {
        id: staff.id,
        email: staff.email,
        name: staff.name,
        role: 'STAFF',
        isActive: true,
        createdAt: NOON,
        deletedAt: null,
      },
    });

    const result = await service.resetPassword(admin, staff.id, ctx);

    expect(result.temporaryPassword).toHaveLength(19);
    expect(result.temporaryPassword).not.toBe(temporaryPassword);
    expect(result.staff.mustChangePassword).toBe(true);
    expect(store.sessions[0]?.revokedAt).toBeInstanceOf(Date);
    expect(store.users.find((row) => row.id === staff.id)?.mustChangePassword).toBe(true);
    expect(store.audits.at(-1)?.action).toBe('staff.password_reset');
    expect(store.outbox.at(-1)?.eventType).toBe('staff.updated');
    expect(email.sent.at(-1)?.text).toContain(result.temporaryPassword);
  });

  it('soft deletes an account out of the directory while keeping the row', async () => {
    const { service, store } = setup();
    const { staff } = await create(service);

    const removed = await service.remove(admin, staff.id, 'Duplicate account', ctx);

    expect(removed.deletedAt).toBeInstanceOf(Date);
    const listed = await service.list(admin, {
      page: 1,
      pageSize: 20,
      sort: 'name',
      order: 'asc',
    });
    expect(listed.rows.map((row) => row.id)).not.toContain(staff.id);

    // The row survives for the audit trail, but the account is gone.
    expect(store.users.some((row) => row.id === staff.id && row.deletedAt !== null)).toBe(true);
  });

  it('refuses to let an admin deactivate or delete themselves', async () => {
    const { service, store } = setup();
    const self: Actor = admin;
    store.users.push({
      id: self.userId,
      email: 'admin@curenear.in',
      name: 'Admin',
      role: 'ADMIN',
      isActive: true,
      status: 'ACTIVE',
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
      createdAt: NOON,
      deletedAt: null,
      passwordHash: 'x',
    });

    await expect(service.deactivate(admin, admin.userId, 'self', ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(service.remove(admin, admin.userId, 'self', ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});
