import type { Prisma } from '@prisma/client';
import type { StaffMemberRecord, StaffRepository } from '@curenear/shared';
import type { DbClient } from '../client';
import { mapStaff } from '../mappers';

/** Territory PINs travel with every staff row; they are small and always needed. */
const withPins = {
  pinAssignments: { select: { pinCode: true }, orderBy: { pinCode: 'asc' } },
} as const;

export function createStaffRepository(db: DbClient): StaffRepository {
  async function load(id: string): Promise<StaffMemberRecord | null> {
    const row = await db.user.findUnique({ where: { id }, include: withPins });
    return row ? mapStaff(row) : null;
  }

  return {
    async findById(id, options) {
      const row = await db.user.findFirst({
        where: { id, ...(options?.includeDeleted ? {} : { deletedAt: null }) },
        include: withPins,
      });
      return row ? mapStaff(row) : null;
    },

    async findByEmail(email) {
      const row = await db.user.findFirst({
        where: { email: email.toLowerCase() },
        include: withPins,
      });
      return row ? mapStaff(row) : null;
    },

    async findByEmployeeCode(employeeCode) {
      const row = await db.user.findFirst({
        where: { employeeCode },
        include: withPins,
      });
      return row ? mapStaff(row) : null;
    },

    async list(filters, page) {
      const search = filters.search?.trim();
      const where: Prisma.UserWhereInput = {
        deletedAt: null,
        role: 'STAFF',
        ...(filters.status ? { status: filters.status } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { employeeCode: { contains: search, mode: 'insensitive' } },
                { mobile: { contains: search } },
              ],
            }
          : {}),
      };

      const [rows, total] = await Promise.all([
        db.user.findMany({
          where,
          include: withPins,
          orderBy: [{ name: 'asc' }],
          skip: page.skip,
          take: page.take,
        }),
        db.user.count({ where }),
      ]);

      return { rows: rows.map(mapStaff), total };
    },

    async create(input) {
      const row = await db.user.create({
        data: {
          id: input.id,
          email: input.email.toLowerCase(),
          name: input.name,
          mobile: input.mobile,
          employeeCode: input.employeeCode,
          passwordHash: input.passwordHash,
          role: 'STAFF',
          status: 'ACTIVE',
          mustChangePassword: true,
          createdByUserId: input.createdByUserId,
          pinAssignments: {
            create: input.pinCodes.map((pinCode) => ({ pinCode })),
          },
        },
        include: withPins,
      });
      return mapStaff(row);
    },

    async update(input) {
      await db.user.update({
        where: { id: input.id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.mobile === undefined ? {} : { mobile: input.mobile }),
          ...(input.employeeCode === undefined ? {} : { employeeCode: input.employeeCode }),
          version: { increment: 1 },
        },
      });

      if (input.pinCodes !== undefined) {
        // Replacing the set keeps the unique (staff, pin) pair honest.
        await db.staffPinAssignment.deleteMany({ where: { staffUserId: input.id } });
        if (input.pinCodes.length > 0) {
          await db.staffPinAssignment.createMany({
            data: [...new Set(input.pinCodes)].map((pinCode) => ({
              staffUserId: input.id,
              pinCode,
            })),
          });
        }
      }

      return load(input.id);
    },

    async setStatus(input) {
      await db.user.update({
        where: { id: input.id },
        data: {
          status: input.status,
          ...(input.deletedAt === undefined ? {} : { deletedAt: input.deletedAt }),
          version: { increment: 1 },
        },
      });
      return load(input.id);
    },

    async countProviders(staffUserId) {
      return db.providerOrganization.count({
        where: { createdByUserId: staffUserId, deletedAt: null },
      });
    },
  };
}
