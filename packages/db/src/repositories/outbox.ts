import { Prisma } from '@prisma/client';
import type { OutboxEventRecord, OutboxRepository } from '@curenear/shared';
import type { DbClient } from '../client';
import { mapOutboxEvent, toJsonObject } from '../mappers';

interface RawOutboxRow {
  id: string;
  eventType: string;
  eventVersion: number;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  dedupeKey: string | null;
  occurredAt: Date;
  publishedAt: Date | null;
  attempts: number;
  lastError: string | null;
}

export function createOutboxRepository(db: DbClient): OutboxRepository {
  return {
    async append(input) {
      await db.outboxEvent.create({
        data: {
          id: input.id,
          eventType: input.eventType,
          eventVersion: input.eventVersion,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          payload: input.payload as Prisma.InputJsonValue,
          occurredAt: input.occurredAt,
          dedupeKey: input.dedupeKey ?? null,
        },
      });
    },

    /**
     * Claims a batch without blocking concurrent workers. `attempts` increments
     * on claim so a poison message backs off instead of spinning.
     */
    async claimBatch(limit, now) {
      const rows = await db.$queryRaw<RawOutboxRow[]>(Prisma.sql`
        UPDATE "outbox_events" AS o
        SET "attempts" = o."attempts" + 1,
            "updated_at" = CURRENT_TIMESTAMP
        FROM (
          SELECT "id"
          FROM "outbox_events"
          WHERE "published_at" IS NULL
            AND "dead_lettered_at" IS NULL
            AND "next_attempt_at" <= ${now}
          ORDER BY "occurred_at" ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        ) AS claimable
        WHERE o."id" = claimable."id"
        RETURNING
          o."id",
          o."event_type" AS "eventType",
          o."event_version" AS "eventVersion",
          o."aggregate_type" AS "aggregateType",
          o."aggregate_id" AS "aggregateId",
          o."payload",
          o."dedupe_key" AS "dedupeKey",
          o."occurred_at" AS "occurredAt",
          o."published_at" AS "publishedAt",
          o."attempts",
          o."last_error" AS "lastError";
      `);

      return rows.map((row): OutboxEventRecord => ({
        id: row.id,
        eventType: row.eventType,
        eventVersion: row.eventVersion,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        payload: toJsonObject(row.payload),
        occurredAt: row.occurredAt,
        publishedAt: row.publishedAt,
        attempts: row.attempts,
        lastError: row.lastError,
        dedupeKey: row.dedupeKey,
      }));
    },

    async markPublished(id, publishedAt) {
      await db.outboxEvent.updateMany({
        where: { id },
        data: { publishedAt, lastError: null },
      });
    },

    async markFailed(id, error, nextAttemptAt) {
      await db.outboxEvent.updateMany({
        where: { id, deadLetteredAt: null },
        data: { lastError: error.slice(0, 2000), nextAttemptAt },
      });
    },

    async markDeadLettered(id, error, deadLetteredAt, attempts) {
      await db.outboxEvent.updateMany({
        where: { id, deadLetteredAt: null },
        data: {
          deadLetteredAt,
          attempts,
          lastError: error.slice(0, 2000),
        },
      });
    },
  };
}

export { mapOutboxEvent };
