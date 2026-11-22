import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPersistence, createPrismaClient } from '@curenear/db';
import { AppError, type Actor } from '@curenear/shared';
import { createProviderOnboardingService } from '@/server/services/provider-onboarding-service';

/**
 * Pharmacy online-sale switches (7.5) and diagnostic catalogue/workflow rules
 * (8.2, 8.3) against a real database: defaults, admin-only writes, the CSV
 * report and the admin review flags.
 */
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;
const ctx = () => ({ requestId: randomUUID(), ipAddress: '127.0.0.1', userAgent: 'vitest' });

const columns = [
  'Test name',
  'Test code',
  'Category / department',
  'Price (INR)',
  'Sample type',
  'Preparation requirements',
  'Expected turnaround time',
  'Prescription required?',
  'Where performed',
  'Performing laboratory and accreditation',
  'Home collection available',
];

function csv(rows: string[][]): string {
  return [columns, ...rows].map((row) => row.join(',')).join('\n');
}

const goodRow = [
  'Complete blood count',
  'CBC-001',
  'pathology',
  '350',
  'blood',
  'No fasting required',
  '24 hours',
  'yes',
  'on site',
  '',
  'yes',
];

describeDb('type-specific sections (real PostgreSQL)', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: ReturnType<typeof createProviderOnboardingService>;
  let staff: Actor;
  let admin: Actor;
  const userIds: string[] = [];

  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl as string);
    service = createProviderOnboardingService({
      ...createPersistence(prisma),
      now: () => new Date(),
      newId: () => randomUUID(),
    });
    const staffUser = await prisma.user.upsert({
      where: { email: 'type-sections@test.local' },
      update: { role: 'STAFF', status: 'ACTIVE', mustChangePassword: false, deletedAt: null },
      create: {
        id: randomUUID(),
        email: 'type-sections@test.local',
        name: 'Type Sections',
        passwordHash: 'not-used',
        role: 'STAFF',
      },
    });
    const adminUser = await prisma.user.upsert({
      where: { email: 'type-sections-admin@test.local' },
      update: { role: 'ADMIN', status: 'ACTIVE', mustChangePassword: false, deletedAt: null },
      create: {
        id: randomUUID(),
        email: 'type-sections-admin@test.local',
        name: 'Type Sections Admin',
        passwordHash: 'not-used',
        role: 'ADMIN',
      },
    });
    userIds.push(staffUser.id, adminUser.id);
    staff = { userId: staffUser.id, role: 'STAFF' };
    admin = { userId: adminUser.id, role: 'ADMIN' };
  });

  afterAll(async () => {
    if (!prisma) return;
    const organizations = await prisma.providerOrganization.findMany({
      where: { createdByUserId: { in: userIds } },
      select: { id: true },
    });
    const ids = organizations.map((row) => row.id);
    await prisma.doctorProfile.deleteMany({
      where: { OR: [{ createdByOrgId: { in: ids } }, { organizationId: { in: ids } }] },
    });
    await prisma.providerOrganization.deleteMany({ where: { createdByUserId: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('defaults the pharmacy online switches off and keeps staff out', async () => {
    const created = await service.create(
      staff,
      {
        provider_type: 'pharmacy',
        legal_name: 'Type Sections Pharmacy',
        mobile: '9830077701',
        primary_pin_code: '700091',
      },
      ctx(),
    );
    const id = created.provider.id;
    // The defaults are written, but the admin-only switches never reach a
    // staff response.
    const stored = (
      await prisma.providerOrganization.findUnique({
        where: { id },
        select: { typeData: true },
      })
    )?.typeData as Record<string, unknown>;
    expect(stored.ph_online_enabled).toBe(false);
    expect(stored.ph_online_categories).toEqual([]);
    expect(created.provider.typeData).not.toHaveProperty('ph_online_enabled');
    expect(created.provider.typeData).not.toHaveProperty('ph_online_categories');

    await expect(
      service.updateAdminSwitches(staff, id, { data: { ph_online_enabled: true } }, ctx()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      service.saveSection(
        staff,
        id,
        'pharmacy_premises',
        { version: created.provider.version, data: { ph_online_enabled: true } },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const updated = await service.updateAdminSwitches(
      admin,
      id,
      { data: { ph_online_enabled: true, ph_online_categories: ['OTC medicines'] } },
      ctx(),
    );
    expect(updated.typeData.ph_online_enabled).toBe(true);
    expect(updated.typeData.ph_online_categories).toEqual(['OTC medicines']);
  });

  it('imports good rows, reports bad ones and blocks sex-determination tests', async () => {
    const created = await service.create(
      staff,
      {
        provider_type: 'diagnostic_centre',
        legal_name: 'Type Sections Diagnostics',
        mobile: '9830077702',
        primary_pin_code: '700091',
      },
      ctx(),
    );
    const id = created.provider.id;

    await service.saveSection(
      staff,
      id,
      'diagnostic_services',
      {
        version: created.provider.version,
        data: {
          dc_services: ['pathology', 'prenatal diagnostics'],
          dc_home_collection: false,
          dc_highrisk_requests: ['ultrasound'],
          dc_report_channel: 'email',
        },
      },
      ctx(),
    );

    const imported = await service.importTestCatalogue(
      staff,
      id,
      {
        csv: csv([
          goodRow,
          [
            'Missing prep',
            'BAD-1',
            'pathology',
            '100',
            'blood',
            '',
            '24 hours',
            'no',
            'on site',
            '',
            '',
          ],
          [
            'Sex determination scan',
            'SD-1',
            'ultrasound',
            '900',
            'imaging',
            'None',
            '1 hour',
            'yes',
            'on site',
            '',
            'no',
          ],
          [
            'Prenatal anomaly scan',
            'PN-1',
            'prenatal',
            '2500',
            'imaging',
            'None',
            '2 days',
            'yes',
            'on site',
            '',
            'no',
          ],
        ]),
      },
      ctx(),
    );

    expect(imported.report.counts).toEqual({ imported: 1, flagged: 1, invalid: 1, blocked: 1 });
    const detail = await service.get(staff, id);
    const tests = detail.organization.typeData.dc_tests as Array<Record<string, unknown>>;
    expect(tests.map((row) => row.test_name)).toEqual([
      'Complete blood count',
      'Prenatal anomaly scan',
    ]);
    expect(tests[0]?.test_price).toBe(35_000);
    // Review flags are admin-only, so read them from the stored row.
    const stored = (
      await prisma.providerOrganization.findUnique({
        where: { id },
        select: { typeData: true },
      })
    )?.typeData as Record<string, unknown>;
    const flags = stored.dc_test_review_flags as Array<Record<string, unknown>>;
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      test_name: 'Prenatal anomaly scan',
      status: 'pending review',
    });
  });

  it('lets only an administrator decide higher-risk workflows', async () => {
    const created = await service.create(
      staff,
      {
        provider_type: 'diagnostic_centre',
        legal_name: 'Type Sections Workflows',
        mobile: '9830077703',
        primary_pin_code: '700091',
      },
      ctx(),
    );
    const id = created.provider.id;
    await service.saveSection(
      staff,
      id,
      'diagnostic_services',
      {
        version: created.provider.version,
        data: {
          dc_services: ['pathology'],
          dc_home_collection: false,
          dc_highrisk_requests: ['ultrasound', 'report hosting'],
          dc_report_channel: 'email',
        },
      },
      ctx(),
    );

    await expect(
      service.updateHighRiskStatuses(
        staff,
        id,
        { statuses: [{ workflow: 'ultrasound', status: 'approved' }] },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      service.updateHighRiskStatuses(
        admin,
        id,
        { statuses: [{ workflow: 'payments', status: 'approved' }] },
        ctx(),
      ),
    ).rejects.toBeInstanceOf(AppError);

    const updated = await service.updateHighRiskStatuses(
      admin,
      id,
      { statuses: [{ workflow: 'ultrasound', status: 'approved' }] },
      ctx(),
    );
    const statuses = updated.typeData.dc_highrisk_status as Array<Record<string, unknown>>;
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ workflow: 'ultrasound', status: 'approved' });
    expect(statuses[0]?.decided_by).toBe(admin.userId);
  });

  it('serves the CSV template for a diagnostic centre only', async () => {
    const created = await service.create(
      staff,
      {
        provider_type: 'diagnostic_centre',
        legal_name: 'Type Sections Template',
        mobile: '9830077704',
        primary_pin_code: '700091',
      },
      ctx(),
    );
    const template = await service.testCatalogueTemplate(staff, created.provider.id);
    expect(template.fileName).toContain('test-catalogue.csv');
    expect(template.csv.split('\n')[0]).toContain('Test name');
    expect(template.csv.split('\n')[0]).toContain('Price (INR)');
  });
});
