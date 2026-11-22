import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import pino from 'pino';
import {
  createPersistence,
  createPrismaClient,
  recomputeProviderPinStats,
  type PrismaClient,
} from '@curenear/db';
import { getServerEnv } from '@curenear/shared';
import type { AppContext } from '../../src/context';
import { createMemoryEmailService } from '../../src/email';
import { eventHandlers, type EventHandler } from '../../src/handlers';
import { runExpiryScan } from '../../src/jobs/expiry';
import { publishBatch } from '../../src/publisher';

/**
 * Worker integration tests against a real database.
 *
 * The publisher is driven with an explicit clock in 2020 so `claimBatch` only
 * ever sees rows these tests created; anything the running dev worker has queued
 * for "now" is out of reach.
 */

const prisma: PrismaClient = createPrismaClient();
const persistence = createPersistence(prisma);
const email = createMemoryEmailService();

const CLAIM_CLOCK = new Date('2020-01-01T00:00:00.000Z');

const ctx: AppContext = {
  env: {
    ...getServerEnv(),
    OUTBOX_MAX_ATTEMPTS: 3,
    STALE_DRAFT_DAYS: 7,
    WEBHOOK_MAX_ATTEMPTS: 3,
  },
  prisma,
  repositories: persistence.repositories,
  unitOfWork: persistence.unitOfWork,
  logger: pino({ level: 'silent' }),
  email,
  now: () => new Date(),
  fetchImpl: (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
};

const publisherConfig = {
  batchSize: 20,
  maxAttempts: 3,
  retryDelaySeconds: (attempts: number) => Math.min(2 ** attempts, 60),
};

const createdUsers: string[] = [];
const createdOrganizations: string[] = [];
const createdEventIds: string[] = [];
const createdDocumentTypes: string[] = [];
const createdPins: string[] = [];
const createdEndpointIds: string[] = [];

async function createUser(role: 'ADMIN' | 'STAFF') {
  const id = randomUUID();
  const user = await prisma.user.create({
    data: {
      id,
      email: `events-${id}@example.test`,
      name: `Events ${role}`,
      passwordHash: 'not-a-real-hash',
      role,
    },
  });
  createdUsers.push(id);
  return user;
}

async function createOrganization(createdByUserId: string, status: 'DRAFT' | 'APPROVED' = 'DRAFT') {
  const id = randomUUID();
  const organization = await prisma.providerOrganization.create({
    data: {
      id,
      code: `CN-EV-${randomUUID().slice(0, 8).toUpperCase()}`,
      providerType: 'clinic',
      status,
      createdByUserId,
    },
  });
  createdOrganizations.push(id);
  return organization;
}

function approvalPayload(organizationId: string) {
  return {
    organizationId,
    providerType: 'clinic',
    status: 'APPROVED',
    recordVersion: 2,
    actorUserId: null,
  };
}

async function insertEvent(input: {
  eventType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  occurredAt?: Date;
  nextAttemptAt?: Date;
}) {
  const id = randomUUID();
  await prisma.outboxEvent.create({
    data: {
      id,
      eventType: input.eventType,
      eventVersion: 1,
      aggregateType: 'provider_organization',
      aggregateId: input.aggregateId,
      payload: input.payload,
      occurredAt: input.occurredAt ?? CLAIM_CLOCK,
      nextAttemptAt: input.nextAttemptAt ?? CLAIM_CLOCK,
      dedupeKey: `test:${id}`,
    },
  });
  createdEventIds.push(id);
  return id;
}

describe('outbox publisher', () => {
  it('backs off on failure and dead-letters after the attempt budget', async () => {
    const staff = await createUser('STAFF');
    const organization = await createOrganization(staff.id);
    const eventId = await insertEvent({
      eventType: 'provider.approved',
      aggregateId: organization.id,
      payload: approvalPayload(organization.id),
    });

    // Fails only for this event, so an unrelated claimable row is untouched.
    const failing: EventHandler = {
      name: 'test-always-fails',
      handles: () => true,
      async handle(event) {
        if (event.id === eventId) throw new Error('handler exploded');
      },
    };

    const first = await publishBatch(ctx, [failing], publisherConfig, { now: CLAIM_CLOCK });
    expect(first.claimed).toBeGreaterThanOrEqual(1);

    let row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(row.publishedAt).toBeNull();
    expect(row.deadLetteredAt).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain('handler exploded');
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(CLAIM_CLOCK.getTime());

    await publishBatch(ctx, [failing], publisherConfig, { now: row.nextAttemptAt });
    row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(row.attempts).toBe(2);

    await publishBatch(ctx, [failing], publisherConfig, { now: row.nextAttemptAt });
    row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(row.attempts).toBe(3);
    expect(row.deadLetteredAt).not.toBeNull();

    // A dead letter is no longer claimed, even by a later, larger clock.
    const later = await publishBatch(ctx, [failing], publisherConfig, {
      now: new Date('2030-01-01T00:00:00.000Z'),
    });
    expect(later.deadLettered).toBe(0);
    row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(row.attempts).toBe(3);
  });

  it('publishes a valid event and stops claiming it afterwards', async () => {
    const staff = await createUser('STAFF');
    const organization = await createOrganization(staff.id);
    const eventId = await insertEvent({
      eventType: 'provider.approved',
      aggregateId: organization.id,
      payload: approvalPayload(organization.id),
    });

    await publishBatch(ctx, eventHandlers, publisherConfig, { now: CLAIM_CLOCK });

    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(row.publishedAt).not.toBeNull();
    expect(row.lastError).toBeNull();

    const markers = await prisma.processedEventHandler.count({ where: { eventId } });
    expect(markers).toBeGreaterThan(0);

    const again = await publishBatch(ctx, eventHandlers, publisherConfig, { now: CLAIM_CLOCK });
    expect(again.published).toBe(0);
  });

  it('runs handlers idempotently when the same event is replayed', async () => {
    const staff = await createUser('STAFF');
    const organization = await createOrganization(staff.id);
    const eventId = await insertEvent({
      eventType: 'provider.approved',
      aggregateId: organization.id,
      payload: approvalPayload(organization.id),
    });

    await publishBatch(ctx, eventHandlers, publisherConfig, { now: CLAIM_CLOCK });

    const before = await prisma.notification.count({ where: { entityId: organization.id } });
    expect(before).toBeGreaterThan(0);

    // Simulate a crash before the marker: forget handler progress and republish.
    await prisma.processedEventHandler.deleteMany({ where: { eventId } });
    await prisma.outboxEvent.update({
      where: { id: eventId },
      data: { publishedAt: null, attempts: 0, nextAttemptAt: CLAIM_CLOCK, lastError: null },
    });

    await publishBatch(ctx, eventHandlers, publisherConfig, { now: CLAIM_CLOCK });

    const after = await prisma.notification.count({ where: { entityId: organization.id } });
    expect(after).toBe(before);
  });
});

describe('pin-stats handler', () => {
  it('removes a deleted provider from provider_pin_stats', async () => {
    const staff = await createUser('STAFF');
    const pin = await unusedPin();
    createdPins.push(pin);

    const organizationId = randomUUID();
    await prisma.providerOrganization.create({
      data: {
        id: organizationId,
        code: `CN-EV-${randomUUID().slice(0, 8).toUpperCase()}`,
        providerType: 'clinic',
        status: 'APPROVED',
        primaryPinCode: pin,
        createdByUserId: staff.id,
      },
    });
    createdOrganizations.push(organizationId);

    await recomputeProviderPinStats(prisma, organizationId);
    const statKey = {
      pinCode: pin,
      providerType: 'clinic' as const,
      status: 'APPROVED' as const,
      measure: 'primary' as const,
    };
    const seeded = await prisma.providerPinStats.findUnique({
      where: { pinCode_providerType_status_measure: statKey },
    });
    expect(seeded?.count).toBe(1);

    // Soft delete, then drive the event the same way the app would.
    await prisma.providerOrganization.update({
      where: { id: organizationId },
      data: { deletedAt: new Date() },
    });
    await insertEvent({
      eventType: 'provider.deleted',
      aggregateId: organizationId,
      payload: {
        organizationId,
        providerType: 'clinic',
        status: 'APPROVED',
        recordVersion: 3,
        actorUserId: null,
      },
    });

    await publishBatch(ctx, eventHandlers, publisherConfig, { now: CLAIM_CLOCK });

    expect(
      await prisma.providerPinStats.findUnique({
        where: { pinCode_providerType_status_measure: statKey },
      }),
    ).toBeNull();
    expect(await prisma.providerPinContribution.count({ where: { organizationId } })).toBe(0);
  });
});

describe('webhook deliveries', () => {
  it('writes a delivery row for a registered endpoint', async () => {
    const staff = await createUser('STAFF');
    const organization = await createOrganization(staff.id);

    const endpoint = await ctx.repositories.system.saveWebhookEndpoint({
      id: randomUUID(),
      url: `https://hooks.example.test/${randomUUID()}`,
      description: 'integration test subscriber',
      eventTypes: ['provider.approved'],
      active: true,
    });
    createdEndpointIds.push(endpoint.id);

    await insertEvent({
      eventType: 'provider.approved',
      aggregateId: organization.id,
      payload: approvalPayload(organization.id),
    });

    await publishBatch(ctx, eventHandlers, publisherConfig, { now: CLAIM_CLOCK });

    const deliveries = await prisma.webhookDelivery.findMany({
      where: { endpointId: endpoint.id },
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.eventType).toBe('provider.approved');
    expect(deliveries[0]?.status).toBe('PENDING');
    expect(deliveries[0]?.payload).toMatchObject({ type: 'provider.approved' });
  });

  it('does not deliver events the endpoint is not subscribed to', async () => {
    const staff = await createUser('STAFF');
    const organization = await createOrganization(staff.id);

    const endpoint = await ctx.repositories.system.saveWebhookEndpoint({
      id: randomUUID(),
      url: `https://hooks.example.test/${randomUUID()}`,
      description: 'integration test subscriber',
      eventTypes: ['document.expired'],
      active: true,
    });
    createdEndpointIds.push(endpoint.id);

    await insertEvent({
      eventType: 'provider.approved',
      aggregateId: organization.id,
      payload: approvalPayload(organization.id),
    });

    await publishBatch(ctx, eventHandlers, publisherConfig, { now: CLAIM_CLOCK });

    expect(await prisma.webhookDelivery.count({ where: { endpointId: endpoint.id } })).toBe(0);
  });
});

async function unusedPin(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pin = `7${String(Math.floor(Math.random() * 100_000)).padStart(5, '0')}`;
    const existing = await prisma.providerPinStats.findFirst({ where: { pinCode: pin } });
    if (!existing) return pin;
  }
  throw new Error('Could not find an unused PIN for the test');
}

describe('document expiry scan', () => {
  it('reminds on a configured day and expires the document past its date', async () => {
    const staff = await createUser('STAFF');
    const organization = await createOrganization(staff.id, 'APPROVED');

    const documentTypeId = randomUUID();
    await prisma.documentType.create({
      data: {
        id: documentTypeId,
        code: `test-expiry-${randomUUID().slice(0, 8)}`,
        name: 'Test expiry document',
        providerTypes: ['clinic'],
        requiresExpiry: true,
        expiryReminderDays: [30, 7],
      },
    });
    createdDocumentTypes.push(documentTypeId);

    const documentId = randomUUID();
    await prisma.document.create({
      data: {
        id: documentId,
        ownerType: 'provider_organization',
        ownerId: organization.id,
        documentTypeId,
        fileName: 'registration.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        storageKey: `tests/${documentId}.pdf`,
        uploadedByUserId: staff.id,
        status: 'VERIFIED',
        expiresOn: new Date('2026-06-08T00:00:00.000Z'),
      },
    });

    const reminderDay = new Date('2026-06-01T09:00:00.000Z');
    await runExpiryScan(ctx, { now: reminderDay });
    await runExpiryScan(ctx, { now: reminderDay });

    const expiring = await prisma.outboxEvent.findMany({
      where: { eventType: 'document.expiring', aggregateId: organization.id },
    });
    expect(expiring).toHaveLength(1);
    expect(expiring[0]?.payload).toMatchObject({
      subjectType: 'document',
      subjectId: documentId,
      daysLeft: 7,
    });

    const afterExpiry = new Date('2026-06-09T09:00:00.000Z');
    await runExpiryScan(ctx, { now: afterExpiry });
    await runExpiryScan(ctx, { now: afterExpiry });

    const document = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.status).toBe('EXPIRED');

    const flagged = await prisma.providerOrganization.findUniqueOrThrow({
      where: { id: organization.id },
    });
    expect(flagged.complianceFlag).toBe(true);
    expect(flagged.complianceFlagReason).toMatch(/expired/i);

    const expired = await prisma.outboxEvent.findMany({
      where: { eventType: 'document.expired', aggregateId: organization.id },
    });
    expect(expired).toHaveLength(1);
  });
});

