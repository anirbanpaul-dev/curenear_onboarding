import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPersistence, createPrismaClient } from '@curenear/db';
import {
  adminProviderListQuerySchema,
  staffProviderListQuerySchema,
  type Actor,
} from '@curenear/shared';
import { createProviderOnboardingService } from '@/server/services/provider-onboarding-service';
import { createAdminDirectoryService } from '@/server/services/admin-directory-service';
import { createStaffWorkspaceService } from '@/server/services/staff-workspace-service';
import { createConsentService } from '@/server/services/consent-service';
import { createDocumentService } from '@/server/services/document-service';
import { createStaffService } from '@/server/services/staff-service';

/**
 * Staff isolation (prompt 5, requirement 4).
 *
 * Two staff members each own a provider. Every read or write staff B can aim at
 * staff A's provider must answer 404, the owner-scoped list/search/export paths
 * must not return it, and admin-only fields and review notes must not cross the
 * boundary.
 */
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

const ctx = () => ({ requestId: randomUUID(), ipAddress: '127.0.0.1', userAgent: 'vitest' });

const fakeStorage = {
  createUploadUrl: async () => ({ url: 'https://storage.invalid/upload', key: 'x' }),
  createDownloadUrl: async () => 'https://storage.invalid/download',
  delete: async () => undefined,
  head: async () => ({ size: 0, contentType: 'application/pdf' }),
};

