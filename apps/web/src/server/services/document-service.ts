import { createHash } from 'node:crypto';
import {
  AppError,
  documentDownloadUrlTtlSeconds,
  documentMaxBytes,
  documentUploadUrlTtlSeconds,
  outboxEventVersions,
  type Actor,
  type DocumentConfirmInput,
  type DocumentListQuery,
  type DocumentOwnerType,
  type DocumentRecord,
  type DocumentReviewInput,
  type DocumentUploadUrlInput,
  type ProviderType,
  type Repositories,
} from '@curenear/shared';
import type { ObjectStorage } from '@/server/documents/object-storage';
import type { ScanProvider } from '@/server/documents/scan';
import { extensionForMimeType, sniffAllowedMimeType } from '@/server/documents/sniff';
import type { RequestContext, ServiceDeps } from './service-deps';

export interface DocumentServiceDeps extends ServiceDeps {
  storage: ObjectStorage;
  scanner: ScanProvider;
  scanEnabled: boolean;
}

interface OwnerInfo {
  id: string;
  providerType: ProviderType;
  createdByUserId: string;
  deletedAt: Date | null;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function createDocumentService(deps: DocumentServiceDeps) {
  const { repositories, unitOfWork, now, newId, storage, scanner, scanEnabled } = deps;

  function documentNotFound(): never {
    throw new AppError('NOT_FOUND', 'Document not found');
  }

  async function loadOwner(ownerType: DocumentOwnerType, ownerId: string): Promise<OwnerInfo> {
    if (ownerType === 'provider') {
      const provider = await repositories.providers.findById(ownerId, { includeDeleted: true });
      if (!provider) throw new AppError('NOT_FOUND', 'Provider not found');
      return {
        id: provider.id,
        providerType: provider.providerType,
        createdByUserId: provider.createdByUserId,
        deletedAt: provider.deletedAt,
      };
    }

    const organization = await repositories.onboarding.findOrganizationById(ownerId, {
      includeDeleted: true,
    });
    if (!organization) throw new AppError('NOT_FOUND', 'Provider not found');
    return {
      id: organization.id,
      providerType: organization.providerType,
      createdByUserId: organization.createdByUserId,
      deletedAt: organization.deletedAt,
    };
  }

  /** Staff see only their own providers' documents; admins see everything. */
  function assertOwnerAccess(actor: Actor, owner: OwnerInfo): void {
    if (owner.deletedAt) throw new AppError('NOT_FOUND', 'Provider not found');
    if (actor.role === 'ADMIN') return;
    if (owner.createdByUserId !== actor.userId) {
      throw new AppError('NOT_FOUND', 'Provider not found');
    }
  }

  async function loadAccessibleDocument(actor: Actor, id: string): Promise<DocumentRecord> {
    const document = await repositories.documents.findById(id);
    if (!document) documentNotFound();
    const owner = await loadOwner(document.ownerType, document.ownerId);
    assertOwnerAccess(actor, owner);
    return document;
  }

  function audit(
    repos: Repositories,
    input: {
      actor: Actor;
      action: string;
      documentId: string;
      ctx: RequestContext;
      reason?: string | null;
    },
  ): Promise<void> {
    return repos.audits.append({
      id: newId(),
      actorUserId: input.actor.userId,
      actorRole: input.actor.role,
      action: input.action,
      entityType: 'document',
      entityId: input.documentId,
      requestId: input.ctx.requestId,
      changedFieldKeys: [],
      fromStatus: null,
      toStatus: null,
      reason: input.reason ?? null,
      ipAddress: input.ctx.ipAddress,
      userAgent: input.ctx.userAgent,
      createdAt: now(),
    });
  }

  /**
   * Document events feed the notification, search-index and webhook handlers.
   * The payload carries identifiers and dates only, never the file or its name.
   */
  async function emitDocumentEvent(
    repos: Repositories,
    input: {
      eventType: 'document.uploaded' | 'document.verified';
      document: DocumentRecord;
      actorUserId: string;
      occurredAt: Date;
      dedupeSuffix: string;
    },
  ): Promise<void> {
    await repos.outbox.append({
      id: newId(),
      eventType: input.eventType,
      eventVersion: outboxEventVersions[input.eventType],
      aggregateType:
        input.document.ownerType === 'provider_organization' ? 'provider_organization' : 'provider',
      aggregateId: input.document.ownerId,
      payload: {
        documentId: input.document.id,
        ownerType: input.document.ownerType,
        ownerId: input.document.ownerId,
        documentTypeCode: input.document.documentTypeCode,
        expiresOn: input.document.expiresOn
          ? input.document.expiresOn.toISOString().slice(0, 10)
          : null,
        actorUserId: input.actorUserId,
      },
      occurredAt: input.occurredAt,
      dedupeKey: `document:${input.document.id}:${input.eventType}:${input.dedupeSuffix}`,
    });
  }

  async function rejectAfterBadUpload(document: DocumentRecord, reason: string): Promise<AppError> {
    await repositories.documents.update(document.id, {
      status: 'REJECTED',
      rejectionReason: reason,
    });
    await storage.delete(document.storageKey).catch(() => undefined);
    return new AppError('VALIDATION_ERROR', reason);
  }

  return {
    async list(actor: Actor, query: DocumentListQuery): Promise<DocumentRecord[]> {
      const owner = await loadOwner(query.owner_type, query.owner_id);
      assertOwnerAccess(actor, owner);
      return repositories.documents.listByOwner(query.owner_type, query.owner_id);
    },

    /**
     * Step 1 of the upload: validate the requirement, reserve a metadata row and
     * hand the browser a presigned PUT URL. Nothing is trusted yet — confirm
     * recomputes the size and checksum from the stored bytes.
     */
    async createUploadUrl(
      actor: Actor,
      input: DocumentUploadUrlInput,
      ctx: RequestContext,
    ): Promise<{
      document: DocumentRecord;
      upload_url: string;
      upload_headers: Record<string, string>;
      expires_at: Date;
    }> {
      const owner = await loadOwner(input.owner_type, input.owner_id);
      assertOwnerAccess(actor, owner);
      if (input.size_bytes > documentMaxBytes) {
        throw new AppError('VALIDATION_ERROR', 'Files are limited to 10 MB');
      }

      const documentType = await repositories.master.documentTypes.findById(input.document_type_id);
      if (!documentType || !documentType.isActive) {
        throw new AppError('NOT_FOUND', 'Document type not found');
      }
      if (!documentType.providerTypes.includes(owner.providerType)) {
        throw new AppError(
          'VALIDATION_ERROR',
          'This document type does not apply to this provider',
          { document_type_id: documentType.id },
        );
      }
      if (documentType.requiresExpiry && !input.expires_on) {
        throw new AppError('VALIDATION_ERROR', 'An expiry date is required for this document', {
          document_type_id: documentType.id,
        });
      }

      const documentId = newId();
      const storageKey = [
        'documents',
        input.owner_type,
        input.owner_id,
        documentType.id,
        `${documentId}.${extensionForMimeType(input.mime_type)}`,
      ].join('/');

      const document = await unitOfWork.transaction((repos) =>
        repos.documents.create({
          id: documentId,
          ownerType: input.owner_type,
          ownerId: input.owner_id,
          documentTypeId: documentType.id,
          fileName: input.file_name,
          mimeType: input.mime_type,
          sizeBytes: input.size_bytes,
          storageKey,
          expiresOn: input.expires_on ? dateOnly(input.expires_on) : null,
          uploadedByUserId: actor.userId,
        }),
      );

      const uploadUrl = await storage.createUploadUrl({
        key: storageKey,
        contentType: input.mime_type,
        expiresInSeconds: documentUploadUrlTtlSeconds,
      });

      await unitOfWork.transaction((repos) =>
        audit(repos, {
          actor,
          action: 'document.upload.requested',
          documentId: document.id,
          ctx,
        }),
      );

      return {
        document,
        upload_url: uploadUrl,
        upload_headers: { 'Content-Type': input.mime_type },
        expires_at: new Date(now().getTime() + documentUploadUrlTtlSeconds * 1000),
      };
    },

    /**
     * Step 2: the object exists, its size and SHA-256 match what the client
     * claimed, and its magic bytes identify a supported type. Only then does the
     * document become usable (or PENDING_SCAN when scanning is enabled).
     */
    async confirm(
      actor: Actor,
      id: string,
      input: DocumentConfirmInput,
      ctx: RequestContext,
    ): Promise<DocumentRecord> {
      const document = await loadAccessibleDocument(actor, id);
      if (document.status === 'VERIFIED') return document;
      if (document.status !== 'UPLOADED' && document.status !== 'PENDING_SCAN') {
        throw new AppError('CONFLICT', 'This document can no longer be confirmed', {
          status: document.status,
        });
      }

      const object = await storage.read(document.storageKey);
      if (!object) {
        throw new AppError('VALIDATION_ERROR', 'The uploaded file was not found in storage');
      }
      if (object.bytes.byteLength > documentMaxBytes) {
        throw await rejectAfterBadUpload(document, 'Files are limited to 10 MB');
      }
      if (object.bytes.byteLength !== input.size_bytes || input.size_bytes !== document.sizeBytes) {
        throw await rejectAfterBadUpload(document, 'The uploaded file size does not match');
      }

      const checksum = sha256(object.bytes);
      if (checksum !== input.checksum_sha256) {
        throw await rejectAfterBadUpload(document, 'The uploaded file checksum does not match');
      }

      const detected = sniffAllowedMimeType(object.bytes);
      if (!detected) {
        throw await rejectAfterBadUpload(document, 'The file is not a valid PDF, JPG or PNG');
      }

      const confirmed = await unitOfWork.transaction(async (repos) => {
        const updated = await repos.documents.update(document.id, {
          mimeType: detected,
          sizeBytes: object.bytes.byteLength,
          checksumSha256: checksum,
          status: scanEnabled ? 'PENDING_SCAN' : 'UPLOADED',
        });
        if (!updated) documentNotFound();
        await audit(repos, {
          actor,
          action: 'document.uploaded',
          documentId: updated.id,
          ctx,
        });
        await emitDocumentEvent(repos, {
          eventType: 'document.uploaded',
          document: updated,
          actorUserId: actor.userId,
          occurredAt: now(),
          dedupeSuffix: 'confirm',
        });
        return updated;
      });

      if (!scanEnabled) return confirmed;

      const scan = await scanner.scan({
        key: confirmed.storageKey,
        mimeType: confirmed.mimeType,
        bytes: object.bytes,
      });
      if (!scan.clean) {
        await repositories.documents.update(confirmed.id, {
          status: 'REJECTED',
          rejectionReason: 'The file failed the malware scan',
        });
        await storage.delete(confirmed.storageKey).catch(() => undefined);
        throw new AppError('VALIDATION_ERROR', 'The file failed the malware scan');
      }

      const clean = await unitOfWork.transaction(async (repos) => {
        const updated = await repos.documents.update(confirmed.id, { status: 'UPLOADED' });
        if (!updated) documentNotFound();
        await audit(repos, {
          actor,
          action: 'document.scan.clean',
          documentId: updated.id,
          ctx,
        });
        return updated;
      });
      return clean;
    },

    /** Short-lived GET URL; every download writes an audit row. */
    async createDownloadUrl(
      actor: Actor,
      id: string,
      ctx: RequestContext,
    ): Promise<{ url: string; expires_at: Date }> {
      const document = await loadAccessibleDocument(actor, id);
      const url = await storage.createDownloadUrl({
        key: document.storageKey,
        expiresInSeconds: documentDownloadUrlTtlSeconds,
      });
      await repositories.audits.append({
        id: newId(),
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'document.downloaded',
        entityType: 'document',
        entityId: document.id,
        requestId: ctx.requestId,
        changedFieldKeys: [],
        fromStatus: null,
        toStatus: null,
        reason: null,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        createdAt: now(),
      });
      return {
        url,
        expires_at: new Date(now().getTime() + documentDownloadUrlTtlSeconds * 1000),
      };
    },

    /** Administrators confirm or reject a reviewed document. */
    async review(
      actor: Actor,
      id: string,
      input: DocumentReviewInput,
      ctx: RequestContext,
    ): Promise<DocumentRecord> {
      if (actor.role !== 'ADMIN') {
        throw new AppError('FORBIDDEN', 'Only administrators can review documents');
      }
      const document = await repositories.documents.findById(id);
      if (!document) documentNotFound();
      if (document.status === 'PENDING_SCAN') {
        throw new AppError('CONFLICT', 'This document is still being scanned', {
          status: document.status,
        });
      }

      return unitOfWork.transaction(async (repos) => {
        const updated = await repos.documents.update(id, {
          status: input.status,
          verifiedByUserId: actor.userId,
          verifiedAt: now(),
          rejectionReason: input.status === 'REJECTED' ? (input.rejection_reason ?? null) : null,
        });
        if (!updated) documentNotFound();
        await audit(repos, {
          actor,
          action: input.status === 'VERIFIED' ? 'document.verified' : 'document.rejected',
          documentId: updated.id,
          ctx,
          reason: input.rejection_reason ?? null,
        });
        if (input.status === 'VERIFIED') {
          await emitDocumentEvent(repos, {
            eventType: 'document.verified',
            document: updated,
            actorUserId: actor.userId,
            occurredAt: now(),
            dedupeSuffix: `verified:${now().toISOString()}`,
          });
        }
        return updated;
      });
    },

    async remove(actor: Actor, id: string, ctx: RequestContext): Promise<{ deleted: true }> {
      const document = await loadAccessibleDocument(actor, id);
      await unitOfWork.transaction(async (repos) => {
        const removed = await repos.documents.softDelete(document.id, now());
        if (!removed) documentNotFound();
        await audit(repos, {
          actor,
          action: 'document.deleted',
          documentId: document.id,
          ctx,
        });
      });
      await storage.delete(document.storageKey).catch(() => undefined);
      return { deleted: true };
    },
  };
}

export type DocumentService = ReturnType<typeof createDocumentService>;