afterAll(async () => {
  // Clean up by the test-only code prefix as well as by id, so a run that fails
  // before recording an id still leaves the database tidy. Documents have no
  // foreign key to their owner, so they must go before the organizations.
  const organizations = await prisma.providerOrganization.findMany({
    where: { code: { startsWith: 'CN-EV-' } },
    select: { id: true },
  });
  const organizationIds = Array.from(
    new Set([...organizations.map((row) => row.id), ...createdOrganizations]),
  );
  const events = await prisma.outboxEvent.findMany({
    where: { aggregateId: { in: organizationIds } },
    select: { id: true },
  });
  const eventIds = Array.from(new Set([...events.map((row) => row.id), ...createdEventIds]));
  const users = await prisma.user.findMany({
    where: { OR: [{ email: { startsWith: 'events-' } }, { id: { in: createdUsers } }] },
    select: { id: true },
  });
  const userIds = users.map((row) => row.id);

  await prisma.processedEventHandler.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.notification.deleteMany({ where: { entityId: { in: organizationIds } } });
  await prisma.document.deleteMany({
    where: { OR: [{ ownerId: { in: organizationIds } }, { uploadedByUserId: { in: userIds } }] },
  });
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: organizationIds } } });
  await prisma.providerOrganization.deleteMany({ where: { id: { in: organizationIds } } });
  await prisma.user.deleteMany({
    where: {
      OR: [{ email: { startsWith: 'events-' } }, { id: { in: createdUsers } }],
    },
  });
  await prisma.documentType.deleteMany({
    where: {
      OR: [{ code: { startsWith: 'test-expiry-' } }, { id: { in: createdDocumentTypes } }],
    },
  });
  await prisma.providerPinStats.deleteMany({ where: { pinCode: { in: createdPins } } });
  await prisma.webhookEndpoint.deleteMany({
    where: {
      OR: [
        { id: { in: createdEndpointIds } },
        { url: { startsWith: 'https://hooks.example.test/' } },
      ],
    },
  });
  await prisma.$disconnect();
});
