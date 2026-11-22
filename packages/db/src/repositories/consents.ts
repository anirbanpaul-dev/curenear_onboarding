import type {
  AgreementAcceptanceRecord,
  AgreementTemplateRecord,
  ConfirmationRequestRecord,
  ConsentRecord,
  ConsentRepository,
} from '@curenear/shared';
import { Prisma } from '@prisma/client';
import type { DbClient } from '../client';

function jsonObject(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapConsent(row: Prisma.ConsentRecordGetPayload<object>): ConsentRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    doctorProfileId: row.doctorProfileId,
    consentType: row.consentType,
    textVersion: row.textVersion,
    capturedByUserId: row.capturedByUserId,
    capturedAt: row.capturedAt,
    method: row.method,
    evidenceDocumentId: row.evidenceDocumentId,
    confirmationMeta: jsonObject(row.confirmationMeta),
    revokedAt: row.revokedAt,
    revokedByUserId: row.revokedByUserId,
    revokeReason: row.revokeReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const withTemplate = {
  template: { select: { name: true, version: true } },
} as const;

function mapAgreement(
  row: Prisma.AgreementAcceptanceGetPayload<{ include: typeof withTemplate }>,
): AgreementAcceptanceRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    templateId: row.templateId,
    method: row.method,
    signedOn: row.signedOn,
    place: row.place,
    signatoryName: row.signatoryName,
    signatoryDesignation: row.signatoryDesignation,
    signedDocumentId: row.signedDocumentId,
    stampReference: row.stampReference,
    witnesses: Array.isArray(row.witnesses)
      ? (row.witnesses as Array<Record<string, unknown>>)
      : [],
    recordedByUserId: row.recordedByUserId,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    templateName: row.template?.name ?? null,
    templateVersion: row.template?.version ?? null,
  };
}

function mapTemplate(row: Prisma.AgreementTemplateGetPayload<object>): AgreementTemplateRecord {
  return {
    id: row.id,
    providerType: row.providerType,
    name: row.name,
    version: row.version,
    effectiveFrom: row.effectiveFrom,
    body: row.body,
    bodyHash: row.bodyHash,
    fileDocumentId: row.fileDocumentId,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapConfirmation(
  row: Prisma.ConfirmationRequestGetPayload<object>,
): ConfirmationRequestRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    doctorProfileId: row.doctorProfileId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    revokedAt: row.revokedAt,
    confirmationMeta: jsonObject(row.confirmationMeta),
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
  };
}

export function createConsentRepository(db: DbClient): ConsentRepository {
  return {
    async createConsent(input) {
      const row = await db.consentRecord.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          doctorProfileId: input.doctorProfileId,
          consentType: input.consentType,
          textVersion: input.textVersion,
          capturedByUserId: input.capturedByUserId,
          capturedAt: input.capturedAt,
          method: input.method,
          evidenceDocumentId: input.evidenceDocumentId,
          confirmationMeta: input.confirmationMeta as Prisma.InputJsonValue,
          revokedAt: input.revokedAt,
          revokedByUserId: input.revokedByUserId,
          revokeReason: input.revokeReason,
        },
      });
      return mapConsent(row);
    },

    async listByOrganization(organizationId) {
      const rows = await db.consentRecord.findMany({
        where: { organizationId },
        orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
      });
      return rows.map(mapConsent);
    },

    async findById(id) {
      const row = await db.consentRecord.findUnique({ where: { id } });
      return row ? mapConsent(row) : null;
    },

    async revoke({ id, revokedAt, revokedByUserId, reason }) {
      const result = await db.consentRecord.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt, revokedByUserId, revokeReason: reason },
      });
      if (result.count === 0) return null;
      const row = await db.consentRecord.findUnique({ where: { id } });
      return row ? mapConsent(row) : null;
    },

    async listAgreements(organizationId) {
      const rows = await db.agreementAcceptance.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        include: withTemplate,
      });
      return rows.map(mapAgreement);
    },

    async createAgreement(input) {
      const row = await db.agreementAcceptance.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          templateId: input.templateId,
          method: input.method,
          signedOn: input.signedOn,
          place: input.place,
          signatoryName: input.signatoryName,
          signatoryDesignation: input.signatoryDesignation,
          signedDocumentId: input.signedDocumentId,
          stampReference: input.stampReference,
          witnesses: input.witnesses as Prisma.InputJsonValue,
          recordedByUserId: input.recordedByUserId,
          revokedAt: input.revokedAt,
        },
        include: withTemplate,
      });
      return mapAgreement(row);
    },

    async listTemplates(providerType) {
      const rows = await db.agreementTemplate.findMany({
        where: providerType ? { providerType } : {},
        orderBy: [{ providerType: 'asc' }, { effectiveFrom: 'desc' }],
      });
      return rows.map(mapTemplate);
    },

    async findTemplate(id) {
      const row = await db.agreementTemplate.findUnique({ where: { id } });
      return row ? mapTemplate(row) : null;
    },

    async saveTemplate(input) {
      const row = await db.agreementTemplate.upsert({
        where: {
          providerType_version: {
            providerType: input.providerType,
            version: input.version,
          },
        },
        update: {
          name: input.name,
          effectiveFrom: input.effectiveFrom,
          body: input.body,
          bodyHash: input.bodyHash,
        },
        create: {
          id: input.id,
          providerType: input.providerType,
          name: input.name,
          version: input.version,
          effectiveFrom: input.effectiveFrom,
          body: input.body,
          bodyHash: input.bodyHash,
        },
      });
      return mapTemplate(row);
    },

    async createConfirmationRequest(input) {
      const row = await db.confirmationRequest.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          doctorProfileId: input.doctorProfileId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          usedAt: input.usedAt,
          revokedAt: input.revokedAt,
          confirmationMeta: input.confirmationMeta as Prisma.InputJsonValue,
          createdByUserId: input.createdByUserId,
        },
      });
      return mapConfirmation(row);
    },

    async findConfirmationRequestByTokenHash(tokenHash) {
      const row = await db.confirmationRequest.findUnique({ where: { tokenHash } });
      return row ? mapConfirmation(row) : null;
    },

    async listConfirmationRequests(organizationId) {
      const rows = await db.confirmationRequest.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map(mapConfirmation);
    },

    async updateConfirmationRequest(id, patch) {
      const row = await db.confirmationRequest.update({
        where: { id },
        data: {
          ...(patch.usedAt !== undefined ? { usedAt: patch.usedAt } : {}),
          ...(patch.revokedAt !== undefined ? { revokedAt: patch.revokedAt } : {}),
          ...(patch.confirmationMeta !== undefined
            ? { confirmationMeta: patch.confirmationMeta as Prisma.InputJsonValue }
            : {}),
        },
      });
      return mapConfirmation(row);
    },

    async markDoctorConfirmed(doctorProfileId, confirmedAt) {
      await db.doctorProfile.updateMany({
        where: { id: doctorProfileId, doctorConfirmedAt: null },
        data: { doctorConfirmedAt: confirmedAt, status: 'doctor_confirmed' },
      });
    },
  };
}