describeDb('staff isolation (real PostgreSQL)', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let onboarding: ReturnType<typeof createProviderOnboardingService>;
  let consents: ReturnType<typeof createConsentService>;
  let documents: ReturnType<typeof createDocumentService>;
  let directory: ReturnType<typeof createAdminDirectoryService>;
  let staffWorkspace: ReturnType<typeof createStaffWorkspaceService>;
  let staffService: ReturnType<typeof createStaffService>;

  let admin: Actor;
  let staffA: Actor;
  let staffB: Actor;

  let alphaId = '';
  let betaId = '';
  let alphaFileId = '';

  const emails = [
    'isolation-admin@test.local',
    'isolation-staff-a@test.local',
    'isolation-staff-b@test.local',
  ];
  const comment = 'Upload the current fire-safety certificate and correct the registered PIN.';

  async function ensureUser(email: string, role: 'ADMIN' | 'STAFF'): Promise<Actor> {
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        role,
        status: 'ACTIVE',
        deletedAt: null,
        mustChangePassword: false,
        name: email,
      },
      create: {
        id: randomUUID(),
        email,
        name: email,
        passwordHash: 'not-used',
        role,
        status: 'ACTIVE',
      },
    });
    return { userId: user.id, role };
  }

  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl as string);
    const persistence = createPersistence(prisma);
    const deps = { ...persistence, now: () => new Date(), newId: () => randomUUID() };

    admin = await ensureUser(emails[0]!, 'ADMIN');
    staffA = await ensureUser(emails[1]!, 'STAFF');
    staffB = await ensureUser(emails[2]!, 'STAFF');

    // Fresh start makes the test rerunnable.
    await prisma.providerOrganization.deleteMany({
      where: { createdByUserId: { in: [staffA.userId, staffB.userId] } },
    });

    onboarding = createProviderOnboardingService(deps);
    directory = createAdminDirectoryService(deps);
    consents = createConsentService({
      ...deps,
      appUrl: 'http://localhost:3000',
      environment: 'test',
      confirmationLinksEnabled: false,
      storage: fakeStorage as never,
    });
    documents = createDocumentService({
      ...deps,
      storage: fakeStorage as never,
      scanner: { scan: async () => ({ clean: true }) } as never,
      scanEnabled: false,
    });
    staffService = createStaffService({
      ...deps,
      appUrl: 'http://localhost:3000',
      email: { send: async () => undefined } as never,
    });
    staffWorkspace = createStaffWorkspaceService({
      repositories: persistence.repositories,
      now: () => new Date(),
      onboarding,
    });

    const alpha = await onboarding.create(
      staffA,
      {
        provider_type: 'clinic',
        legal_name: 'Alpha Secret Clinic',
        mobile: '9830099991',
        primary_pin_code: '700091',
      },
      ctx(),
    );
    alphaId = alpha.provider.id;

    const beta = await onboarding.create(
      staffB,
      {
        provider_type: 'pharmacy',
        legal_name: 'Beta Visible Pharmacy',
        mobile: '9830099992',
        primary_pin_code: '700092',
      },
      ctx(),
    );
    betaId = beta.provider.id;

    // An admin-only pharmacy switch, and a change request addressed to staff A.
    await prisma.providerOrganization.update({
      where: { id: betaId },
      data: {
        typeData: { ph_online_enabled: true, ph_online_categories: ['OTC'] },
      },
    });
    await prisma.providerOrganization.update({
      where: { id: alphaId },
      data: { status: 'CHANGES_REQUESTED' },
    });
    await prisma.providerStatusHistory.create({
      data: {
        id: randomUUID(),
        organizationId: alphaId,
        fromStatus: 'SUBMITTED',
        toStatus: 'CHANGES_REQUESTED',
        changedByUserId: admin.userId,
        reason: comment,
        at: new Date(),
      },
    });

    await onboarding.createDocument(staffA, alphaId, {
      file_name: 'fire-safety.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1024,
      role: 'medical_registration',
    });

    // A generic `documents` row, which is what /api/v1/documents/[id]/download-url
    // serves. Created directly so the test does not depend on object storage.
    const documentType = await prisma.documentType.findFirst();
    if (!documentType) throw new Error('No document types are seeded');
    const file = await prisma.document.create({
      data: {
        ownerType: 'provider_organization',
        ownerId: alphaId,
        documentTypeId: documentType.id,
        fileName: 'fire-safety.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        storageKey: `isolation/${randomUUID()}.pdf`,
        uploadedByUserId: staffA.userId,
      },
    });
    alphaFileId = file.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.document.deleteMany({
      where: { uploadedByUserId: { in: [staffA.userId, staffB.userId] } },
    });
    await prisma.providerOrganization.deleteMany({
      where: { createdByUserId: { in: [staffA.userId, staffB.userId].filter(Boolean) } },
    });
    // The audit log is append-only, so the fixture users stay behind rather
    // than being deleted (the upsert in beforeAll reuses them).
    await prisma.$disconnect();
  });

  it('404s every provider-scoped call staff B aims at staff A’s provider', async () => {
    const probes: Array<[string, () => Promise<unknown>]> = [
      ['get', () => onboarding.get(staffB, alphaId)],
      ['completeness', () => onboarding.completeness(staffB, alphaId)],
      ['listDocuments', () => onboarding.listDocuments(staffB, alphaId)],
      [
        'createDocument',
        () =>
          onboarding.createDocument(staffB, alphaId, {
            file_name: 'sneaky.pdf',
            mime_type: 'application/pdf',
            size_bytes: 10,
            role: 'medical_registration',
          }),
      ],
      [
        'saveSection',
        () =>
          onboarding.saveSection(
            staffB,
            alphaId,
            'legal_entity',
            { version: 1, data: { legal_name: 'Hijacked' } },
            ctx(),
          ),
      ],
      ['submit', () => onboarding.submit(staffB, alphaId, {}, ctx())],
      [
        'transitionStatus',
        () => onboarding.transitionStatus(staffB, alphaId, { to: 'APPROVED' }, ctx()),
      ],
      ['listStatusHistory', () => onboarding.listStatusHistory(staffB, alphaId)],
      ['listDuplicateWarnings', () => onboarding.listDuplicateWarnings(staffB, alphaId)],
      ['consents.get', () => consents.get(staffB, alphaId)],
      [
        'consents.capture',
        () =>
          consents.capture(
            staffB,
            alphaId,
            {
              method: 'IN_PERSON_ATTESTATION',
              attestation_name: 'Not the owner',
              items: [{ consent_type: 'publication' }],
            },
            ctx(),
          ),
      ],
      [
        'documents.createDownloadUrl',
        () => documents.createDownloadUrl(staffB, alphaFileId, ctx()),
      ],
      ['documents.remove', () => documents.remove(staffB, alphaFileId, ctx())],
    ];

    for (const [name, probe] of probes) {
      await expect(probe(), name).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }

    // The owner still reaches the same record.
    const own = await onboarding.get(staffA, alphaId);
    expect(own.organization.id).toBe(alphaId);
    await expect(documents.createDownloadUrl(staffA, alphaFileId, ctx())).resolves.toBeTruthy();
  });

  it('scopes lists, search, duplicate preview and export to the owner', async () => {
    const bList = await onboarding.list(staffB);
    expect(bList.map((row) => row.id)).toEqual([betaId]);

    const bWorkspace = await staffWorkspace.list(
      staffB,
      staffProviderListQuerySchema.parse({ q: 'Alpha Secret' }),
    );
    expect(bWorkspace.meta.total).toBe(0);
    expect(bWorkspace.rows).toHaveLength(0);

    const bAll = await staffWorkspace.list(staffB, staffProviderListQuerySchema.parse({}));
    expect(bAll.rows.map((row) => row.id)).toEqual([betaId]);

    // The search endpoint cannot be widened through a URL parameter.
    expect(() => staffProviderListQuerySchema.parse({ onboardedBy: staffA.userId })).toThrow();

    // Duplicate preview: cross-staff matches may warn, but never identify the
    // other provider.
    const preview = await onboarding.previewDuplicates(staffB, {
      legal_name: 'Alpha Secret Clinic',
      mobile: '9830099991',
      pin_code: '700091',
    });
    for (const entry of [...preview.warnings, ...preview.blocked]) {
      expect(entry.providerId).toBe('');
      expect(entry.providerCode).toBe('');
      expect(entry.providerName).toBeNull();
      expect(entry.link).toBe('');
    }
    expect(JSON.stringify(preview)).not.toContain('Alpha Secret Clinic');
    expect(JSON.stringify(preview)).not.toContain('CN-CL-');

    // The same search as admin still finds it, so the scoping is by role only.
    const adminPreview = await onboarding.previewDuplicates(admin, {
      legal_name: 'Alpha Secret Clinic',
      pin_code: '700091',
    });
    expect(adminPreview.warnings.some((row) => row.providerId === alphaId)).toBe(true);

    // Export is the admin directory's CSV source: staff are refused outright.
    await expect(
      directory.list(staffB, adminProviderListQuerySchema.parse({ pageSize: 100 })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      directory.list(staffB, adminProviderListQuerySchema.parse({ onboardedBy: staffA.userId })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const adminRows = await directory.list(
      admin,
      adminProviderListQuerySchema.parse({ onboardedBy: staffA.userId }),
    );
    expect(adminRows.rows.map((row) => row.id)).toEqual([alphaId]);
  });

  it('hides admin-only fields from staff but not from the admin directory', async () => {
    const bView = await onboarding.get(staffB, betaId);
    expect(bView.organization.typeData).not.toHaveProperty('ph_online_enabled');
    expect(bView.organization.typeData).not.toHaveProperty('ph_online_categories');

    const adminView = await directory.get(admin, betaId);
    expect(adminView.detail.organization.typeData.ph_online_enabled).toBe(true);

    const listed = await onboarding.list(staffB);
    expect(listed[0]?.typeData).not.toHaveProperty('ph_online_enabled');
  });

  it('shows the change-request comment to the owner only', async () => {
    const owner = await onboarding.get(staffA, alphaId);
    expect(owner.organization.status).toBe('CHANGES_REQUESTED');
    expect(owner.changeRequest?.comment).toBe(comment);

    const listed = await staffWorkspace.list(staffA, staffProviderListQuerySchema.parse({}));
    expect(listed.rows[0]?.changeRequest?.comment).toBe(comment);

    const bDashboard = await staffWorkspace.dashboard(staffB);
    expect(bDashboard.total).toBe(1);
    expect(bDashboard.returned).toEqual([]);
    expect(JSON.stringify(bDashboard)).not.toContain(comment);
    expect(JSON.stringify(bDashboard)).not.toContain('Alpha Secret Clinic');

    const aDashboard = await staffWorkspace.dashboard(staffA);
    expect(aDashboard.returned.map((row) => row.comment)).toContain(comment);
    expect(aDashboard.monthly.count).toBe(1);
  });

  it('reports real admin staff-detail counts for provider organizations', async () => {
    const detail = await staffService.get(admin, staffA.userId);
    expect(detail.providerCount).toBe(1);

    const summary = await directory.list(
      admin,
      adminProviderListQuerySchema.parse({ onboardedBy: staffA.userId }),
    );
    expect(summary.meta.total).toBe(1);
    expect(summary.facets.byStatus).toEqual([{ status: 'CHANGES_REQUESTED', count: 1 }]);
  });
});
