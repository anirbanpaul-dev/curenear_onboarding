import type { Prisma, ProviderType as DbProviderType } from '@prisma/client';
import type {
  CouncilRecord,
  DistrictRecord,
  DocumentTypeRecord,
  FacilityTypeRecord,
  LicenceTypeRecord,
  MasterDataRepository,
  PincodeRecord,
  ServiceCategoryRecord,
  SpecialtyRecord,
  StateRecord,
} from '@curenear/shared';
import type { DbClient } from '../client';

const pincodeInclude = {
  district: { select: { name: true } },
  state: { select: { name: true } },
} satisfies Prisma.PinCodeInclude;

type PincodeRow = Prisma.PinCodeGetPayload<{ include: typeof pincodeInclude }>;

function mapPincode(row: PincodeRow): PincodeRecord {
  return {
    pinCode: row.pinCode,
    officeName: row.officeName,
    districtId: row.districtId,
    districtName: row.district?.name ?? null,
    stateId: row.stateId,
    stateName: row.state?.name ?? null,
    latitude: row.latitude,
    longitude: row.longitude,
    isActive: row.isActive,
  };
}

type ListFilters = {
  search?: string;
  providerType?: string;
  stateId?: string;
  includeInactive?: boolean;
};

/**
 * Code/name search plus the active flag. Every editable list has these columns,
 * so the shape spreads into each entity's Prisma `where` unchanged.
 */
type CodeNameWhere = {
  isActive?: boolean;
  OR?: Array<
    | { code: { contains: string; mode: 'insensitive' } }
    | { name: { contains: string; mode: 'insensitive' } }
  >;
};

