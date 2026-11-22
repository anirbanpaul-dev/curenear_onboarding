import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/client';
import { nextProviderCode } from '../../src/index';
import {
  rebuildProviderPinStats,
  recomputeProviderPinStats,
} from '../../src/repositories/pin-stats';

/**
 * Provider data model against a real PostgreSQL database: doctor registration
 * uniqueness, the clinic-owned doctor rule, provider codes and the PIN roll-up.
 */

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

describeDb('provider data model (real PostgreSQL)', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  const marker = `provider-model-${randomUUID()}`;
  let userId: string;
  let doctorOrgId: string;
  let clinicOrgId: string;
  let pharmacyOrgId: string;
  let medicalCouncilId: string;
  let otherCouncilId: string;

  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl as string);

    const user = await prisma.user.create({
      data: {
        email: `${marker}@example.test`,
        name: 'Provider Model Test',
        passwordHash: 'not-a-real-hash',
        role: 'ADMIN',
      },
    });
    userId = user.id;

    const medicalCouncil = await prisma.council.create({
      data: {
        code: `${marker}-mc`,
        name: 'Test Medical Council',
        kind: 'medical',
      },
    });
    const otherCouncil = await prisma.council.create({
      data: {
        code: `${marker}-oc`,
        name: 'Test AYUSH Council',
        kind: 'other',
      },
    });
    medicalCouncilId = medicalCouncil.id;
    otherCouncilId = otherCouncil.id;

    const doctorOrg = await prisma.providerOrganization.create({
      data: {
        code: await nextProviderCode(prisma, 'doctor'),
        providerType: 'doctor',
        legalName: 'Dr Test',
        createdByUserId: userId,
      },
    });
    const clinicOrg = await prisma.providerOrganization.create({
      data: {
        code: await nextProviderCode(prisma, 'clinic'),
        providerType: 'clinic',
        legalName: 'Test Clinic',
        createdByUserId: userId,
        primaryPinCode: '779011',
      },
    });
    const pharmacyOrg = await prisma.providerOrganization.create({
      data: {
        code: await nextProviderCode(prisma, 'pharmacy'),
        providerType: 'pharmacy',
        legalName: 'Test Pharmacy',
        createdByUserId: userId,
        primaryPinCode: '779011',
      },
    });

    doctorOrgId = doctorOrg.id;
    clinicOrgId = clinicOrg.id;
    pharmacyOrgId = pharmacyOrg.id;

    await prisma.providerLocation.createMany({
      data: [
        {
          organizationId: clinicOrgId,
          name: 'Test Clinic Main',
          locationType: 'clinic',
          addressLine1: '1 Test Road',
          city: 'Kolkata',
          pinCode: '779011',
          isPrimary: true,
        },
        {
          organizationId: pharmacyOrgId,
          name: 'Test Pharmacy Main',
          locationType: 'pharmacy store',
          addressLine1: '2 Test Road',
          city: 'Kolkata',
          pinCode: '779011',
          isPrimary: true,
        },
      ],
    });

    await prisma.providerServicePin.create({
      data: { organizationId: pharmacyOrgId, pinCode: '779013', serviceKind: 'delivery' },
    });
  });

  afterAll(async () => {
    await prisma.providerServicePin.deleteMany({
      where: { organizationId: { in: [doctorOrgId, clinicOrgId, pharmacyOrgId] } },
    });
    await prisma.doctorLocation.deleteMany({
      where: { doctorProfile: { registrationNo: { startsWith: marker } } },
    });
    await prisma.doctorProfile.deleteMany({
      where: { registrationNo: { startsWith: marker } },
    });
    await prisma.providerLicence.deleteMany({
      where: { organizationId: { in: [doctorOrgId, clinicOrgId, pharmacyOrgId] } },
    });
    await prisma.providerInsurance.deleteMany({
      where: { organizationId: { in: [doctorOrgId, clinicOrgId, pharmacyOrgId] } },
    });
    await prisma.providerContact.deleteMany({
      where: { organizationId: { in: [doctorOrgId, clinicOrgId, pharmacyOrgId] } },
    });
    await prisma.providerLocation.deleteMany({
      where: { organizationId: { in: [doctorOrgId, clinicOrgId, pharmacyOrgId] } },
    });
    await prisma.providerStatusHistory.deleteMany({
      where: { organizationId: { in: [doctorOrgId, clinicOrgId, pharmacyOrgId] } },
    });
    await prisma.providerOrganization.deleteMany({
      where: { id: { in: [doctorOrgId, clinicOrgId, pharmacyOrgId] } },
    });
    await prisma.providerPinStats.deleteMany({ where: { pinCode: { in: ['779011', '779013'] } } });
    await prisma.council.deleteMany({ where: { id: { in: [medicalCouncilId, otherCouncilId] } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('generates human-readable provider codes per type', async () => {
    const first = await nextProviderCode(prisma, 'diagnostic_centre');
    const second = await nextProviderCode(prisma, 'diagnostic_centre');
    expect(first).toMatch(/^CN-DC-\d{6}$/);
    expect(second).toMatch(/^CN-DC-\d{6}$/);
    expect(Number(second.slice(-6))).toBe(Number(first.slice(-6)) + 1);
  });

  it('allows one live doctor per registration number and council', async () => {
    const profile = await prisma.doctorProfile.create({
      data: {
        organizationId: doctorOrgId,
        fullName: 'Dr Test',
        registrationNo: `${marker}-reg-1`,
        councilId: medicalCouncilId,
        systemOfMedicine: 'allopathy',
      },
    });

    await expect(
      prisma.doctorProfile.create({
        data: {
          organizationId: doctorOrgId,
          fullName: 'Dr Test Duplicate',
          registrationNo: `${marker}-reg-1`,
          councilId: medicalCouncilId,
          systemOfMedicine: 'allopathy',
        },
      }),
    ).rejects.toThrow(/Unique constraint|doctor_profiles_registration_no_council_id_live_key/);

    // A different council is a different registration.
    await expect(
      prisma.doctorProfile.create({
        data: {
          organizationId: doctorOrgId,
          fullName: 'Dr Test Other Council',
          registrationNo: `${marker}-reg-1`,
          councilId: otherCouncilId,
          systemOfMedicine: 'ayurveda',
        },
      }),
    ).resolves.toBeTruthy();

    // Soft-deleted profiles do not block a later re-registration.
    await prisma.doctorProfile.update({
      where: { id: profile.id },
      data: { deletedAt: new Date() },
    });
    await expect(
      prisma.doctorProfile.create({
        data: {
          organizationId: doctorOrgId,
          fullName: 'Dr Test Again',
          registrationNo: `${marker}-reg-1`,
          councilId: medicalCouncilId,
          systemOfMedicine: 'allopathy',
        },
      }),
    ).resolves.toBeTruthy();
  });

  it('keeps clinic-created doctors org-less only until the doctor confirms', async () => {
    const clinicDoctor = await prisma.doctorProfile.create({
      data: {
        fullName: 'Dr Clinic Added',
        registrationNo: `${marker}-reg-2`,
        systemOfMedicine: 'allopathy',
        createdByOrgId: clinicOrgId,
        status: 'invited',
      },
    });

    await expect(
      prisma.doctorProfile.update({
        where: { id: clinicDoctor.id },
        data: { doctorConfirmedAt: new Date() },
      }),
    ).rejects.toThrow(/doctor_profiles_organization_rule_check/);

    // Confirming with an owner organization is allowed.
    await expect(
      prisma.doctorProfile.update({
        where: { id: clinicDoctor.id },
        data: { doctorConfirmedAt: new Date(), organizationId: doctorOrgId },
      }),
    ).resolves.toBeTruthy();
  });

  it('counts primary locations in the primary measure', async () => {
    await rebuildProviderPinStats(prisma);

    const atPrimary = await prisma.providerPinStats.findMany({
      where: { pinCode: '779011', measure: 'primary' },
      orderBy: [{ providerType: 'asc' }, { status: 'asc' }],
    });
    expect(atPrimary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerType: 'clinic', status: 'DRAFT', count: 1 }),
        expect.objectContaining({ providerType: 'pharmacy', status: 'DRAFT', count: 1 }),
      ]),
    );

    // The service area is its own measure; it never adds to the primary count.
    const atServicePin = await prisma.providerPinStats.findMany({
      where: { pinCode: '779013', providerType: 'pharmacy' },
    });
    expect(atServicePin).toEqual([
      expect.objectContaining({ measure: 'service', status: 'DRAFT', count: 1 }),
    ]);

    // Approving the clinic replaces its draft row through the incremental path.
    await prisma.providerOrganization.update({
      where: { id: clinicOrgId },
      data: { status: 'APPROVED' },
    });
    await recomputeProviderPinStats(prisma, clinicOrgId);

    const afterApproval = await prisma.providerPinStats.findMany({
      where: { pinCode: '779011', measure: 'primary' },
    });
    expect(
      afterApproval.find((row) => row.providerType === 'clinic' && row.status === 'APPROVED')
        ?.count,
    ).toBe(1);
    expect(
      afterApproval.find((row) => row.providerType === 'clinic' && row.status === 'DRAFT'),
    ).toBeUndefined();

    // A soft-deleted organization disappears from every measure.
    await prisma.providerOrganization.update({
      where: { id: pharmacyOrgId },
      data: { deletedAt: new Date() },
    });
    await recomputeProviderPinStats(prisma, pharmacyOrgId);

    const afterDelete = await prisma.providerPinStats.findMany({
      where: { providerType: 'pharmacy', pinCode: { in: ['779011', '779013'] } },
    });
    expect(afterDelete).toHaveLength(0);
  });
});
