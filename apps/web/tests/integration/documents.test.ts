import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPersistence, createPrismaClient } from '@curenear/db';
import type { Actor } from '@curenear/shared';
import { createNoopScanProvider } from '@/server/documents/scan';
import type { ObjectStorage } from '@/server/documents/object-storage';
import { createDocumentService } from '@/server/services/document-service';

/**
 * The document service against real PostgreSQL, with an in-memory object store
 * instead of MinIO. Covers the upload/confirm verification, authorization,
 * mime spoofing, oversize uploads and the expiry rule.
 */
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, Uint8Array>();

  async createUploadUrl(input: { key: string }): Promise<string> {
    return `https://storage.test/${input.key}?signature=put`;
  }

  async createDownloadUrl(input: { key: string }): Promise<string> {
    return `https://storage.test/${input.key}?signature=get`;
  }

  async read(key: string) {
    const bytes = this.objects.get(key);
    return bytes ? { bytes, size: bytes.byteLength } : null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

const ctx = () => ({
  requestId: randomUUID(),
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
});

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const pdfBytes = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

describeDb('document service (real PostgreSQL)', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let storage: MemoryStorage;
  let service: ReturnType<typeof createDocumentService>;
  let admin: Actor;
  let staffA: Actor;
  let staffB: Actor;
  let providerAId = '';
  let providerBId = '';
  let documentTypeId = '';
  let expiryDocumentTypeId = '';
  const userIds: string[] = [];

  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl as string);
    const persistence = createPersistence(prisma);
    storage = new MemoryStorage();
    service = createDocumentService({
      ...persistence,
      now: () => new Date(),
      newId: () => randomUUID(),
      storage,
      scanner: createNoopScanProvider(),
      scanEnabled: false,
    });

    async function account(email: string, role: 'ADMIN' | 'STAFF') {
      return prisma.user.upsert({
        where: { email },
        update: { role, status: 'ACTIVE', mustChangePassword: false, deletedAt: null },
        create: {
          id: randomUUID(),
          email,
          name: email,
          passwordHash: 'not-used-by-the-service',
          role,
        },
      });
    }
    const adminUser = await account('documents-admin@test.local', 'ADMIN');
    const staffAUser = await account('documents-a@test.local', 'STAFF');
    const staffBUser = await account('documents-b@test.local', 'STAFF');
    userIds.push(adminUser.id, staffAUser.id, staffBUser.id);
    admin = { userId: adminUser.id, role: 'ADMIN' };
    staffA = { userId: staffAUser.id, role: 'STAFF' };
    staffB = { userId: staffBUser.id, role: 'STAFF' };

    await prisma.provider.deleteMany({ where: { createdByUserId: { in: userIds } } });
    const providerA = await prisma.provider.create({
      data: { providerType: 'clinic', createdByUserId: staffAUser.id, displayName: 'Docs A' },
    });
    const providerB = await prisma.provider.create({
      data: { providerType: 'clinic', createdByUserId: staffBUser.id, displayName: 'Docs B' },
    });
    providerAId = providerA.id;
    providerBId = providerB.id;

    const plain = await prisma.documentType.upsert({
      where: { code: 'test-document-plain' },
      update: { providerTypes: ['clinic'], requiresExpiry: false, isActive: true },
      create: {
        id: randomUUID(),
        code: 'test-document-plain',
        name: 'Test document',
        providerTypes: ['clinic'],
        requiresExpiry: false,
        expiryReminderDays: [],
      },
    });
    const expiring = await prisma.documentType.upsert({
      where: { code: 'test-document-expiring' },
      update: { providerTypes: ['clinic'], requiresExpiry: true, isActive: true },
      create: {
        id: randomUUID(),
        code: 'test-document-expiring',
        name: 'Test licence',
        providerTypes: ['clinic'],
        requiresExpiry: true,
        expiryReminderDays: [60, 30, 7],
      },
    });
    documentTypeId = plain.id;
    expiryDocumentTypeId = expiring.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.document.deleteMany({ where: { ownerId: { in: [providerAId, providerBId] } } });
    await prisma.provider.deleteMany({ where: { createdByUserId: { in: userIds } } });
    await prisma.documentType.deleteMany({
      where: { code: { in: ['test-document-plain', 'test-document-expiring'] } },
    });
    await prisma.$disconnect();
  });

  async function startUpload(
    actor: Actor,
    overrides: Partial<{
      ownerId: string;
      documentTypeId: string;
      declaredMime: string;
      sizeBytes: number;
      expiresOn: string;
    }> = {},
  ) {
    return service.createUploadUrl(
      actor,
      {
        owner_type: 'provider',
        owner_id: overrides.ownerId ?? providerAId,
        document_type_id: overrides.documentTypeId ?? documentTypeId,
        file_name: 'licence.pdf',
        mime_type: (overrides.declaredMime ?? 'application/pdf') as 'application/pdf',
        size_bytes: overrides.sizeBytes ?? pdfBytes.byteLength,
        ...(overrides.expiresOn ? { expires_on: overrides.expiresOn } : {}),
      },
      ctx(),
    );
  }

  async function uploadConfirmed(
    actor: Actor,
    bytes: Uint8Array,
    overrides: Parameters<typeof startUpload>[1] = {},
  ) {
    const started = await startUpload(actor, {
      ...overrides,
      sizeBytes: bytes.byteLength,
    });
    storage.objects.set(started.document.storageKey, bytes);
    return service.confirm(
      actor,
      started.document.id,
      { size_bytes: bytes.byteLength, checksum_sha256: sha256(bytes) },
      ctx(),
    );
  }

  it('confirms a PDF after verifying size, checksum and magic bytes, then audits the download', async () => {
    const document = await uploadConfirmed(staffA, pdfBytes);
    expect(document.status).toBe('UPLOADED');
    expect(document.mimeType).toBe('application/pdf');
    expect(document.checksumSha256).toBe(sha256(pdfBytes));

    const download = await service.createDownloadUrl(staffA, document.id, ctx());
    expect(download.url).toContain('signature=get');
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'document', entityId: document.id, action: 'document.downloaded' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.changedFieldKeys).toEqual([]);
  });

  it("refuses to confirm one staff member's upload for another staff member", async () => {
    const started = await startUpload(staffA, { declaredMime: 'image/png' });
    storage.objects.set(started.document.storageKey, PNG_BYTES);

    await expect(
      service.confirm(
        staffB,
        started.document.id,
        { size_bytes: PNG_BYTES.byteLength, checksum_sha256: sha256(PNG_BYTES) },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("refuses to hand a staff member another staff member's document URL", async () => {
    const document = await uploadConfirmed(staffA, pdfBytes);
    await expect(service.createDownloadUrl(staffB, document.id, ctx())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      service.list(staffB, { owner_type: 'provider', owner_id: providerAId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const adminDownload = await service.createDownloadUrl(admin, document.id, ctx());
    expect(adminDownload.url).toContain('signature=get');
  });

  it('rejects a file whose bytes are not the declared PDF/JPEG/PNG type', async () => {
    const spoofed = new TextEncoder().encode('<script>alert(1)</script>');
    const started = await startUpload(staffA, {
      declaredMime: 'image/png',
      sizeBytes: spoofed.byteLength,
    });
    storage.objects.set(started.document.storageKey, spoofed);

    await expect(
      service.confirm(
        staffA,
        started.document.id,
        { size_bytes: spoofed.byteLength, checksum_sha256: sha256(spoofed) },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const stored = await prisma.document.findUnique({ where: { id: started.document.id } });
    expect(stored?.status).toBe('REJECTED');
    expect(storage.objects.has(started.document.storageKey)).toBe(false);
  });

  it('rejects a declared or actual upload over 10 MB', async () => {
    await expect(startUpload(staffA, { sizeBytes: 10 * 1024 * 1024 + 1 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
    oversized.set(pdfBytes);
    const started = await startUpload(staffA, { sizeBytes: pdfBytes.byteLength });
    storage.objects.set(started.document.storageKey, oversized);
    await expect(
      service.confirm(
        staffA,
        started.document.id,
        { size_bytes: oversized.byteLength, checksum_sha256: sha256(oversized) },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('enforces expires_on when the document type tracks expiry', async () => {
    await expect(
      startUpload(staffA, { documentTypeId: expiryDocumentTypeId }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const document = await uploadConfirmed(staffA, pdfBytes, {
      documentTypeId: expiryDocumentTypeId,
      expiresOn: '2027-03-31',
    });
    expect(document.expiresOn?.toISOString()).toBe('2027-03-31T00:00:00.000Z');
  });
});