function baseWhere(filters: ListFilters): CodeNameWhere {
  const search = filters.search?.trim();
  return {
    ...(filters.includeInactive ? {} : { isActive: true }),
    ...(search
      ? {
          OR: [
            { code: { contains: search, mode: 'insensitive' as const } },
            { name: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
}

function mapSpecialty(row: {
  id: string;
  code: string;
  name: string;
  systemOfMedicine: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): SpecialtyRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    systemOfMedicine: row.systemOfMedicine,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type CouncilRow = {
  id: string;
  code: string;
  name: string;
  kind: string;
  stateId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  state: { name: string } | null;
};

function mapCouncil(row: CouncilRow): CouncilRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    stateId: row.stateId,
    stateName: row.state?.name ?? null,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapServiceCategory(row: {
  id: string;
  code: string;
  name: string;
  providerType: DbProviderType;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): ServiceCategoryRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    providerType: row.providerType,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapDocumentType(row: {
  id: string;
  code: string;
  name: string;
  providerTypes: DbProviderType[];
  requiresExpiry: boolean;
  expiryReminderDays: number[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): DocumentTypeRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    providerTypes: row.providerTypes,
    requiresExpiry: row.requiresExpiry,
    expiryReminderDays: row.expiryReminderDays,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const councilInclude = { state: { select: { name: true } } } satisfies Prisma.CouncilInclude;

export function createMasterDataRepository(db: DbClient): MasterDataRepository {
  const loadCouncil = async (id: string): Promise<CouncilRecord | null> => {
    const row = await db.council.findUnique({ where: { id }, include: councilInclude });
    return row ? mapCouncil(row) : null;
  };

  const loadSpecialty = async (id: string): Promise<SpecialtyRecord | null> => {
    const row = await db.specialty.findUnique({ where: { id } });
    return row ? mapSpecialty(row) : null;
  };

  const loadServiceCategory = async (id: string): Promise<ServiceCategoryRecord | null> => {
    const row = await db.serviceCategory.findUnique({ where: { id } });
    return row ? mapServiceCategory(row) : null;
  };

  const loadDocumentType = async (id: string): Promise<DocumentTypeRecord | null> => {
    const row = await db.documentType.findUnique({ where: { id } });
    return row ? mapDocumentType(row) : null;
  };

  return {
    states: {
      async list(): Promise<StateRecord[]> {
        return db.state.findMany({
          orderBy: { name: 'asc' },
          select: { id: true, code: true, name: true },
        });
      },
    },

    districts: {
      async list(stateId?: string): Promise<DistrictRecord[]> {
        const rows = await db.district.findMany({
          where: stateId ? { stateId } : {},
          orderBy: [{ state: { name: 'asc' } }, { name: 'asc' }],
          select: { id: true, stateId: true, name: true, state: { select: { code: true } } },
        });
        return rows.map((row) => ({
          id: row.id,
          stateId: row.stateId,
          name: row.name,
          stateCode: row.state.code,
        }));
      },
    },

    pincodes: {
      async search({ q, limit }) {
        const needle = q.trim();
        // Digits search the PIN itself; anything else searches office names.
        const pinPrefix = /^\d{1,6}$/.test(needle);
        const where: Prisma.PinCodeWhereInput = {
          isActive: true,
          ...(pinPrefix
            ? {
                OR: [
                  { pinCode: { startsWith: needle } },
                  { officeName: { startsWith: needle, mode: 'insensitive' } },
                ],
              }
            : { officeName: { startsWith: needle, mode: 'insensitive' } }),
        };

        const rows = await db.pinCode.findMany({
          where,
          include: pincodeInclude,
          orderBy: { pinCode: 'asc' },
          take: limit,
        });
        return rows.map(mapPincode);
      },

      async findByPin(pinCode) {
        const row = await db.pinCode.findUnique({
          where: { pinCode },
          include: pincodeInclude,
        });
        return row ? mapPincode(row) : null;
      },

      async stats() {
        const [totalPins, totalDistricts, latest] = await Promise.all([
          db.pinCode.count(),
          db.district.count(),
          db.pinCode.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
        ]);
        return { totalPins, totalDistricts, lastUpdatedAt: latest?.updatedAt ?? null };
      },
    },

    specialties: {
      async list(filters = {}): Promise<SpecialtyRecord[]> {
        const rows = await db.specialty.findMany({
          where: baseWhere(filters),
          orderBy: [{ systemOfMedicine: 'asc' }, { name: 'asc' }],
        });
        return rows.map(mapSpecialty);
      },
      findById: loadSpecialty,

      async findByCode(code) {
        const row = await db.specialty.findUnique({ where: { code } });
        return row ? mapSpecialty(row) : null;
      },

      async create(input) {
        const row = await db.specialty.create({
          data: {
            id: input.id,
            code: input.code,
            name: input.name,
            systemOfMedicine: input.systemOfMedicine,
          },
        });
        return mapSpecialty(row);
      },

      async update(input) {
        await db.specialty.update({
          where: { id: input.id },
          data: {
            ...(input.code === undefined ? {} : { code: input.code }),
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.systemOfMedicine === undefined
              ? {}
              : { systemOfMedicine: input.systemOfMedicine }),
            ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
          },
        });
        return loadSpecialty(input.id);
      },
    },

    councils: {
      async list(filters = {}): Promise<CouncilRecord[]> {
        const where: Prisma.CouncilWhereInput = {
          ...baseWhere(filters),
          ...(filters.stateId ? { stateId: filters.stateId } : {}),
        };
        const rows = await db.council.findMany({
          where,
          include: councilInclude,
          orderBy: [{ kind: 'asc' }, { name: 'asc' }],
        });
        return rows.map(mapCouncil);
      },
      findById: loadCouncil,

      async findByCode(code) {
        const row = await db.council.findUnique({ where: { code }, include: councilInclude });
        return row ? mapCouncil(row) : null;
      },

      async create(input) {
        const row = await db.council.create({
          data: {
            id: input.id,
            code: input.code,
            name: input.name,
            kind: input.kind as 'medical' | 'pharmacy' | 'nursing' | 'other',
            stateId: input.stateId,
          },
          include: councilInclude,
        });
        return mapCouncil(row);
      },

      async update(input) {
        await db.council.update({
          where: { id: input.id },
          data: {
            ...(input.code === undefined ? {} : { code: input.code }),
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.kind === undefined
              ? {}
              : { kind: input.kind as 'medical' | 'pharmacy' | 'nursing' | 'other' }),
            ...(input.stateId === undefined ? {} : { stateId: input.stateId }),
            ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
          },
        });
        return loadCouncil(input.id);
      },
    },

    serviceCategories: {
      async list(filters = {}): Promise<ServiceCategoryRecord[]> {
        const where: Prisma.ServiceCategoryWhereInput = {
          ...baseWhere(filters),
          ...(filters.providerType ? { providerType: filters.providerType as DbProviderType } : {}),
        };
        const rows = await db.serviceCategory.findMany({
          where,
          orderBy: [{ providerType: 'asc' }, { name: 'asc' }],
        });
        return rows.map(mapServiceCategory);
      },
      findById: loadServiceCategory,

      async findByCode(code) {
        const row = await db.serviceCategory.findUnique({ where: { code } });
        return row ? mapServiceCategory(row) : null;
      },

      async create(input) {
        const row = await db.serviceCategory.create({
          data: {
            id: input.id,
            code: input.code,
            name: input.name,
            providerType: input.providerType,
          },
        });
        return mapServiceCategory(row);
      },

      async update(input) {
        await db.serviceCategory.update({
          where: { id: input.id },
          data: {
            ...(input.code === undefined ? {} : { code: input.code }),
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.providerType === undefined ? {} : { providerType: input.providerType }),
            ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
          },
        });
        return loadServiceCategory(input.id);
      },
    },

    documentTypes: {
      async list(filters = {}): Promise<DocumentTypeRecord[]> {
        const rows = await db.documentType.findMany({
          where: {
            ...baseWhere(filters),
            ...(filters.providerType
              ? { providerTypes: { has: filters.providerType as DbProviderType } }
              : {}),
          },
          orderBy: { name: 'asc' },
        });
        return rows.map(mapDocumentType);
      },
      findById: loadDocumentType,

      async findByCode(code) {
        const row = await db.documentType.findUnique({ where: { code } });
        return row ? mapDocumentType(row) : null;
      },

      async create(input) {
        const row = await db.documentType.create({
          data: {
            id: input.id,
            code: input.code,
            name: input.name,
            providerTypes: input.providerTypes,
            requiresExpiry: input.requiresExpiry,
            expiryReminderDays: input.expiryReminderDays,
          },
        });
        return mapDocumentType(row);
      },

      async update(input) {
        await db.documentType.update({
          where: { id: input.id },
          data: {
            ...(input.code === undefined ? {} : { code: input.code }),
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.providerTypes === undefined ? {} : { providerTypes: input.providerTypes }),
            ...(input.requiresExpiry === undefined ? {} : { requiresExpiry: input.requiresExpiry }),
            ...(input.expiryReminderDays === undefined
              ? {}
              : { expiryReminderDays: input.expiryReminderDays }),
            ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
          },
        });
        return loadDocumentType(input.id);
      },
    },

    licenceTypes: {
      async list(): Promise<LicenceTypeRecord[]> {
        const rows = await db.licenceType.findMany({ orderBy: { name: 'asc' } });
        return rows.map((row) => ({
          id: row.id,
          code: row.code,
          name: row.name,
          applicableProviderTypes: row.applicableProviderTypes,
          isActive: row.isActive,
        }));
      },
    },

    facilityTypes: {
      async list(): Promise<FacilityTypeRecord[]> {
        return db.facilityType.findMany({
          where: { isActive: true },
          orderBy: { name: 'asc' },
          select: { id: true, code: true, name: true, isActive: true },
        });
      },
    },
  };
}
