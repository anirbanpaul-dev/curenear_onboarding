import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPersistence, createPrismaClient } from '@curenear/db';
import { declarationsFor, type Actor } from '@curenear/shared';
import { createConsentService } from '@/server/services/consent-service';

/**
 * Consents against real PostgreSQL: revocation switches publication permission
 * off and emits an event, and confirmation links expire after their window.
 */
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

const ctx = () => ({ requestId: randomUUID(), ipAddress: '127.0.0.1', userAgent: 'vitest' });

describeDb('consents and confirmation links (real PostgreSQL)', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: ReturnType<typeof createConsentService>;
  let actor: Actor;
  const userIds: string[] = [];

  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl as string);
    const persistence = createPersistence(prisma);
    service = createConsentService({
      ...persistence,
      now: () => new Date(),
      newId: () => randomUUID(),
      appUrl: 'http://localhost:3000',
      environment: 'test',
      confirmationLinksEnabled: true,
    });

    const user = await prisma.user.upsert({
      where: { email: 'consents-test@test.local' },
      update: { role: 'STAFF', status: 'ACTIVE', mustChangePassword: false, deletedAt: null },
      create: {
        id: randomUUID(),
        email: 'consents-test@test.local',
        name: 'Consents Test',
        passwordHash: 'not-used',
        role: 'STAFF',
      },
    });
    userIds.push(user.id);
    actor = { userId: user.id, role: 'STAFF' };
    await prisma.providerOrganization.deleteMany({ where: { createdByUserId: user.id } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.providerOrganization.deleteMany({ where: { createdByUserId: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function createProvider(name: string): Promise<string> {
    const provider = await prisma.providerOrganization.create({
      data: {
        id: randomUUID(),
        code: `CN-TEST-${randomUUID().slice(0, 8)}`,
        providerType: 'clinic',
        legalName: name,
        mobile: '9830012345',
        primaryPinCode: '700091',
        createdByUserId: actor.userId,
        publicationConsents: {
          public_fields: ['profile_display_name'],
          consent_publish_photo: true,
        },
      },
    });
    return provider.id;
  }

  it('revoking publication consent switches permission off and emits an event', async () => {
    const organizationId = await createProvider('Revocation Clinic');
    await service.capture(
      actor,
      organizationId,
      {
        method: 'IN_PERSON_ATTESTATION',
        attestation_name: 'Consents Test',
        items: [{ consent_type: 'publication' }],
      },
      ctx(),
    );

    const overview = await service.get(actor, organizationId);
    const publication = overview.consents.find((row) => row.consentType === 'publication');
    expect(publication).toBeTruthy();

    const afterRevoke = await service.revoke(
      actor,
      organizationId,
      publication!.id,
      'Provider withdrew permission',
      ctx(),
    );
    expect(afterRevoke.consents.find((row) => row.id === publication!.id)?.revokedAt).toBeTruthy();

    const organization = await prisma.providerOrganization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    expect(organization.publicationConsents).toMatchObject({
      consent_publish_photo: false,
      public_fields: [],
    });
    expect(
      (organization.publicationConsents as Record<string, unknown>).publication_revoked_at,
    ).toBeTruthy();

    const event = await prisma.outboxEvent.findFirst({
      where: { eventType: 'consent.revoked', aggregateId: organizationId },
      orderBy: { occurredAt: 'desc' },
    });
    expect(event).toBeTruthy();
    expect(event?.payload).toMatchObject({
      providerId: organizationId,
      consentId: publication!.id,
      publicationPermissionOff: true,
    });
  });

  it('expires a confirmation link after 48 hours', async () => {
    const organizationId = await createProvider('Link Clinic');
    const created = await service.createConfirmationRequest(actor, organizationId, {}, ctx());

    // The link is open immediately…
    expect((await service.getConfirmation(created.token)).state).toBe('open');

    // …and expired once the stored window has passed.
    await prisma.confirmationRequest.updateMany({
      where: { organizationId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    expect((await service.getConfirmation(created.token)).state).toBe('expired');
    await expect(
      service.confirm(
        created.token,
        {
          full_name: 'Dr Late',
          method: 'LINK_CONFIRMATION',
          declaration_keys: declarationsFor('clinic').map((row) => row.key),
        },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('records the declarations through the public link exactly once', async () => {
    const organizationId = await createProvider('Confirm Clinic');
    const created = await service.createConfirmationRequest(actor, organizationId, {}, ctx());
    const keys = declarationsFor('clinic').map((row) => row.key);

    await expect(
      service.confirm(
        created.token,
        {
          full_name: 'Dr Confirm',
          method: 'LINK_CONFIRMATION',
          declaration_keys: keys.slice(0, 2),
        },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const result = await service.confirm(
      created.token,
      { full_name: 'Dr Confirm', method: 'LINK_CONFIRMATION', declaration_keys: keys },
      ctx(),
    );
    expect(result.recorded).toBeGreaterThanOrEqual(3 + keys.length);

    const records = await prisma.consentRecord.findMany({ where: { organizationId } });
    expect(records.filter((row) => row.consentType === 'declarations')).toHaveLength(keys.length);
    expect(records.filter((row) => row.consentType === 'publication')).toHaveLength(1);
    expect(records.filter((row) => row.consentType === 'data_privacy_notice')).toHaveLength(1);

    await expect(
      service.confirm(
        created.token,
        { full_name: 'Dr Confirm', method: 'LINK_CONFIRMATION', declaration_keys: keys },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
