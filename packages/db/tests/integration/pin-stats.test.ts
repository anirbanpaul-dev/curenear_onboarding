import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/client';
import { nextProviderCode } from '../../src/repositories/provider-directory';
import {
  rebuildProviderPinStats,
  recomputeProviderPinStats,
} from '../../src/repositories/pin-stats';

/**
 * The PIN read model against a real database: incremental updates after a
 * create, a status change, a primary PIN move and a delete, and the guarantee
 * that a rebuild produces exactly what the incremental path produced.
 */

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

const PINS = ['779001', '779002', '779003', '779004'];

describeDb('provider PIN stats read model (real PostgreSQL)', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  const marker = `pin-stats-${randomUUID()}`;
  let userId: string;
  const orgIds: string[] = [];

  async function createOrganization(input: {
    providerType: 'clinic' | 'pharmacy' | 'care_provider';
    pinCode: string;
    status?: 'DRAFT' | 'SUBMITTED' | 'APPROVED';
  }): Promise<string> {
    const organization = await prisma.providerOrganization.create({
      data: {
        code: await nextProviderCode(prisma, input.providerType),
        providerType: input.providerType,
        legalName: `${marker} ${input.providerType}`,
        status: input.status ?? 'DRAFT',
        createdByUserId: userId,
        primaryPinCode: input.pinCode,
      },
    });
    orgIds.push(organization.id);
    await prisma.providerLocation.create({
      data: {
        organizationId: organization.id,
        name: `${marker} main`,
        locationType: input.providerType,
        addressLine1: '1 Test Road',
        city: 'Kolkata',
        pinCode: input.pinCode,
        isPrimary: true,
      },
    });
    return organization.id;
  }

  async function statsAt(pinCode: string) {
    return prisma.providerPinStats.findMany({
      where: { pinCode, measure: 'primary' },
      orderBy: [{ providerType: 'asc' }, { status: 'asc' }],
    });
  }

  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl as string);
    const user = await prisma.user.create({
      data: {
        email: `${marker}@example.test`,
        name: 'PIN Stats Test',
        passwordHash: 'not-a-real-hash',
        role: 'ADMIN',
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.providerServicePin.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.providerPinStats.deleteMany({ where: { pinCode: { in: PINS } } });
    await prisma.providerOrganization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('counts a new provider at its primary PIN, then follows status and PIN changes', async () => {
    const clinicOrgId = await createOrganization({ providerType: 'clinic', pinCode: '779001' });

    await recomputeProviderPinStats(prisma, clinicOrgId);
    expect(await statsAt('779001')).toEqual([
      expect.objectContaining({ providerType: 'clinic', status: 'DRAFT', count: 1 }),
    ]);

    await prisma.providerOrganization.update({
      where: { id: clinicOrgId },
      data: { status: 'APPROVED' },
    });
    await recomputeProviderPinStats(prisma, clinicOrgId);
    const afterApproval = await statsAt('779001');
    expect(afterApproval).toEqual([
      expect.objectContaining({ providerType: 'clinic', status: 'APPROVED', count: 1 }),
    ]);

    // Moving the primary location moves the whole contribution with it.
    await prisma.providerOrganization.update({
      where: { id: clinicOrgId },
      data: { primaryPinCode: '779003' },
    });
    await prisma.providerLocation.updateMany({
      where: { organizationId: clinicOrgId },
      data: { pinCode: '779003' },
    });
    await recomputeProviderPinStats(prisma, clinicOrgId);

    expect(await statsAt('779001')).toHaveLength(0);
    expect(await statsAt('779003')).toEqual([
      expect.objectContaining({ providerType: 'clinic', status: 'APPROVED', count: 1 }),
    ]);

    // A soft delete removes it, and a replay of the same event is harmless.
    await prisma.providerOrganization.update({
      where: { id: clinicOrgId },
      data: { deletedAt: new Date() },
    });
    await recomputeProviderPinStats(prisma, clinicOrgId);
    await recomputeProviderPinStats(prisma, clinicOrgId);
    expect(await statsAt('779003')).toHaveLength(0);
    expect(
      await prisma.providerPinContribution.count({ where: { organizationId: clinicOrgId } }),
    ).toBe(0);
  });

  it('counts service PINs in a separate measure', async () => {
    const pharmacyOrgId = await createOrganization({
      providerType: 'pharmacy',
      pinCode: '779001',
    });
    await prisma.providerServicePin.create({
      data: { organizationId: pharmacyOrgId, pinCode: '779002', serviceKind: 'delivery' },
    });
    await recomputeProviderPinStats(prisma, pharmacyOrgId);

    expect(
      await prisma.providerPinStats.findMany({
        where: { pinCode: '779002', measure: 'service' },
      }),
    ).toEqual([expect.objectContaining({ providerType: 'pharmacy', count: 1 })]);
    // The primary measure is untouched by the service area.
    expect(
      await prisma.providerPinStats.count({ where: { pinCode: '779002', measure: 'primary' } }),
    ).toBe(0);
  });

  it('produces the same rows from a full rebuild as from incremental updates', async () => {
    const careOrgId = await createOrganization({
      providerType: 'care_provider',
      pinCode: '779004',
      status: 'SUBMITTED',
    });
    await recomputeProviderPinStats(prisma, careOrgId);

    // `updated_at` is deliberately excluded: a rebuild touches every row.
    const snapshot = async () =>
      (
        await prisma.providerPinStats.findMany({
          where: { pinCode: { in: PINS } },
          orderBy: [
            { pinCode: 'asc' },
            { measure: 'asc' },
            { providerType: 'asc' },
            { status: 'asc' },
          ],
        })
      ).map(({ pinCode, measure, providerType, status, count }) => ({
        pinCode,
        measure,
        providerType,
        status,
        count,
      }));

    const incremental = await snapshot();
    expect(incremental.length).toBeGreaterThan(0);

    const rebuilt = await rebuildProviderPinStats(prisma);
    expect(rebuilt.statsRows).toBeGreaterThan(0);
    expect(await snapshot()).toEqual(incremental);

    // The contribution ledger matches the read model after a rebuild.
    const contributions = await prisma.providerPinContribution.count({
      where: { pinCode: { in: PINS } },
    });
    expect(contributions).toBe(incremental.length);
  });
});
