import { generateTemporaryPassword, hashPassword } from '@curenear/db';
import {
  AppError,
  can,
  outboxEventVersions,
  pageMeta,
  type Actor,
  type AuditEntry,
  type CreateStaffInput,
  type ListStaffQuery,
  type StaffMemberRecord,
  type UpdateStaffInput,
} from '@curenear/shared';
import type { EmailService } from '@/server/email';
import type { RequestContext, ServiceDeps } from './service-deps';

/**
 * Admin-only staff management. A "staff member" is a User with role STAFF plus
 * territory PINs; the PINs are reference data and never gate access.
 */

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

function assertStaffManager(actor: Actor): void {
  if (!can({ id: actor.userId, role: actor.role }, 'staff.manage')) {
    throw new AppError('FORBIDDEN', 'Only administrators can manage staff accounts');
  }
}

export interface StaffDetail {
  staff: StaffMemberRecord;
  /** Providers this person onboarded; 0 until they start working. */
  providerCount: number;
  recentAudit: AuditEntry[];
}

export interface CreatedStaff {
  staff: StaffMemberRecord;
  /** Returned exactly once so the admin can hand it over securely. */
  temporaryPassword: string;
}

export interface StaffListResult {
  rows: StaffMemberRecord[];
  meta: ReturnType<typeof pageMeta>;
}

