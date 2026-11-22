import { Prisma } from '@prisma/client';
import type { IdempotencyRepository } from '@curenear/shared';
import type { DbClient } from '../client';
import { toJsonObject } from '../mappers';

/** Scope is "<userId>:<endpoint>"; ids are uuids, so the separator is unambiguous. */
function scopeFor(userId: string, endpoint: string): string {
  return `${userId}:${endpoint}`;
}

export function createIdempotencyRepository(db: DbClient): IdempotencyRepository {
  return {
    async find(input) {
      const row = await db.idempotencyKey.findUnique({
        where: { scope_key: { scope: scopeFor(input.userId, input.endpoint), key: input.key } },
      });
      if (!row) return null;

      return {
        key: row.key,
        requestHash: row.requestHash,
        response: toJsonObject(row.response),
        createdAt: row.createdAt,
      };
    },

    async save(input) {
      await db.idempotencyKey.create({
        data: {
          scope: scopeFor(input.userId, input.endpoint),
          key: input.key,
          requestHash: input.requestHash,
          response: input.response as Prisma.InputJsonValue,
        },
      });
    },
  };
}
