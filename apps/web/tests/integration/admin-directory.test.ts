import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import {
  adminProviderListQuerySchema,
  documentRequirementsFor,
  sectionsForProvider,
  type Actor,
  type ProviderType,
} from '@curenear/shared';
import {
  createPersistence,
  createPrismaClient,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
} from '@curenear/db';
import { createAdminDirectoryService } from '@/server/services/admin-directory-service';

/**
 * The directory runs against real PostgreSQL: the filters are SQL, and a fake
 * repository would test nothing that matters. Fixtures live under PIN prefix
 * 7999 and are removed afterwards.
 */
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;
const MARKER = 'IT-DIR-';
const PIN_PREFIX = '7999';

interface Fixture {
  id: string;
  type: 'pharmacy' | 'clinic' | 'care_provider' | 'diagnostic_centre';
  pin: string;
  staff: 'a' | 'b';
  created: string;
  submitted: string | null;
  documents: 'all' | 'none';
  licenceExpiring: boolean;
  name: string;
  mobile: string;
}

const fixtures: Fixture[] = [
  {
    id: 'alpha',
    type: 'pharmacy',
    pin: '799901',
    staff: 'a',
    created: '2026-01-10',
    submitted: '2026-01-11',
    documents: 'all',
    licenceExpiring: false,
    name: 'Alpha Pharmacy',
    mobile: '9810000001',
  },
  {
    id: 'bravo',
    type: 'pharmacy',
    pin: '799902',
    staff: 'a',
    created: '2026-02-10',
    submitted: null,
    documents: 'none',
    licenceExpiring: true,
    name: 'Bravo Pharmacy',
    mobile: '9810000002',
  },
  {
    id: 'charlie',
    type: 'clinic',
    pin: '799903',
    staff: 'b',
    created: '2026-03-10',
    submitted: '2026-03-12',
    documents: 'none',
    licenceExpiring: false,
    name: 'Charlie Clinic',
    mobile: '9810000003',
  },
  {
    id: 'delta',
    type: 'clinic',
    pin: '799904',
    staff: 'b',
    created: '2026-04-10',
    submitted: '2026-04-11',
    documents: 'all',
    licenceExpiring: false,
    name: 'Delta Clinic',
    mobile: '9810000004',
  },
  {
    id: 'echo',
    type: 'care_provider',
    pin: '799911',
    staff: 'a',
    created: '2026-05-10',
    submitted: null,
    documents: 'all',
    licenceExpiring: false,
    name: 'Echo Care',
    mobile: '9810000005',
  },
  {
    id: 'foxtrot',
    type: 'diagnostic_centre',
    pin: '799912',
    staff: 'b',
    created: '2026-06-10',
    submitted: '2026-06-12',
    documents: 'none',
    licenceExpiring: false,
    name: 'Foxtrot Diagnostics',
    mobile: '9810000006',
  },
  {
    id: 'golf',
    type: 'pharmacy',
    pin: '799921',
    staff: 'a',
    created: '2026-07-10',
    submitted: '2026-07-11',
    documents: 'all',
    licenceExpiring: false,
    name: 'Golf Pharmacy',
    mobile: '9810000007',
  },
];

/** Licence roles whose licence row must carry a document (registry-driven). */
function requiredLicenceRoles(providerType: ProviderType): string[] {
  const roles = new Set<string>();
  for (const section of sectionsForProvider(providerType)) {
    for (const field of section.fields) {
      if (field.storage.kind !== 'related' || field.storage.table !== 'provider_licences') {
        continue;
      }
      const requiresFile = (field.items ?? []).some(
        (item) => item.type === 'file' && (item.requirement ?? field.requirement) === 'required',
      );
      if (requiresFile && field.storage.role) roles.add(field.storage.role);
    }
  }
  return [...roles];
}

const statusFor = (fixture: Fixture) =>
  fixture.submitted === null ? 'DRAFT' : fixture.id === 'delta' ? 'APPROVED' : 'SUBMITTED';