export function createStaffService(
  deps: Pick<ServiceDeps, 'repositories' | 'unitOfWork' | 'now' | 'newId'> & {
    email: EmailService;
    appUrl: string;
  },
) {
  const { repositories, unitOfWork, now, newId, email, appUrl } = deps;

  async function audit(
    tx: { audits: ServiceDeps['repositories']['audits'] },
    input: {
      actor: Actor;
      action: string;
      staffUserId: string;
      changedFieldKeys?: string[];
      reason?: string | null;
      ctx: RequestContext;
    },
  ): Promise<void> {
    await tx.audits.append({
      id: newId(),
      actorUserId: input.actor.userId,
      actorRole: input.actor.role,
      action: input.action,
      entityType: 'user',
      entityId: input.staffUserId,
      requestId: input.ctx.requestId,
      changedFieldKeys: input.changedFieldKeys ?? [],
      fromStatus: null,
      toStatus: null,
      reason: input.reason ?? null,
      ipAddress: input.ctx.ipAddress,
      userAgent: input.ctx.userAgent,
      createdAt: now(),
    });
  }

  async function emit(
    tx: { outbox: ServiceDeps['repositories']['outbox'] },
    eventType: 'staff.created' | 'staff.updated' | 'staff.deactivated',
    payload: {
      staffUserId: string;
      actorUserId: string;
      active?: boolean;
      deleted?: boolean;
      changedFieldKeys?: string[];
    },
  ): Promise<void> {
    await tx.outbox.append({
      id: newId(),
      eventType,
      eventVersion: outboxEventVersions[eventType],
      aggregateType: 'staff',
      aggregateId: payload.staffUserId,
      payload: { role: 'STAFF', ...payload },
      occurredAt: now(),
    });
  }

  async function sendCredentials(
    staff: StaffMemberRecord,
    temporaryPassword: string,
    purpose: 'created' | 'reset',
  ): Promise<void> {
    const loginUrl = `${appUrl.replace(/\/$/, '')}/login`;
    await email.send({
      to: staff.email,
      subject:
        purpose === 'created'
          ? 'Your CureNear onboarding account'
          : 'Your CureNear password was reset',
      text: [
        `Hello ${staff.name},`,
        '',
        purpose === 'created'
          ? 'An administrator created a CureNear onboarding account for you.'
          : 'An administrator reset the password for your CureNear onboarding account.',
        '',
        `Sign in at ${loginUrl}`,
        `Email: ${staff.email}`,
        `Temporary password: ${temporaryPassword}`,
        '',
        'You will be asked to choose a new password before you can use the portal.',
      ].join('\n'),
    });
  }

  async function loadStaff(id: string): Promise<StaffMemberRecord> {
    const staff = await repositories.staff.findById(id);
    if (!staff) throw new AppError('NOT_FOUND', 'Staff member not found');
    return staff;
  }

  return {
    async list(actor: Actor, query: ListStaffQuery): Promise<StaffListResult> {
      assertStaffManager(actor);
      const { rows, total } = await repositories.staff.list(
        {
          ...(query.q ? { search: query.q } : {}),
          ...(query.status ? { status: query.status } : {}),
        },
        { skip: (query.page - 1) * query.pageSize, take: query.pageSize },
      );
      return {
        rows,
        meta: pageMeta({
          page: query.page,
          pageSize: query.pageSize,
          total,
          sort: query.sort,
          order: query.order,
        }),
      };
    },

    async get(actor: Actor, id: string): Promise<StaffDetail> {
      assertStaffManager(actor);
      const staff = await loadStaff(id);
      const [providerCount, recentAudit] = await Promise.all([
        repositories.staff.countProviders(id),
        repositories.audits.listForEntity('user', id, 20),
      ]);
      return { staff, providerCount, recentAudit };
    },

    async create(
      actor: Actor,
      input: CreateStaffInput,
      ctx: RequestContext,
    ): Promise<CreatedStaff> {
      assertStaffManager(actor);

      if (await repositories.staff.findByEmail(input.email)) {
        throw new AppError('CONFLICT', 'A staff member with this email already exists');
      }
      if (await repositories.staff.findByEmployeeCode(input.employeeCode)) {
        throw new AppError('CONFLICT', 'This employee code is already in use');
      }

      const temporaryPassword = generateTemporaryPassword();
      const passwordHash = await hashPassword(temporaryPassword);

      let staff: StaffMemberRecord;
      try {
        staff = await unitOfWork.transaction(async (tx) => {
          const created = await tx.staff.create({
            id: newId(),
            email: input.email,
            name: input.name,
            mobile: input.mobile,
            employeeCode: input.employeeCode,
            passwordHash,
            createdByUserId: actor.userId,
            pinCodes: input.pinCodes ?? [],
          });

          await audit(tx, {
            actor,
            action: 'staff.created',
            staffUserId: created.id,
            changedFieldKeys: ['name', 'email', 'mobile', 'employeeCode', 'pinCodes'],
            ctx,
          });
          await emit(tx, 'staff.created', {
            staffUserId: created.id,
            actorUserId: actor.userId,
            active: true,
          });

          return created;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError('CONFLICT', 'That email or employee code is already in use');
        }
        throw error;
      }

      await sendCredentials(staff, temporaryPassword, 'created');
      return { staff, temporaryPassword };
    },

    async update(
      actor: Actor,
      id: string,
      input: UpdateStaffInput,
      ctx: RequestContext,
    ): Promise<StaffMemberRecord> {
      assertStaffManager(actor);
      const existing = await loadStaff(id);

      if (input.employeeCode && input.employeeCode !== existing.employeeCode) {
        const holder = await repositories.staff.findByEmployeeCode(input.employeeCode);
        if (holder && holder.id !== id) {
          throw new AppError('CONFLICT', 'This employee code is already in use');
        }
      }

      const changedFieldKeys = (['name', 'mobile', 'employeeCode', 'pinCodes'] as const).filter(
        (key) => input[key] !== undefined,
      );

      try {
        return await unitOfWork.transaction(async (tx) => {
          const updated = await tx.staff.update({
            id,
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.mobile === undefined ? {} : { mobile: input.mobile }),
            ...(input.employeeCode === undefined ? {} : { employeeCode: input.employeeCode }),
            ...(input.pinCodes === undefined ? {} : { pinCodes: input.pinCodes }),
          });
          if (!updated) throw new AppError('NOT_FOUND', 'Staff member not found');

          await audit(tx, {
            actor,
            action: 'staff.updated',
            staffUserId: id,
            changedFieldKeys: [...changedFieldKeys],
            ctx,
          });
          await emit(tx, 'staff.updated', {
            staffUserId: id,
            actorUserId: actor.userId,
            changedFieldKeys: [...changedFieldKeys],
          });

          return updated;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError('CONFLICT', 'This employee code is already in use');
        }
        throw error;
      }
    },

    /** Deactivation ends every session immediately, in the same transaction. */
    async deactivate(
      actor: Actor,
      id: string,
      reason: string,
      ctx: RequestContext,
    ): Promise<StaffMemberRecord> {
      assertStaffManager(actor);
      if (id === actor.userId) {
        throw new AppError('CONFLICT', 'You cannot deactivate your own account');
      }
      const existing = await loadStaff(id);
      if (existing.deletedAt) throw new AppError('NOT_FOUND', 'Staff member not found');

      return unitOfWork.transaction(async (tx) => {
        const staff = await tx.staff.setStatus({ id, status: 'INACTIVE' });
        if (!staff) throw new AppError('NOT_FOUND', 'Staff member not found');
        await tx.sessions.revokeAllForUser(id, now());

        await audit(tx, {
          actor,
          action: 'staff.deactivated',
          staffUserId: id,
          reason,
          ctx,
        });
        await emit(tx, 'staff.deactivated', {
          staffUserId: id,
          actorUserId: actor.userId,
          active: false,
        });

        return staff;
      });
    },

    async reactivate(actor: Actor, id: string, ctx: RequestContext): Promise<StaffMemberRecord> {
      assertStaffManager(actor);
      const existing = await loadStaff(id);
      if (existing.deletedAt) throw new AppError('NOT_FOUND', 'Staff member not found');

      return unitOfWork.transaction(async (tx) => {
        const staff = await tx.staff.setStatus({ id, status: 'ACTIVE' });
        if (!staff) throw new AppError('NOT_FOUND', 'Staff member not found');

        await audit(tx, {
          actor,
          action: 'staff.reactivated',
          staffUserId: id,
          changedFieldKeys: ['status'],
          ctx,
        });
        await emit(tx, 'staff.updated', {
          staffUserId: id,
          actorUserId: actor.userId,
          active: true,
          changedFieldKeys: ['status'],
        });

        return staff;
      });
    },

    /**
     * Admin-triggered reset: a fresh temporary password is shown once, mailed, and
     * every existing session is revoked. The account must change it at sign-in.
     */
    async resetPassword(
      actor: Actor,
      id: string,
      ctx: RequestContext,
    ): Promise<{ staff: StaffMemberRecord; temporaryPassword: string }> {
      assertStaffManager(actor);
      const existing = await loadStaff(id);

      const temporaryPassword = generateTemporaryPassword();
      const passwordHash = await hashPassword(temporaryPassword);

      const staff = await unitOfWork.transaction(async (tx) => {
        await tx.users.setPassword({ id, passwordHash, mustChangePassword: true });
        await tx.sessions.revokeAllForUser(id, now());
        const updated = await tx.staff.findById(id);
        if (!updated) throw new AppError('NOT_FOUND', 'Staff member not found');

        await audit(tx, {
          actor,
          action: 'staff.password_reset',
          staffUserId: id,
          changedFieldKeys: ['password'],
          ctx,
        });
        await emit(tx, 'staff.updated', {
          staffUserId: id,
          actorUserId: actor.userId,
          changedFieldKeys: ['password'],
        });

        return updated;
      });

      await sendCredentials({ ...staff, email: existing.email }, temporaryPassword, 'reset');
      return { staff, temporaryPassword };
    },

    /** Soft delete keeps the row (and its audit trail) but removes the account. */
    async remove(
      actor: Actor,
      id: string,
      reason: string,
      ctx: RequestContext,
    ): Promise<StaffMemberRecord> {
      assertStaffManager(actor);
      if (id === actor.userId) {
        throw new AppError('CONFLICT', 'You cannot delete your own account');
      }
      await loadStaff(id);

      return unitOfWork.transaction(async (tx) => {
        const staff = await tx.staff.setStatus({ id, status: 'INACTIVE', deletedAt: now() });
        if (!staff) throw new AppError('NOT_FOUND', 'Staff member not found');
        await tx.sessions.revokeAllForUser(id, now());

        await audit(tx, {
          actor,
          action: 'staff.deleted',
          staffUserId: id,
          reason,
          ctx,
        });
        await emit(tx, 'staff.deactivated', {
          staffUserId: id,
          actorUserId: actor.userId,
          active: false,
          deleted: true,
        });

        return staff;
      });
    },
  };
}

export type StaffService = ReturnType<typeof createStaffService>;
