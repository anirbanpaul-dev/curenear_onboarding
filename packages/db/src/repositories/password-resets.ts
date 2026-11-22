import type { PasswordResetTokenRepository } from '@curenear/shared';
import type { DbClient } from '../client';

export function createPasswordResetRepository(db: DbClient): PasswordResetTokenRepository {
  return {
    async create(input) {
      await db.passwordResetToken.create({
        data: {
          id: input.id,
          userId: input.userId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
        },
      });
    },

    async findValid(tokenHash, now) {
      const row = await db.passwordResetToken.findFirst({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
        select: { id: true, userId: true },
      });
      return row ?? null;
    },

    async markUsed(input) {
      await db.passwordResetToken.updateMany({
        where: { id: input.id, usedAt: null },
        data: { usedAt: input.usedAt },
      });
    },

    async invalidateForUser(input) {
      await db.passwordResetToken.updateMany({
        where: { userId: input.userId, usedAt: null },
        data: { usedAt: input.usedAt },
      });
    },
  };
}
