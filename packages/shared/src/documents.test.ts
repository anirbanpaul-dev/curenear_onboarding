import { describe, expect, it } from 'vitest';
import {
  allowedDocumentMimeTypes,
  documentConfirmSchema,
  documentListQuerySchema,
  documentMaxBytes,
  documentReviewSchema,
  documentUploadUrlSchema,
} from './documents';

const id = '11111111-1111-4111-8111-111111111111';
const documentTypeId = '22222222-2222-4222-8222-222222222222';

const upload = {
  owner_type: 'provider_organization' as const,
  owner_id: id,
  document_type_id: documentTypeId,
  file_name: 'licence.pdf',
  mime_type: 'application/pdf' as const,
  size_bytes: 1024,
};

describe('document schemas', () => {
  it('accepts the supported document types up to 10 MB', () => {
    expect(documentUploadUrlSchema.safeParse(upload).success).toBe(true);
    for (const mimeType of allowedDocumentMimeTypes) {
      expect(documentUploadUrlSchema.safeParse({ ...upload, mime_type: mimeType }).success).toBe(
        true,
      );
    }
    expect(documentUploadUrlSchema.safeParse({ ...upload, expires_on: '2027-01-31' }).success).toBe(
      true,
    );
    expect(documentUploadUrlSchema.safeParse({ ...upload, expires_on: '31-01-2027' }).success).toBe(
      false,
    );
  });

  it('refuses unsupported types, zero-size and oversized uploads', () => {
    expect(documentUploadUrlSchema.safeParse({ ...upload, mime_type: 'text/html' }).success).toBe(
      false,
    );
    expect(documentUploadUrlSchema.safeParse({ ...upload, size_bytes: 0 }).success).toBe(false);
    expect(
      documentUploadUrlSchema.safeParse({ ...upload, size_bytes: documentMaxBytes + 1 }).success,
    ).toBe(false);
    expect(documentUploadUrlSchema.safeParse({ ...upload, owner_type: 'user' }).success).toBe(
      false,
    );
    expect(documentUploadUrlSchema.safeParse({ ...upload, extra: true }).success).toBe(false);
  });

  it('confirms only a SHA-256 digest and the real size', () => {
    const checksum = 'a'.repeat(64);
    expect(
      documentConfirmSchema.safeParse({ size_bytes: 1024, checksum_sha256: checksum }).success,
    ).toBe(true);
    expect(
      documentConfirmSchema.safeParse({ size_bytes: 1024, checksum_sha256: 'ABC' }).success,
    ).toBe(false);
    expect(
      documentConfirmSchema.safeParse({ size_bytes: 0, checksum_sha256: checksum }).success,
    ).toBe(false);
  });

  it('lists by owner and reviews with a reason on rejection', () => {
    expect(
      documentListQuerySchema.safeParse({ owner_type: 'provider', owner_id: id }).success,
    ).toBe(true);
    expect(documentListQuerySchema.safeParse({ owner_type: 'provider' }).success).toBe(false);

    expect(documentReviewSchema.safeParse({ status: 'VERIFIED' }).success).toBe(true);
    expect(
      documentReviewSchema.safeParse({ status: 'REJECTED', rejection_reason: 'Blurred scan' })
        .success,
    ).toBe(true);
    expect(documentReviewSchema.safeParse({ status: 'REJECTED' }).success).toBe(false);
    expect(
      documentReviewSchema.safeParse({ status: 'VERIFIED', rejection_reason: 'why' }).success,
    ).toBe(true);
    expect(documentReviewSchema.safeParse({ status: 'PENDING' }).success).toBe(false);
  });
});
