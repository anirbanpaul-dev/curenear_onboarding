import { Prisma } from '@prisma/client';
import type {
  JobRunRecord,
  OutboxAdminRow,
  SystemRepository,
  WebhookDeliveryRecord,
  WebhookEndpointRecord,
} from '@curenear/shared';
import type { DbClient } from '../client';
import { toJsonObject } from '../mappers';

/**
 * Operational data for the event pipeline: the outbox console, handler
 * idempotency markers, job history, webhook deliveries and the search read
 * model. Nothing here is used by the portal's business logic.
 */
export function createSystemRepository(db: DbClient): SystemRepository {
  return {
    async outboxList(filters, page) {
      const where: Prisma.OutboxEventWhereInput = {
        ...(filters.eventType ? { eventType: filters.eventType } : {}),
        ...(filters.status === 'pending'
          ? { publishedAt: null, deadLetteredAt: null }
          : filters.status === 'published'
            ? { publishedAt: { not: null } }
            : filters.status === 'dead'
              ? { deadLetteredAt: { not: null } }
              : {}),
      };

      const [rows, total, deadCount] = await Promise.all([
        db.outboxEvent.findMany({
          where,
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          skip: page.skip,
          take: page.take,
        }),
        db.outboxEvent.count({ where }),
        db.outboxEvent.count({ where: { deadLetteredAt: { not: null } } }),
      ]);

      return {
        rows: rows.map((row): OutboxAdminRow => ({
          id: row.id,
          eventType: row.eventType,
          eventVersion: row.eventVersion,
          aggregateType: row.aggregateType,
          aggregateId: row.aggregateId,
          attempts: row.attempts,
          occurredAt: row.occurredAt,
          publishedAt: row.publishedAt,
          deadLetteredAt: row.deadLetteredAt,
          nextAttemptAt: row.nextAttemptAt,
          lastError: row.lastError,
        })),
        total,
        deadCount,
      };
    },

    async outboxRetry(id, at) {
      const result = await db.outboxEvent.updateMany({
        where: { id, deadLetteredAt: { not: null } },
        data: { deadLetteredAt: null, attempts: 0, nextAttemptAt: at, lastError: null },
      });
      return result.count > 0;
    },

    async purgeOutbox(input) {
      const result = await db.outboxEvent.deleteMany({
        where: {
          OR: [
            { publishedAt: { not: null, lt: input.publishedBefore } },
            { deadLetteredAt: { not: null, lt: input.deadBefore } },
          ],
        },
      });
      return result.count;
    },

    async alreadyProcessed(eventId, handler) {
      const row = await db.processedEventHandler.findUnique({
        where: { eventId_handler: { eventId, handler } },
        select: { eventId: true },
      });
      return row !== null;
    },

    async markProcessed(eventId, handler, at) {
      await db.processedEventHandler.upsert({
        where: { eventId_handler: { eventId, handler } },
        create: { eventId, handler, processedAt: at },
        update: {},
      });
    },

    async recordJobRun(input) {
      await db.jobRun.create({
        data: {
          id: input.id,
          queue: input.queue,
          status: input.status,
          startedAt: input.startedAt,
          finishedAt: input.finishedAt,
          durationMs: Math.max(0, input.finishedAt.getTime() - input.startedAt.getTime()),
          summary: input.summary as Prisma.InputJsonValue,
          error: input.error,
        },
      });
    },

    async listJobRuns(page) {
      const [rows, total] = await Promise.all([
        db.jobRun.findMany({
          orderBy: { startedAt: 'desc' },
          skip: page.skip,
          take: page.take,
        }),
        db.jobRun.count(),
      ]);
      return {
        rows: rows.map((row): JobRunRecord => ({
          id: row.id,
          queue: row.queue,
          status: row.status as JobRunRecord['status'],
          startedAt: row.startedAt,
          finishedAt: row.finishedAt,
          durationMs: row.durationMs,
          summary: toJsonObject(row.summary),
          error: row.error,
        })),
        total,
      };
    },

    async webhookEndpoints() {
      const rows = await db.webhookEndpoint.findMany({ orderBy: { createdAt: 'asc' } });
      return rows.map((row): WebhookEndpointRecord => ({
        id: row.id,
        url: row.url,
        description: row.description,
        eventTypes: row.eventTypes,
        active: row.active,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
    },

    async saveWebhookEndpoint(input) {
      const row = await db.webhookEndpoint.upsert({
        where: { id: input.id },
        create: {
          id: input.id,
          url: input.url,
          description: input.description,
          eventTypes: input.eventTypes,
          active: input.active,
        },
        update: {
          url: input.url,
          description: input.description,
          eventTypes: input.eventTypes,
          active: input.active,
        },
      });
      return {
        id: row.id,
        url: row.url,
        description: row.description,
        eventTypes: row.eventTypes,
        active: row.active,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    },

    async deleteWebhookEndpoint(id) {
      const result = await db.webhookEndpoint.deleteMany({ where: { id } });
      return result.count > 0;
    },

    async createWebhookDelivery(input) {
      try {
        await db.webhookDelivery.create({
          data: {
            id: input.id,
            endpointId: input.endpointId,
            eventId: input.eventId,
            eventType: input.eventType,
            payload: input.payload as Prisma.InputJsonValue,
            createdAt: input.createdAt,
            nextAttemptAt: input.createdAt,
          },
        });
        return true;
      } catch (error) {
        const code =
          typeof error === 'object' && error !== null && 'code' in error
            ? (error as { code?: string }).code
            : undefined;
        if (code === 'P2002') return false;
        throw error;
      }
    },

    async pendingWebhookDeliveries(limit, now) {
      const rows = await db.webhookDelivery.findMany({
        where: { status: 'PENDING', nextAttemptAt: { lte: now } },
        orderBy: { nextAttemptAt: 'asc' },
        take: limit,
      });
      return rows.map((row): WebhookDeliveryRecord => ({
        id: row.id,
        endpointId: row.endpointId,
        eventId: row.eventId,
        eventType: row.eventType,
        payload: toJsonObject(row.payload),
        status: row.status as WebhookDeliveryRecord['status'],
        attempts: row.attempts,
        nextAttemptAt: row.nextAttemptAt,
        lastError: row.lastError,
        deliveredAt: row.deliveredAt,
        createdAt: row.createdAt,
      }));
    },

    async markWebhookDelivered(id, at) {
      await db.webhookDelivery.updateMany({
        where: { id },
        data: { status: 'DELIVERED', deliveredAt: at, lastError: null },
      });
    },

    async markWebhookFailed(input) {
      await db.webhookDelivery.updateMany({
        where: { id: input.id },
        data: {
          attempts: input.attempts,
          lastError: input.error.slice(0, 2000),
          nextAttemptAt: input.nextAttemptAt,
          status: input.status,
        },
      });
    },

    async refreshProviderSearchIndex(organizationId, at) {
      await db.$executeRaw(Prisma.sql`
        INSERT INTO "provider_search_index" (
          "organization_id", "code", "provider_type", "status", "primary_pin_code",
          "legal_name", "city", "doctor_count", "indexed_at"
        )
        SELECT
          o."id",
          o."code",
          o."provider_type",
          o."status",
          o."primary_pin_code",
          o."legal_name",
          (SELECT l."city" FROM "provider_locations" l
            WHERE l."organization_id" = o."id"
            ORDER BY l."is_primary" DESC, l."created_at" ASC
            LIMIT 1),
          (SELECT count(DISTINCT dl."doctor_profile_id")::int
             FROM "doctor_locations" dl
             JOIN "doctor_profiles" dp ON dp."id" = dl."doctor_profile_id"
            WHERE dp."deleted_at" IS NULL
              AND (dl."clinic_organization_id" = o."id"
                   OR dl."location_id" IN (
                     SELECT l2."id" FROM "provider_locations" l2
                      WHERE l2."organization_id" = o."id"))),
          ${at}
        FROM "provider_organizations" o
        WHERE o."id" = ${organizationId}::uuid
        ON CONFLICT ("organization_id") DO UPDATE SET
          "code" = EXCLUDED."code",
          "provider_type" = EXCLUDED."provider_type",
          "status" = EXCLUDED."status",
          "primary_pin_code" = EXCLUDED."primary_pin_code",
          "legal_name" = EXCLUDED."legal_name",
          "city" = EXCLUDED."city",
          "doctor_count" = EXCLUDED."doctor_count",
          "indexed_at" = EXCLUDED."indexed_at"
      `);
    },

    async removeProviderSearchIndex(organizationId) {
      await db.providerSearchIndex.deleteMany({ where: { organizationId } });
    },
  };
}
