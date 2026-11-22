import type { UserRepository } from '@curenear/shared';
import type { DbClient } from '../client';
import { mapUser } from '../mappers';

export function createUserRepository(db: DbClient): UserRepository {
  return {
    async findByEmail(email) {
      const row = await db.user.findFirst({
        where: { email: email.toLowerCase(), deletedAt: null },
      });
      if (!row) return null;
      return { ...mapUser(row), passwordHash: row.passwordHash };
    },

    async findForAuth(email) {
      const row = await db.user.findFirst({
        where: { email: email.toLowerCase(), deletedAt: null },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          passwordHash: true,
          mustChangePassword: true,
          failedLoginCount: true,
          lockedUntil: true,
          createdAt: true,
          deletedAt: true,
        },
      });
      return row ?? null;
    },

    async findAuthById(id) {
      const row = await db.user.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          passwordHash: true,
          mustChangePassword: true,
          failedLoginCount: true,
          lockedUntil: true,
          createdAt: true,
          deletedAt: true,
        },
      });
      return row ?? null;
    },

    async findById(id) {
      const row = await db.user.findFirst({ where: { id, deletedAt: null } });
      return row ? mapUser(row) : null;
    },

    async create(input) {
      const row = await db.user.create({
        data: {
          id: input.id,
          email: input.email.toLowerCase(),
          name: input.name,
          passwordHash: input.passwordHash,
          role: input.role,
          status: 'ACTIVE',
          mustChangePassword: input.mustChangePassword ?? false,
        },
      });
      return mapUser(row);
    },

    async list(options) {
      const where = { deletedAt: null };
      const [rows, total] = await Promise.all([
        db.user.findMany({
          where,
          orderBy: { name: 'asc' },
          skip: options.skip,
          take: options.take,
        }),
        db.user.count({ where }),
      ]);
      return { rows: rows.map(mapUser), total };
    },

    async softDelete(input) {
      const { count } = await db.user.updateMany({
        where: { id: input.id, deletedAt: null },
        data: { deletedAt: input.deletedAt, status: 'INACTIVE', version: { increment: 1 } },
      });
      if (count === 0) return null;
      const row = await db.user.findFirst({ where: { id: input.id } });
      return row ? mapUser(row) : null;
    },

    async recordFailedLogin(input) {
      await db.user.update({
        where: { id: input.id },
        data: {
          failedLoginCount: input.failedLoginCount,
          lockedUntil: input.lockedUntil,
          status: input.lockedUntil ? 'LOCKED' : undefined,
        },
      });
    },

    async recordSuccessfulLogin(input) {
      await db.user.update({
        where: { id: input.id },
        data: {
          lastLoginAt: input.lastLoginAt,
          failedLoginCount: 0,
          lockedUntil: null,
          status: 'ACTIVE',
        },
      });
    },

    async listByRole(role) {
      const rows = await db.user.findMany({
        where: { role, deletedAt: null, status: 'ACTIVE' },
        orderBy: { name: 'asc' },
      });
      return rows.map(mapUser);
    },

    async setPassword(input) {
      await db.user.update({
        where: { id: input.id },
        data: {
          passwordHash: input.passwordHash,
          mustChangePassword: input.mustChangePassword,
          failedLoginCount: 0,
          lockedUntil: null,
          status: 'ACTIVE',
        },
      });
    },
  };
}
