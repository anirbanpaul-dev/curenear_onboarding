import { z } from 'zod';
import type { ProviderType } from './enums';

/**
 * Reusable document service contracts.
 *
 * A document belongs to an owner (a portal `provider` or a normalized
 * `provider_organization`) and to a master `document_type`, which carries the
 * expiry rule. Files are never served from this app: the browser PUTs to a
 * presigned URL and later asks for a short-lived presigned GET URL.
 */

export const documentOwnerTypes = ['provider', 'provider_organization'] as const;
export type DocumentOwnerType = (typeof documentOwnerTypes)[number];

/**
 * `PENDING_SCAN` exists because a confirmed upload stays unverified while the
 * malware scanner runs. The other four values are the document lifecycle.
 */
export const documentStatuses = [
  'PENDING_SCAN',
  'UPLOADED',
  'VERIFIED',
  'REJECTED',
  'EXPIRED',
] as const;
export type DocumentStatus = (typeof documentStatuses)[number];

export const allowedDocumentMimeTypes = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type AllowedDocumentMimeType = (typeof allowedDocumentMimeTypes)[number];

export const documentMaxBytes = 10 * 1024 * 1024;
export const documentUploadUrlTtlSeconds = 300;
export const documentDownloadUrlTtlSeconds = 300;
export const documentChecksumPattern = /^[a-f0-9]{64}$/;

export const documentIdParamsSchema = z.object({ id: z.string().uuid() }).strict();

const mimeTypeSchema = z.enum(allowedDocumentMimeTypes);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');

export const documentUploadUrlSchema = z
  .object({
    owner_type: z.enum(documentOwnerTypes),
    owner_id: z.string().uuid(),
    document_type_id: z.string().uuid(),
    file_name: z.string().trim().min(1).max(200),
    mime_type: mimeTypeSchema,
    size_bytes: z.number().int().positive().max(documentMaxBytes, 'Files are limited to 10 MB'),
    /** Required when the document type tracks expiry. */
    expires_on: isoDate.optional(),
  })
  .strict();
export type DocumentUploadUrlInput = z.infer<typeof documentUploadUrlSchema>;

export const documentConfirmSchema = z
  .object({
    size_bytes: z.number().int().positive().max(documentMaxBytes),
    checksum_sha256: z.string().regex(documentChecksumPattern, 'Expected a SHA-256 hex digest'),
  })
  .strict();
export type DocumentConfirmInput = z.infer<typeof documentConfirmSchema>;

export const documentListQuerySchema = z
  .object({
    owner_type: z.enum(documentOwnerTypes),
    owner_id: z.string().uuid(),
  })
  .strict();
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;

/** Administrators confirm or reject a document after review. */
export const documentReviewSchema = z
  .object({
    status: z.enum(['VERIFIED', 'REJECTED']),
    rejection_reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict()
  .refine((value) => value.status !== 'REJECTED' || Boolean(value.rejection_reason), {
    message: 'A rejection needs a reason',
    path: ['rejection_reason'],
  });
export type DocumentReviewInput = z.infer<typeof documentReviewSchema>;

export interface DocumentTypeRef {
  id: string;
  code: string;
  name: string;
  providerTypes: ProviderType[];
  requiresExpiry: boolean;
}

export interface DocumentRecord {
  id: string;
  ownerType: DocumentOwnerType;
  ownerId: string;
  documentTypeId: string;
  documentTypeCode: string;
  documentTypeName: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  /** Null until the upload is confirmed and the server has hashed the bytes. */
  checksumSha256: string | null;
  status: DocumentStatus;
  expiresOn: Date | null;
  uploadedByUserId: string;
  verifiedByUserId: string | null;
  verifiedAt: Date | null;
  rejectionReason: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentCreateInput {
  id: string;
  ownerType: DocumentOwnerType;
  ownerId: string;
  documentTypeId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  expiresOn: Date | null;
  uploadedByUserId: string;
}

export interface DocumentUpdatePatch {
  status?: DocumentStatus;
  mimeType?: string;
  sizeBytes?: number;
  checksumSha256?: string;
  expiresOn?: Date | null;
  verifiedByUserId?: string | null;
  verifiedAt?: Date | null;
  rejectionReason?: string | null;
  deletedAt?: Date | null;
}
