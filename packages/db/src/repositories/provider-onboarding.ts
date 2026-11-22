import { Prisma } from '@prisma/client';
import type {
  ProviderDocument as PrismaProviderDocument,
  ProviderOrganization as PrismaProviderOrganization,
  ProviderStatusHistory as PrismaProviderStatusHistory,
} from '@prisma/client';
import type {
  DuplicateCandidate,
  OrganizationCreateInput,
  OrganizationTransitionInput,
  OrganizationUpdateInput,
  ProviderOnboardingRepository,
} from '@curenear/shared';
import type { DbClient } from '../client';
import { toJsonObject } from '../mappers';
import { nextProviderCode } from './provider-directory';

/**
 * Repository for the normalized provider model. Everything is scoped by
 * organization id where the caller passes one, so a child row from another
 * provider can never be read or written through the wrong parent.
 */

export function mapOrganization(row: PrismaProviderOrganization) {
  return {
    id: row.id,
    code: row.code,
    providerType: row.providerType,
    status: row.status,
    legalName: row.legalName,
    tradeName: row.tradeName,
    constitutionType: row.constitutionType,
    registrationNumber: row.registrationNumber,
    establishedOn: row.establishedOn,
    website: row.website,
    email: row.email,
    mobile: row.mobile,
    primaryPinCode: row.primaryPinCode,
    primaryDistrictId: row.primaryDistrictId,
    primaryStateId: row.primaryStateId,
    typeData: toJsonObject(row.typeData),
    typeDataSchemaVersion: row.typeDataSchemaVersion,
    profileData: toJsonObject(row.profileData),
    publicationConsents: toJsonObject(row.publicationConsents),
    createdByUserId: row.createdByUserId,
    submittedAt: row.submittedAt,
    approvedAt: row.approvedAt,
    approvedByUserId: row.approvedByUserId,
    version: row.version,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapDocument(row: PrismaProviderDocument) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    storageKey: row.storageKey,
    role: row.role,
    uploadedByUserId: row.uploadedByUserId,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  };
}

type PrismaDoctorProfile = Prisma.DoctorProfileGetPayload<{
  include: { council: true; specialty: true };
}>;

type PrismaDoctorLocation = Prisma.DoctorLocationGetPayload<Record<string, never>>;

function mapDoctorProfile(row: PrismaDoctorProfile) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    fullName: row.fullName,
    mobile: row.mobile,
    email: row.email,
    registrationNo: row.registrationNo,
    councilId: row.councilId,
    councilName: row.councilName ?? row.council?.name ?? null,
    systemOfMedicine: row.systemOfMedicine,
    specialtyId: row.specialtyId,
    specialtyName: row.specialtyName ?? row.specialty?.name ?? null,
    qualifications: Array.isArray(row.qualifications)
      ? (row.qualifications as Array<Record<string, unknown>>)
      : [],
    photoDocumentId: row.photoDocumentId,
    status: row.status,
    createdByOrgId: row.createdByOrgId,
    doctorConfirmedAt: row.doctorConfirmedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapDoctorLocation(row: PrismaDoctorLocation) {
  return {
    id: row.id,
    doctorProfileId: row.doctorProfileId,
    locationId: row.locationId,
    clinicOrganizationId: row.clinicOrganizationId,
    roleAtClinic: row.roleAtClinic,
    practiceType: row.practiceType,
    address: row.address ? toJsonObject(row.address) : null,
    publicContact: row.publicContact,
    timings: Array.isArray(row.timings) ? (row.timings as Array<Record<string, unknown>>) : [],
    feePaise: row.feePaise,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const doctorInclude = { council: true, specialty: true } as const;

function mapStatusHistory(row: PrismaProviderStatusHistory) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    changedByUserId: row.changedByUserId,
    reason: row.reason,
    scope: row.scope,
    scopeRefId: row.scopeRefId,
    scopeLabel: row.scopeLabel,
    flaggedSections: row.flaggedSections,
    at: row.at,
  };
}

