import type { SessionRepository } from '@curenear/shared';
import type { DbClient } from '../client';
import { mapSession } from '../mappers';

export function createSessionRepository(db: DbClient): SessionRepository {
  return {
    async create(input) {
      await db.session.create({
        data: {
          id: input.id,
          userId: input.userId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
        },
      });
    },

    async findValidByTokenHash(tokenHash, now) {
      const row = await db.session.findFirst({
        where: {
          tokenHash,
          expiresAt: { gt: now },
          revokedAt: null,
          user: { status: 'ACTIVE', deletedAt: null },
        },
        include: { user: true },
      });
      return row ? mapSession(row) : null;
    },

    async touch(input) {
      await db.session.updateMany({
        where: { id: input.id, revokedAt: null },
        data: { lastSeenAt: input.lastSeenAt, expiresAt: input.expiresAt },
      });
    },

    async revokeByTokenHash(tokenHash, revokedAt) {
      await db.session.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt },
      });
    },

    async revokeAllForUser(userId, revokedAt) {
      const result = await db.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt },
      });
      return result.count;
    },

    async deleteExpired(now) {
      const result = await db.session.deleteMany({ where: { expiresAt: { lte: now } } });
      return result.count;
    },
  };
}