describeDb('admin provider directory (real PostgreSQL)', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: ReturnType<typeof createAdminDirectoryService>;
  let adminId: string;
  let staffId: string;
  let secondAdminId: string;
  let adminToken: string;
  let staffToken: string;
  let cookieName: string;
  const createdIds: string[] = [];

  const admin: Actor = { userId: '', role: 'ADMIN' };
  const staffActor: Actor = { userId: '', role: 'STAFF' };

  function query(overrides: Record<string, unknown> = {}) {
    return adminProviderListQuerySchema.parse({ pin: [PIN_PREFIX], pageSize: 25, ...overrides });
  }

  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl as string);
    const persistence = createPersistence(prisma);
    service = createAdminDirectoryService({
      ...persistence,
      now: () => new Date(),
      newId: () => randomUUID(),
    });

    const passwordHash = await hashPassword('integration-test-password');
    const account = async (email: string, role: 'ADMIN' | 'STAFF') =>
      prisma.user.upsert({
        where: { email },
        update: {
          role,
          status: 'ACTIVE',
          mustChangePassword: false,
          deletedAt: null,
          passwordHash,
        },
        create: { id: randomUUID(), email, name: email, passwordHash, role },
        select: { id: true },
      });

    adminId = (await account('directory-admin@test.local', 'ADMIN')).id;
    staffId = (await account('directory-staff@test.local', 'STAFF')).id;
    secondAdminId = (await account('directory-admin-2@test.local', 'ADMIN')).id;
    admin.userId = adminId;
    staffActor.userId = staffId;

    adminToken = generateSessionToken();
    staffToken = generateSessionToken();
    cookieName = process.env.SESSION_COOKIE_NAME ?? 'curenear_session';
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.session.createMany({
      data: [
        { id: randomUUID(), userId: adminId, tokenHash: hashSessionToken(adminToken), expiresAt },
        { id: randomUUID(), userId: staffId, tokenHash: hashSessionToken(staffToken), expiresAt },
      ],
    });

    // Old runs are removed first so the assertions see exactly one fixture set.
    await prisma.providerOrganization.deleteMany({
      where: { registrationNumber: { startsWith: MARKER } },
    });
    await prisma.providerDirectoryView.deleteMany({
      where: { userId: { in: [adminId, staffId, secondAdminId] } },
    });

    for (const fixture of fixtures) {
      const ownerId = fixture.staff === 'a' ? staffId : adminId;
      const organization = await persistence.repositories.onboarding.createOrganization({
        id: randomUUID(),
        providerType: fixture.type,
        legalName: `IT ${fixture.name}`,
        tradeName: null,
        registrationNumber: `${MARKER}${fixture.id.toUpperCase()}`,
        website: null,
        email: null,
        mobile: fixture.mobile,
        primaryPinCode: fixture.pin,
        typeData: {},
        createdByUserId: ownerId,
      });
      createdIds.push(organization.id);
      await prisma.providerOrganization.update({
        where: { id: organization.id },
        data: {
          status: statusFor(fixture),
          submittedAt: fixture.submitted ? new Date(`${fixture.submitted}T05:00:00Z`) : null,
          createdAt: new Date(`${fixture.created}T05:00:00Z`),
          updatedAt: new Date(`${fixture.created}T05:00:00Z`),
        },
      });

      if (fixture.documents === 'all') {
        const roles = documentRequirementsFor(fixture.type)
          .filter((requirement) => requirement.requirement === 'required')
          .filter((requirement) => !requirement.key.includes('.'))
          .map((requirement) => requirement.key);
        if (roles.length > 0) {
          await prisma.providerDocument.createMany({
            data: roles.map((role) => ({
              id: randomUUID(),
              organizationId: organization.id,
              fileName: `${role}.pdf`,
              mimeType: 'application/pdf',
              sizeBytes: 1024,
              role,
              uploadedByUserId: ownerId,
            })),
          });
        }

        for (const role of requiredLicenceRoles(fixture.type)) {
          const licenceDocument = await prisma.providerDocument.create({
            data: {
              id: randomUUID(),
              organizationId: organization.id,
              fileName: `licence-${role}.pdf`,
              mimeType: 'application/pdf',
              sizeBytes: 1024,
              role: `licence:${role}`,
              uploadedByUserId: ownerId,
            },
            select: { id: true },
          });
          await prisma.providerLicence.create({
            data: {
              id: randomUUID(),
              organizationId: organization.id,
              number: `${MARKER}LIC-DOC-${fixture.id}`,
              authority: 'Test authority',
              validTo: new Date(Date.now() + 500 * 24 * 60 * 60 * 1000),
              documentId: licenceDocument.id,
              details: { role },
            },
          });
        }
      }

      if (fixture.licenceExpiring) {
        await prisma.providerLicence.create({
          data: {
            id: randomUUID(),
            organizationId: organization.id,
            number: `${MARKER}LIC-${fixture.id}`,
            authority: 'Test authority',
            validTo: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
            details: { role: 'drug_licence' },
          },
        });
      }
    }
  });

  afterAll(async () => {
    await prisma.providerOrganization.deleteMany({
      where: { registrationNumber: { startsWith: MARKER } },
    });
    await prisma.providerDirectoryView.deleteMany({
      where: { userId: { in: [adminId, staffId, secondAdminId] } },
    });
    await prisma.session.deleteMany({
      where: { userId: { in: [adminId, staffId, secondAdminId] } },
    });
    await prisma.$disconnect();
  });

  it('filters by provider type, status and PIN prefix/exact values', async () => {
    const byType = await service.list(admin, query({ providerType: ['pharmacy', 'clinic'] }));
    expect(byType.meta.total).toBe(5);
    expect(new Set(byType.rows.map((row) => row.providerType))).toEqual(
      new Set(['pharmacy', 'clinic']),
    );

    const byStatus = await service.list(admin, query({ status: ['SUBMITTED', 'DRAFT'] }));
    expect(byStatus.meta.total).toBe(6);

    const exact = await service.list(admin, query({ pin: ['799901'] }));
    expect(exact.meta.total).toBe(1);
    expect(exact.rows[0]?.legalName).toBe('IT Alpha Pharmacy');

    const shortPrefix = await service.list(admin, query({ pin: ['79990'] }));
    expect(shortPrefix.meta.total).toBe(4);

    const multiple = await service.list(admin, query({ pin: ['799901', '799912'] }));
    expect(multiple.meta.total).toBe(2);
  });

  it('filters by onboarded-by, created range and submitted range', async () => {
    const byStaff = await service.list(admin, query({ onboardedBy: staffId }));
    expect(byStaff.meta.total).toBe(4);
    expect(byStaff.rows.every((row) => row.createdByUserId === staffId)).toBe(true);

    const created = await service.list(
      admin,
      query({ createdFrom: '2026-02-01', createdTo: '2026-04-30' }),
    );
    expect(created.meta.total).toBe(3);
    expect(created.rows.map((row) => row.legalName).sort()).toEqual([
      'IT Bravo Pharmacy',
      'IT Charlie Clinic',
      'IT Delta Clinic',
    ]);

    const submitted = await service.list(
      admin,
      query({ submittedFrom: '2026-03-01', submittedTo: '2026-03-31' }),
    );
    expect(submitted.meta.total).toBe(1);
    expect(submitted.rows[0]?.legalName).toBe('IT Charlie Clinic');
  });

  it('filters by licence expiry and missing documents', async () => {
    const expiring = await service.list(admin, query({ licenceExpiringDays: 30 }));
    expect(expiring.rows.map((row) => row.legalName)).toEqual(['IT Bravo Pharmacy']);

    const missing = await service.list(admin, query({ missingDocuments: true }));
    expect(missing.rows.map((row) => row.legalName).sort()).toEqual([
      'IT Bravo Pharmacy',
      'IT Foxtrot Diagnostics',
    ]);

    const complete = await service.list(admin, query({ missingDocuments: false }));
    expect(complete.rows.map((row) => row.legalName).sort()).toEqual([
      'IT Alpha Pharmacy',
      'IT Charlie Clinic',
      'IT Delta Clinic',
      'IT Echo Care',
      'IT Golf Pharmacy',
    ]);
  });

  it('searches name, mobile, registration number and provider code', async () => {
    const byName = await service.list(admin, adminProviderListQuerySchema.parse({ q: 'Alpha' }));
    expect(byName.rows.map((row) => row.legalName)).toContain('IT Alpha Pharmacy');

    const byMobile = await service.list(
      admin,
      adminProviderListQuerySchema.parse({ q: '9810000003' }),
    );
    expect(byMobile.rows.map((row) => row.legalName)).toEqual(['IT Charlie Clinic']);

    const byRegistration = await service.list(
      admin,
      adminProviderListQuerySchema.parse({ q: `${MARKER}DELTA` }),
    );
    expect(byRegistration.rows).toHaveLength(1);

    const code = (
      await prisma.providerOrganization.findUnique({
        where: { id: createdIds[3] as string },
        select: { code: true },
      })
    )?.code as string;
    const byCode = await service.list(admin, adminProviderListQuerySchema.parse({ q: code }));
    expect(byCode.rows.map((row) => row.id)).toContain(createdIds[3]);
  });

  it('combines filters and reports facet counts under them', async () => {
    const combined = await service.list(
      admin,
      query({ providerType: ['pharmacy'], status: ['SUBMITTED'] }),
    );
    expect(combined.meta.total).toBe(2);
    expect(combined.rows.map((row) => row.legalName).sort()).toEqual([
      'IT Alpha Pharmacy',
      'IT Golf Pharmacy',
    ]);

    const facets = await service.list(admin, query());
    const typeCounts = Object.fromEntries(
      facets.facets.byType.map((entry) => [entry.providerType, entry.count]),
    );
    expect(typeCounts).toMatchObject({
      pharmacy: 3,
      clinic: 2,
      care_provider: 1,
      diagnostic_centre: 1,
    });

    const statusCounts = Object.fromEntries(
      facets.facets.byStatus.map((entry) => [entry.status, entry.count]),
    );
    expect(statusCounts).toMatchObject({ DRAFT: 2, SUBMITTED: 4, APPROVED: 1 });

    // Facets describe the current result set, filters included.
    const filtered = await service.list(admin, query({ providerType: ['pharmacy'] }));
    expect(filtered.facets.byType).toEqual([{ providerType: 'pharmacy', count: 3 }]);
    expect(filtered.facets.byStatus.map((entry) => entry.status).sort()).toEqual([
      'DRAFT',
      'SUBMITTED',
    ]);
  });

  it('paginates without duplicates or gaps', async () => {
    const pages: string[][] = [];
    for (let page = 1; page <= 3; page += 1) {
      const result = await service.list(
        admin,
        query({ sort: 'code', order: 'asc', page, pageSize: 3 }),
      );
      expect(result.meta.total).toBe(7);
      pages.push(result.rows.map((row) => row.id));
    }
    const flat = pages.flat();
    expect(flat).toHaveLength(7);
    expect(new Set(flat).size).toBe(7);

    const again = await service.list(
      admin,
      query({ sort: 'code', order: 'asc', page: 2, pageSize: 3 }),
    );
    expect(again.rows.map((row) => row.id)).toEqual(pages[1]);
  });

  it('refuses staff at the service and the route', async () => {
    await expect(service.list(staffActor, query())).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const { GET } = await import('@/app/api/v1/admin/providers/route');
    const staffResponse = await GET(
      new NextRequest('http://localhost/api/v1/admin/providers?pin=7999', {
        headers: { cookie: `${cookieName}=${staffToken}` },
      }),
    );
    expect(staffResponse.status).toBe(403);

    const adminResponse = await GET(
      new NextRequest('http://localhost/api/v1/admin/providers?pin=7999&pageSize=2', {
        headers: { cookie: `${cookieName}=${adminToken}` },
      }),
    );
    expect(adminResponse.status).toBe(200);
    const body = (await adminResponse.json()) as {
      data: unknown[];
      meta: { total: number; facets: { byType: unknown[] } };
    };
    expect(body.data).toHaveLength(2);
    expect(body.meta.total).toBe(7);
    expect(body.meta.facets.byType.length).toBeGreaterThan(0);
  });

  it('keeps saved views per administrator', async () => {
    const saved = await service.saveView(admin, {
      name: 'Kolkata pharmacies',
      query: 'pin=7999&providerType=pharmacy',
    });
    const listed = await service.views(admin);
    expect(listed.map((view) => view.name)).toContain('Kolkata pharmacies');
    expect(listed.find((view) => view.id === saved.id)?.query).toBe(
      'pin=7999&providerType=pharmacy',
    );

    // Saving the same name again overwrites rather than duplicating.
    await service.saveView(admin, {
      name: 'Kolkata pharmacies',
      query: 'pin=7999&providerType=pharmacy&status=SUBMITTED',
    });
    expect(
      (await service.views(admin)).filter((view) => view.name === 'Kolkata pharmacies'),
    ).toHaveLength(1);

    // Another administrator cannot delete it.
    await expect(
      service.deleteView({ userId: secondAdminId, role: 'ADMIN' }, saved.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await service.deleteView(admin, saved.id);
    expect(await service.views(admin)).toHaveLength(0);
  });
});
