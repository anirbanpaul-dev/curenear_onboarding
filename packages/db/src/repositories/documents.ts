import type {
  DocumentExpiryCandidate,
  DocumentRecord,
  DocumentRepository,
  DocumentUpdatePatch,
  LicenceExpiryCandidate,
} from '@curenear/shared';
import { Prisma } from '@prisma/client';
import type { DbClient } from '../client';

/** Licence reminders use a fixed ladder; document types configure their own. */
const LICENCE_REMINDER_DAYS = [60, 30, 7];

const withType = {
  documentType: { select: { code: true, name: true, expiryReminderDays: true } },
} as const;

type DocumentRow = Prisma.DocumentGetPayload<{ include: typeof withType }>;

function mapDocument(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    documentTypeId: row.documentTypeId,
    documentTypeCode: row.documentType.code,
    documentTypeName: row.documentType.name,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    storageKey: row.storageKey,
    checksumSha256: row.checksumSha256,
    status: row.status,
    expiresOn: row.expiresOn,
    uploadedByUserId: row.uploadedByUserId,
    verifiedByUserId: row.verifiedByUserId,
    verifiedAt: row.verifiedAt,
    rejectionReason: row.rejectionReason,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDocumentRepository(db: DbClient): DocumentRepository {
  return {
    async create(input) {
      const row = await db.document.create({
        data: {
          id: input.id,
          ownerType: input.ownerType,
          ownerId: input.ownerId,
          documentTypeId: input.documentTypeId,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          storageKey: input.storageKey,
          expiresOn: input.expiresOn,
          uploadedByUserId: input.uploadedByUserId,
        },
        include: withType,
      });
      return mapDocument(row);
    },

    async findById(id, options) {
      const row = await db.document.findFirst({
        where: { id, ...(options?.includeDeleted ? {} : { deletedAt: null }) },
        include: withType,
      });
      return row ? mapDocument(row) : null;
    },

    async listByOwner(ownerType, ownerId) {
      const rows = await db.document.findMany({
        where: { ownerType, ownerId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: withType,
      });
      return rows.map(mapDocument);
    },

    async update(id, patch: DocumentUpdatePatch) {
      const row = await db.document.update({ where: { id }, data: patch, include: withType });
      return mapDocument(row);
    },

    async softDelete(id, deletedAt) {
      const result = await db.document.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt },
      });
      return result.count > 0;
    },

    async listExpiring(before, limit) {
      const rows = await db.document.findMany({
        where: {
          ownerType: 'provider_organization',
          deletedAt: null,
          expiresOn: { not: null, lt: before },
          status: { in: ['PENDING_SCAN', 'UPLOADED', 'VERIFIED'] },
        },
        orderBy: { expiresOn: 'asc' },
        take: limit,
        include: withType,
      });

      return rows.flatMap((row): DocumentExpiryCandidate[] => {
        if (!row.expiresOn || row.ownerType !== 'provider_organization') return [];
        return [
          {
            documentId: row.id,
            organizationId: row.ownerId,
            documentTypeCode: row.documentType.code,
            documentTypeName: row.documentType.name,
            expiresOn: row.expiresOn,
            reminderDays: row.documentType.expiryReminderDays,
            status: row.status,
            uploadedByUserId: row.uploadedByUserId,
            fileName: row.fileName,
          },
        ];
      });
    },

    async listLicencesExpiring(before, limit) {
      const rows = await db.$queryRaw<
        Array<{
          licenceId: string;
          organizationId: string;
          number: string;
          licenceTypeName: string | null;
          validTo: Date;
        }>
      >(Prisma.sql`
        SELECT
          l."id" AS "licenceId",
          l."organization_id" AS "organizationId",
          l."number" AS "number",
          lt."name" AS "licenceTypeName",
          l."valid_to" AS "validTo"
        FROM "provider_licences" l
        LEFT JOIN "licence_types" lt ON lt."id" = l."licence_type_id"
        WHERE l."valid_to" IS NOT NULL AND l."valid_to" < ${before}
        ORDER BY l."valid_to" ASC
        LIMIT ${limit}
      `);

      return rows.map((row): LicenceExpiryCandidate => ({
        licenceId: row.licenceId,
        organizationId: row.organizationId,
        licenceNumber: row.number,
        licenceTypeName: row.licenceTypeName,
        validTo: row.validTo,
        reminderDays: LICENCE_REMINDER_DAYS,
      }));
    },

    async markExpired(id) {
      const result = await db.document.updateMany({
        where: { id, status: { not: 'EXPIRED' } },
        data: { status: 'EXPIRED' },
      });
      return result.count > 0;
    },

    async setComplianceFlag(input) {
      await db.providerOrganization.updateMany({
        where: { id: input.organizationId },
        data: {
          complianceFlag: input.flagged,
          complianceFlagReason: input.reason,
        },
      });
    },
  };
}