function mapLocation(row: {
  id: string;
  organizationId: string;
  name: string;
  locationType: string;
  addressLine1: string;
  addressLine2: string | null;
  landmark: string | null;
  city: string;
  districtId: string | null;
  stateId: string | null;
  pinCode: string;
  latitude: number | null;
  longitude: number | null;
  isPrimary: boolean;
  isPublic: boolean;
  operatingHours: unknown;
  bookingPhone: string | null;
  branchRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    locationType: row.locationType,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    landmark: row.landmark,
    city: row.city,
    districtId: row.districtId,
    stateId: row.stateId,
    pinCode: row.pinCode,
    latitude: row.latitude,
    longitude: row.longitude,
    isPrimary: row.isPrimary,
    isPublic: row.isPublic,
    operatingHours: toJsonObject(row.operatingHours),
    bookingPhone: row.bookingPhone,
    branchRef: row.branchRef,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapLicence(row: {
  id: string;
  organizationId: string;
  locationId: string | null;
  licenceTypeId: string | null;
  number: string;
  authority: string | null;
  issuedOn: Date | null;
  validFrom: Date | null;
  validTo: Date | null;
  status: string;
  documentId: string | null;
  details: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    locationId: row.locationId,
    licenceTypeId: row.licenceTypeId,
    number: row.number,
    authority: row.authority,
    issuedOn: row.issuedOn,
    validFrom: row.validFrom,
    validTo: row.validTo,
    status: row.status,
    documentId: row.documentId,
    details: toJsonObject(row.details),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapInsurance(row: {
  id: string;
  organizationId: string;
  type: string;
  insurer: string;
  policyNo: string;
  limitPaise: number | null;
  validFrom: Date | null;
  validTo: Date | null;
  documentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    type: row.type,
    insurer: row.insurer,
    policyNo: row.policyNo,
    limitPaise: row.limitPaise,
    validFrom: row.validFrom,
    validTo: row.validTo,
    documentId: row.documentId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const organizationSummary = {
  id: true,
  code: true,
  legalName: true,
  providerType: true,
  status: true,
  createdByUserId: true,
} as const;

export function createProviderOnboardingRepository(db: DbClient): ProviderOnboardingRepository {
  async function organizationById(id: string, includeDeleted = false) {
    const row = await db.providerOrganization.findFirst({
      where: { id, ...(includeDeleted ? {} : { deletedAt: null }) },
    });
    return row ? mapOrganization(row) : null;
  }

  return {
    async createOrganization(input: OrganizationCreateInput) {
      const code = await nextProviderCode(db, input.providerType);
      const row = await db.providerOrganization.create({
        data: {
          id: input.id,
          code,
          providerType: input.providerType,
          legalName: input.legalName,
          tradeName: input.tradeName,
          registrationNumber: input.registrationNumber,
          website: input.website,
          email: input.email,
          mobile: input.mobile,
          primaryPinCode: input.primaryPinCode,
          typeData: input.typeData as Prisma.InputJsonValue,
          createdByUserId: input.createdByUserId,
          version: 1,
        },
      });
      return mapOrganization(row);
    },

    async findOrganizationById(id, options) {
      return organizationById(id, options?.includeDeleted ?? false);
    },

    async listOrganizations(filter) {
      const rows = await db.providerOrganization.findMany({
        where: {
          deletedAt: null,
          ...(filter.createdByUserId ? { createdByUserId: filter.createdByUserId } : {}),
        },
        orderBy: { updatedAt: 'desc' },
        take: filter.limit ?? 100,
      });
      return rows.map(mapOrganization);
    },

    async updateOrganization(input: OrganizationUpdateInput) {
      const columns = Object.fromEntries(
        Object.entries(input.columns).filter(([, value]) => value !== undefined),
      ) as Prisma.ProviderOrganizationUpdateManyMutationInput;

      const result = await db.providerOrganization.updateMany({
        where: { id: input.id, version: input.expectedVersion, deletedAt: null },
        data: {
          ...columns,
          ...(input.typeData !== undefined
            ? { typeData: input.typeData as Prisma.InputJsonValue }
            : {}),
          ...(input.typeDataSchemaVersion !== undefined
            ? { typeDataSchemaVersion: input.typeDataSchemaVersion }
            : {}),
          ...(input.profileData !== undefined
            ? { profileData: input.profileData as Prisma.InputJsonValue }
            : {}),
          ...(input.publicationConsents !== undefined
            ? { publicationConsents: input.publicationConsents as Prisma.InputJsonValue }
            : {}),
          version: { increment: 1 },
        },
      });
      if (result.count === 0) return null;
      return organizationById(input.id);
    },

    async transitionOrganization(input: OrganizationTransitionInput) {
      const result = await db.providerOrganization.updateMany({
        where: { id: input.id, version: input.expectedVersion, deletedAt: null },
        data: {
          status: input.toStatus,
          version: { increment: 1 },
          ...(input.submittedAt !== undefined ? { submittedAt: input.submittedAt } : {}),
          ...(input.approvedAt !== undefined ? { approvedAt: input.approvedAt } : {}),
          ...(input.approvedByUserId !== undefined
            ? { approvedByUserId: input.approvedByUserId }
            : {}),
        },
      });
      if (result.count === 0) return null;
      return organizationById(input.id);
    },

    async listStatusHistory(organizationId, limit) {
      const rows = await db.providerStatusHistory.findMany({
        where: { organizationId },
        orderBy: { at: 'desc' },
        take: limit,
      });
      return rows.map(mapStatusHistory);
    },

    async appendStatusHistory(input) {
      await db.providerStatusHistory.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          fromStatus: input.fromStatus,
          toStatus: input.toStatus,
          changedByUserId: input.changedByUserId,
          reason: input.reason,
          scope: input.scope ?? null,
          scopeRefId: input.scopeRefId ?? null,
          scopeLabel: input.scopeLabel ?? null,
          flaggedSections: input.flaggedSections ?? [],
          at: input.at,
        },
      });
    },

    async listLocations(organizationId) {
      const rows = await db.providerLocation.findMany({
        where: { organizationId },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      });
      return rows.map(mapLocation);
    },

    async createLocation(organizationId, input, id) {
      const row = await db.providerLocation.create({
        data: {
          id,
          organizationId,
          name: input.name,
          locationType: input.locationType,
          addressLine1: input.addressLine1,
          addressLine2: input.addressLine2 ?? null,
          landmark: input.landmark ?? null,
          city: input.city,
          districtId: input.districtId ?? null,
          stateId: input.stateId ?? null,
          pinCode: input.pinCode,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          isPrimary: input.isPrimary ?? false,
          isPublic: input.isPublic ?? false,
          operatingHours: (input.operatingHours ?? {}) as Prisma.InputJsonValue,
          bookingPhone: input.bookingPhone ?? null,
          branchRef: input.branchRef ?? null,
        },
      });
      return mapLocation(row);
    },

    async updateLocation(organizationId, locationId, patch) {
      const data = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ) as Prisma.ProviderLocationUpdateManyMutationInput;
      const result = await db.providerLocation.updateMany({
        where: { id: locationId, organizationId },
        data,
      });
      if (result.count === 0) return null;
      const row = await db.providerLocation.findFirst({
        where: { id: locationId, organizationId },
      });
      return row ? mapLocation(row) : null;
    },

    async deleteLocation(organizationId, locationId) {
      const result = await db.providerLocation.deleteMany({
        where: { id: locationId, organizationId },
      });
      return result.count > 0;
    },

    async clearPrimaryLocations(organizationId, exceptId) {
      await db.providerLocation.updateMany({
        where: {
          organizationId,
          isPrimary: true,
          ...(exceptId ? { id: { not: exceptId } } : {}),
        },
        data: { isPrimary: false },
      });
    },

    async listContacts(organizationId) {
      const rows = await db.providerContact.findMany({
        where: { organizationId },
        orderBy: { role: 'asc' },
      });
      return rows.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        role: row.role,
        name: row.name,
        designation: row.designation,
        phone: row.phone,
        email: row.email,
        address: (row.address as Record<string, unknown> | null) ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
    },

    async upsertContact(organizationId, input, id) {
      const row = await db.providerContact.upsert({
        where: { organizationId_role: { organizationId, role: input.role } },
        create: {
          id,
          organizationId,
          role: input.role,
          name: input.name,
          designation: input.designation ?? null,
          phone: input.phone,
          email: input.email ?? null,
          address: (input.address as Prisma.InputJsonValue | undefined) ?? undefined,
        },
        update: {
          name: input.name,
          designation: input.designation ?? null,
          phone: input.phone,
          email: input.email ?? null,
          address: (input.address as Prisma.InputJsonValue | undefined) ?? Prisma.DbNull,
        },
      });
      return {
        id: row.id,
        organizationId: row.organizationId,
        role: row.role,
        name: row.name,
        designation: row.designation,
        phone: row.phone,
        email: row.email,
        address: (row.address as Record<string, unknown> | null) ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    },

    async deleteContact(organizationId, contactId) {
      const result = await db.providerContact.deleteMany({
        where: { id: contactId, organizationId },
      });
      return result.count > 0;
    },

    async listLicences(organizationId) {
      const rows = await db.providerLicence.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(mapLicence);
    },

    async createLicence(organizationId, input, id) {
      const row = await db.providerLicence.create({
        data: {
          id,
          organizationId,
          locationId: input.locationId ?? null,
          licenceTypeId: input.licenceTypeId ?? null,
          number: input.number,
          authority: input.authority ?? null,
          issuedOn: input.issuedOn ?? null,
          validFrom: input.validFrom ?? null,
          validTo: input.validTo ?? null,
          status: input.status ?? 'active',
          documentId: input.documentId ?? null,
          details: (input.details ?? {}) as Prisma.InputJsonValue,
        },
      });
      return mapLicence(row);
    },

    async updateLicence(organizationId, licenceId, patch) {
      const { role: _role, ...rest } = patch;
      const data = Object.fromEntries(
        Object.entries(rest).filter(([, value]) => value !== undefined),
      ) as Prisma.ProviderLicenceUpdateManyMutationInput;
      const result = await db.providerLicence.updateMany({
        where: { id: licenceId, organizationId },
        data,
      });
      if (result.count === 0) return null;
      const row = await db.providerLicence.findFirst({ where: { id: licenceId, organizationId } });
      return row ? mapLicence(row) : null;
    },

    async deleteLicence(organizationId, licenceId) {
      const result = await db.providerLicence.deleteMany({
        where: { id: licenceId, organizationId },
      });
      return result.count > 0;
    },

    async listInsurance(organizationId) {
      const rows = await db.providerInsurance.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(mapInsurance);
    },

    async createInsurance(organizationId, input, id) {
      const row = await db.providerInsurance.create({
        data: {
          id,
          organizationId,
          type: input.type,
          insurer: input.insurer,
          policyNo: input.policyNo,
          limitPaise: input.limitPaise ?? null,
          validFrom: input.validFrom ?? null,
          validTo: input.validTo ?? null,
          documentId: input.documentId ?? null,
        },
      });
      return mapInsurance(row);
    },

    async updateInsurance(organizationId, insuranceId, patch) {
      const data = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ) as Prisma.ProviderInsuranceUpdateManyMutationInput;
      const result = await db.providerInsurance.updateMany({
        where: { id: insuranceId, organizationId },
        data,
      });
      if (result.count === 0) return null;
      const row = await db.providerInsurance.findFirst({
        where: { id: insuranceId, organizationId },
      });
      return row ? mapInsurance(row) : null;
    },

    async deleteInsurance(organizationId, insuranceId) {
      const result = await db.providerInsurance.deleteMany({
        where: { id: insuranceId, organizationId },
      });
      return result.count > 0;
    },

    async listServicePins(organizationId) {
      const rows = await db.providerServicePin.findMany({
        where: { organizationId },
        orderBy: [{ serviceKind: 'asc' }, { pinCode: 'asc' }],
      });
      return rows.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        pinCode: row.pinCode,
        serviceKind: row.serviceKind,
        createdAt: row.createdAt,
      }));
    },

    async addServicePin(organizationId, input, id) {
      const row = await db.providerServicePin.upsert({
        where: {
          organizationId_pinCode_serviceKind: {
            organizationId,
            pinCode: input.pinCode,
            serviceKind: input.serviceKind,
          },
        },
        create: { id, organizationId, pinCode: input.pinCode, serviceKind: input.serviceKind },
        update: {},
      });
      return {
        id: row.id,
        organizationId: row.organizationId,
        pinCode: row.pinCode,
        serviceKind: row.serviceKind,
        createdAt: row.createdAt,
      };
    },

    async removeServicePin(organizationId, pinId) {
      const result = await db.providerServicePin.deleteMany({
        where: { id: pinId, organizationId },
      });
      return result.count > 0;
    },

    async listDocuments(organizationId) {
      const rows = await db.providerDocument.findMany({
        where: { organizationId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(mapDocument);
    },

    async createDocument(organizationId, input, id) {
      const row = await db.providerDocument.create({
        data: {
          id,
          organizationId,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          storageKey: input.storageKey ?? null,
          role: input.role ?? null,
          uploadedByUserId: input.uploadedByUserId,
        },
      });
      return mapDocument(row);
    },

    async deleteDocument(organizationId, documentId, deletedAt) {
      const result = await db.providerDocument.updateMany({
        where: { id: documentId, organizationId, deletedAt: null },
        data: { deletedAt },
      });
      return result.count > 0;
    },

    async findByRegistrationNumber(registrationNumber, excludeOrganizationId, ownerUserId) {
      const rows = await db.providerOrganization.findMany({
        where: {
          deletedAt: null,
          registrationNumber: { equals: registrationNumber, mode: 'insensitive' },
          ...(excludeOrganizationId ? { id: { not: excludeOrganizationId } } : {}),
          ...(ownerUserId ? { createdByUserId: ownerUserId } : {}),
        },
        select: organizationSummary,
        take: 10,
      });
      return rows.map((row) => ({ ...row }));
    },

    async findByLicenceNumber(licenceNumber, excludeOrganizationId, ownerUserId) {
      const rows = await db.providerLicence.findMany({
        where: {
          number: { equals: licenceNumber, mode: 'insensitive' },
          organization: {
            deletedAt: null,
            ...(excludeOrganizationId ? { id: { not: excludeOrganizationId } } : {}),
            ...(ownerUserId ? { createdByUserId: ownerUserId } : {}),
          },
        },
        select: { organization: { select: organizationSummary } },
        take: 10,
      });
      return rows.map((row) => ({ ...row.organization }));
    },

    async findByMobileAndPin(mobile, pinCode, excludeOrganizationId, ownerUserId) {
      const rows = await db.providerOrganization.findMany({
        where: {
          deletedAt: null,
          mobile,
          primaryPinCode: pinCode,
          ...(excludeOrganizationId ? { id: { not: excludeOrganizationId } } : {}),
          ...(ownerUserId ? { createdByUserId: ownerUserId } : {}),
        },
        select: organizationSummary,
        take: 10,
      });
      return rows.map((row) => ({ ...row }));
    },

    async findSimilarLegalName(legalName, pinCode, excludeOrganizationId, ownerUserId) {
      const rows = await db.$queryRaw<
        Array<{
          id: string;
          code: string;
          legalName: string | null;
          providerType: string;
          status: string;
          similarity: number;
          createdByUserId: string;
        }>
      >(Prisma.sql`
        SELECT o.id,
               o.code,
               o.legal_name AS "legalName",
               o.provider_type::text AS "providerType",
               o.status::text AS "status",
               o.created_by_user_id AS "createdByUserId",
               similarity(o.legal_name, ${legalName}) AS similarity
        FROM provider_organizations o
        WHERE o.deleted_at IS NULL
          AND o.primary_pin_code = ${pinCode}
          AND o.legal_name IS NOT NULL
          AND (${excludeOrganizationId}::uuid IS NULL OR o.id <> ${excludeOrganizationId}::uuid)
          AND (${ownerUserId ?? null}::uuid IS NULL OR o.created_by_user_id = ${ownerUserId ?? null}::uuid)
          AND similarity(o.legal_name, ${legalName}) >= 0.45
        ORDER BY similarity DESC
        LIMIT 10
      `);
      return rows.map((row) => ({
        id: row.id,
        code: row.code,
        legalName: row.legalName,
        providerType: row.providerType as DuplicateCandidate['providerType'],
        status: row.status as DuplicateCandidate['status'],
        similarity: Number(row.similarity),
        createdByUserId: row.createdByUserId,
      }));
    },

    async findDoctorProfileByOrganizationId(organizationId) {
      const row = await db.doctorProfile.findFirst({
        where: { organizationId, deletedAt: null },
        include: doctorInclude,
      });
      return row ? mapDoctorProfile(row) : null;
    },

    async findDoctorProfileById(id) {
      const row = await db.doctorProfile.findFirst({
        where: { id, deletedAt: null },
        include: doctorInclude,
      });
      return row ? mapDoctorProfile(row) : null;
    },

    async findDoctorProfilesByRegistration(registrationNo) {
      const rows = await db.doctorProfile.findMany({
        where: {
          deletedAt: null,
          registrationNo: { equals: registrationNo, mode: 'insensitive' },
        },
        include: doctorInclude,
      });
      return rows.map(mapDoctorProfile);
    },

    async saveDoctorProfile(input, id) {
      const data = {
        organizationId: input.organizationId,
        createdByOrgId: input.createdByOrgId,
        fullName: input.fullName,
        mobile: input.mobile ?? null,
        email: input.email ?? null,
        registrationNo: input.registrationNo,
        councilId: input.councilId ?? null,
        councilName: input.councilName ?? null,
        systemOfMedicine: input.systemOfMedicine,
        specialtyId: input.specialtyId ?? null,
        specialtyName: input.specialtyName ?? null,
        qualifications: (input.qualifications ?? []) as Prisma.InputJsonValue,
        photoDocumentId: input.photoDocumentId ?? null,
        ...(input.status ? { status: input.status } : {}),
      };
      const row = id
        ? await db.doctorProfile.update({ where: { id }, data, include: doctorInclude })
        : await db.doctorProfile.create({
            data: { id: globalThis.crypto.randomUUID(), ...data },
            include: doctorInclude,
          });
      return mapDoctorProfile(row);
    },

    async listDoctorPractices(doctorProfileId) {
      const rows = await db.doctorLocation.findMany({
        where: { doctorProfileId, clinicOrganizationId: null },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(mapDoctorLocation);
    },

    async createDoctorPractice(input, id) {
      const row = await db.doctorLocation.create({
        data: {
          id,
          doctorProfileId: input.doctorProfileId,
          clinicOrganizationId: input.clinicOrganizationId ?? null,
          roleAtClinic: input.roleAtClinic ?? null,
          practiceType: input.practiceType ?? null,
          address: (input.address ?? undefined) as Prisma.InputJsonValue | undefined,
          publicContact: input.publicContact ?? null,
          timings: (input.timings ?? []) as Prisma.InputJsonValue,
          feePaise: input.feePaise ?? null,
          status: input.status ?? 'active',
        },
      });
      return mapDoctorLocation(row);
    },

    async updateDoctorPractice(doctorProfileId, practiceId, patch) {
      const result = await db.doctorLocation.updateMany({
        where: { id: practiceId, doctorProfileId, clinicOrganizationId: null },
        data: {
          ...(patch.roleAtClinic !== undefined ? { roleAtClinic: patch.roleAtClinic } : {}),
          ...(patch.practiceType !== undefined ? { practiceType: patch.practiceType } : {}),
          ...(patch.address !== undefined
            ? {
                address:
                  patch.address === null ? Prisma.DbNull : (patch.address as Prisma.InputJsonValue),
              }
            : {}),
          ...(patch.publicContact !== undefined ? { publicContact: patch.publicContact } : {}),
          ...(patch.timings !== undefined
            ? { timings: patch.timings as Prisma.InputJsonValue }
            : {}),
          ...(patch.feePaise !== undefined ? { feePaise: patch.feePaise } : {}),
        },
      });
      if (result.count === 0) return null;
      const row = await db.doctorLocation.findUnique({ where: { id: practiceId } });
      return row ? mapDoctorLocation(row) : null;
    },

    async deleteDoctorPractice(doctorProfileId, practiceId) {
      const result = await db.doctorLocation.deleteMany({
        where: { id: practiceId, doctorProfileId, clinicOrganizationId: null },
      });
      return result.count > 0;
    },

    async listClinicDoctorLinks(clinicOrganizationId) {
      const rows = await db.doctorLocation.findMany({
        where: { clinicOrganizationId },
        include: { doctorProfile: { include: doctorInclude } },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((row) => ({
        link: mapDoctorLocation(row),
        doctor: mapDoctorProfile(row.doctorProfile),
      }));
    },

    async createClinicDoctorLink(input, id) {
      const row = await db.doctorLocation.create({
        data: {
          id,
          doctorProfileId: input.doctorProfileId,
          clinicOrganizationId: input.clinicOrganizationId,
          roleAtClinic: input.roleAtClinic,
          timings: (input.timings ?? []) as Prisma.InputJsonValue,
          feePaise: input.feePaise ?? null,
          status: input.status ?? 'active',
        },
        include: { doctorProfile: { include: doctorInclude } },
      });
      return { link: mapDoctorLocation(row), doctor: mapDoctorProfile(row.doctorProfile) };
    },

    async updateClinicDoctorLink(clinicOrganizationId, linkId, patch) {
      const result = await db.doctorLocation.updateMany({
        where: { id: linkId, clinicOrganizationId },
        data: {
          ...(patch.roleAtClinic !== undefined ? { roleAtClinic: patch.roleAtClinic } : {}),
          ...(patch.timings !== undefined
            ? { timings: patch.timings as Prisma.InputJsonValue }
            : {}),
          ...(patch.feePaise !== undefined ? { feePaise: patch.feePaise } : {}),
        },
      });
      if (result.count === 0) return null;
      const row = await db.doctorLocation.findUnique({
        where: { id: linkId },
        include: { doctorProfile: { include: doctorInclude } },
      });
      return row
        ? { link: mapDoctorLocation(row), doctor: mapDoctorProfile(row.doctorProfile) }
        : null;
    },

    async deleteClinicDoctorLink(clinicOrganizationId, linkId) {
      const result = await db.doctorLocation.deleteMany({
        where: { id: linkId, clinicOrganizationId },
      });
      return result.count > 0;
    },

    async findDoctorRegistration(registrationNo, councilId) {
      const rows = await db.doctorProfile.findMany({
        where: {
          deletedAt: null,
          registrationNo: { equals: registrationNo, mode: 'insensitive' },
          ...(councilId ? { councilId } : {}),
        },
        select: { id: true, organizationId: true },
      });
      return rows;
    },

    async dismissDuplicate(input) {
      await db.providerDuplicateDismissal.upsert({
        where: {
          organizationId_duplicateOrganizationId: {
            organizationId: input.organizationId,
            duplicateOrganizationId: input.duplicateOrganizationId,
          },
        },
        create: {
          id: input.id,
          organizationId: input.organizationId,
          duplicateOrganizationId: input.duplicateOrganizationId,
          dismissedByUserId: input.dismissedByUserId,
          reason: input.reason,
          createdAt: input.at,
        },
        update: { reason: input.reason },
      });
    },

    async listDismissedDuplicateIds(organizationId) {
      const rows = await db.providerDuplicateDismissal.findMany({
        where: { organizationId },
        select: { duplicateOrganizationId: true },
      });
      return rows.map((row) => row.duplicateOrganizationId);
    },
  };
}
