import type { Prisma } from '@prisma/client';
import type {
  ProviderListFilters,
  ProviderPin,
  ProviderRepository,
  ProviderSort,
  ProviderStatus,
  ProviderType,
} from '@curenear/shared';
import type { DbClient } from '../client';
import { mapProvider, mapRevision, toJsonObject } from '../mappers';

function orderByFor(sort: ProviderSort): Prisma.ProviderOrderByWithRelationInput {
  switch (sort.field) {
    case 'displayName':
      return { displayName: sort.order };
    case 'status':
      return { status: sort.order };
    case 'providerType':
      return { providerType: sort.order };
    case 'updatedAt':
      return { updatedAt: sort.order };
    case 'createdAt':
    default:
      return { createdAt: sort.order };
  }
}

function whereFor(filters: ProviderListFilters): Prisma.ProviderWhereInput {
  const where: Prisma.ProviderWhereInput = { deletedAt: null };

  if (filters.search) {
    where.OR = [
      { displayName: { contains: filters.search, mode: 'insensitive' } },
      { legalName: { contains: filters.search, mode: 'insensitive' } },
      { city: { contains: filters.search, mode: 'insensitive' } },
    ];
  }
  if (filters.providerTypes && filters.providerTypes.length > 0) {
    where.providerType = { in: filters.providerTypes };
  }
  if (filters.statuses && filters.statuses.length > 0) {
    where.status = { in: filters.statuses };
  }
  if (filters.pin) {
    // Coverage filter: registered office, any location or any service area PIN.
    where.pins = { some: { pinCode: filters.pin } };
  }
  if (filters.city) {
    where.city = { equals: filters.city, mode: 'insensitive' };
  }
  if (filters.createdByUserId) {
    where.createdByUserId = filters.createdByUserId;
  }
  if (filters.createdFrom || filters.createdTo) {
    where.createdAt = {
      ...(filters.createdFrom ? { gte: filters.createdFrom } : {}),
      ...(filters.createdTo ? { lte: filters.createdTo } : {}),
    };
  }
  return where;
}

function pinRows(pins: ProviderPin[]): Array<{ pinCode: string; kind: ProviderPin['kind'] }> {
  return pins.map((pin) => ({ pinCode: pin.pinCode, kind: pin.kind }));
}

export function createProviderRepository(db: DbClient): ProviderRepository {
  return {
    async findById(id, options) {
      const row = await db.provider.findFirst({
        where: { id, ...(options?.includeDeleted ? {} : { deletedAt: null }) },
      });
      return row ? mapProvider(row) : null;
    },

    async list(filters, page, sort) {
      const where = whereFor(filters);
      const [rows, total] = await Promise.all([
        db.provider.findMany({
          where,
          orderBy: orderByFor(sort),
          skip: page.skip,
          take: page.take,
        }),
        db.provider.count({ where }),
      ]);
      return { rows: rows.map(mapProvider), total };
    },

    async create(input) {
      const row = await db.provider.create({
        data: {
          providerType: input.providerType,
          displayName: input.displayName,
          legalName: input.legalName,
          data: input.data as Prisma.InputJsonValue,
          primaryPinCode: input.primaryPinCode,
          city: input.city,
          version: input.version,
          createdByUserId: input.createdByUserId,
          pins: { create: pinRows(input.pins) },
        },
      });
      return mapProvider(row);
    },

    async updateOptimistic(input) {
      const { count } = await db.provider.updateMany({
        where: { id: input.id, version: input.expectedVersion, deletedAt: null },
        data: {
          data: input.patch.data as Prisma.InputJsonValue,
          displayName: input.patch.displayName,
          legalName: input.patch.legalName,
          primaryPinCode: input.patch.primaryPinCode,
          city: input.patch.city,
          version: { increment: 1 },
        },
      });
      if (count === 0) return null;
      const row = await db.provider.findFirst({ where: { id: input.id, deletedAt: null } });
      return row ? mapProvider(row) : null;
    },

    async changeStatus(input) {
      const data: Prisma.ProviderUncheckedUpdateManyInput = {
        status: input.toStatus,
        version: { increment: 1 },
      };
      if (input.reviewedByUserId !== null) data.reviewedByUserId = input.reviewedByUserId;
      if (input.reviewedAt !== null) data.reviewedAt = input.reviewedAt;
      if (input.decisionReason !== null) data.decisionReason = input.decisionReason;
      if (input.submittedAt !== undefined && input.submittedAt !== null) {
        data.submittedAt = input.submittedAt;
      }

      const { count } = await db.provider.updateMany({
        where: {
          id: input.id,
          version: input.expectedVersion,
          status: input.fromStatus,
          deletedAt: null,
        },
        data,
      });
      if (count === 0) return null;
      const row = await db.provider.findFirst({ where: { id: input.id, deletedAt: null } });
      return row ? mapProvider(row) : null;
    },

    async softDelete(input) {
      const { count } = await db.provider.updateMany({
        where: { id: input.id, version: input.expectedVersion, deletedAt: null },
        data: {
          deletedAt: input.deletedAt,
          decisionReason: input.reason,
          version: { increment: 1 },
        },
      });
      if (count === 0) return null;
      const row = await db.provider.findFirst({ where: { id: input.id } });
      return row ? mapProvider(row) : null;
    },

    async replacePins(providerId, pins) {
      await db.providerPinCode.deleteMany({ where: { providerId } });
      if (pins.length > 0) {
        await db.providerPinCode.createMany({
          data: pinRows(pins).map((pin) => ({ ...pin, providerId })),
          skipDuplicates: true,
        });
      }
    },

    async createRevision(input) {
      await db.providerRevision.create({
        data: {
          id: input.id,
          providerId: input.providerId,
          version: input.version,
          status: input.status,
          changedByUserId: input.changedByUserId,
          changedFieldKeys: input.changedFieldKeys,
          snapshot: input.snapshot as Prisma.InputJsonValue,
          createdAt: input.createdAt,
        },
      });
    },

    async listRevisions(providerId, limit) {
      const rows = await db.providerRevision.findMany({
        where: { providerId },
        orderBy: { version: 'desc' },
        take: limit,
      });
      return rows.map(mapRevision);
    },

    async countByStatus() {
      const rows = await db.provider.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      });
      return rows.map((row) => ({
        status: row.status as ProviderStatus,
        count: row._count._all,
      }));
    },

    async countByType() {
      const rows = await db.provider.groupBy({
        by: ['providerType'],
        where: { deletedAt: null },
        _count: { _all: true },
      });
      return rows.map((row) => ({
        providerType: row.providerType as ProviderType,
        count: row._count._all,
      }));
    },

    async topPins(limit) {
      const rows = await db.providerPinCode.groupBy({
        by: ['pinCode'],
        where: { provider: { deletedAt: null } },
        _count: { _all: true },
        orderBy: { _count: { pinCode: 'desc' } },
        take: limit,
      });
      return rows.map((row) => ({ pinCode: row.pinCode, count: row._count._all }));
    },

    async listDataForExpiryScan(limit) {
      const rows = await db.provider.findMany({
        where: {
          deletedAt: null,
          status: { in: ['submitted', 'under_review', 'approved_not_live', 'live', 'suspended'] },
        },
        select: { id: true, data: true },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      });
      return rows.map((row) => ({ id: row.id, data: toJsonObject(row.data) }));
    },
  };
}
