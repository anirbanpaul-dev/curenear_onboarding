import type { VerificationRepository } from '@curenear/shared';
import type { DbClient } from '../client';
import { mapVerification } from '../mappers';

export function createVerificationRepository(db: DbClient): VerificationRepository {
  return {
    async listByProvider(providerId) {
      const rows = await db.verificationRecord.findMany({
        where: { providerId },
        orderBy: { item: 'asc' },
      });
      return rows.map(mapVerification);
    },

    async upsert(input) {
      const row = await db.verificationRecord.upsert({
        where: { providerId_item: { providerId: input.providerId, item: input.item } },
        create: {
          id: input.id,
          providerId: input.providerId,
          item: input.item,
          status: input.status,
          verifiedByUserId: input.verifiedByUserId,
          verifiedOn: input.verifiedOn,
          source: input.source,
          evidenceRef: input.evidenceRef,
          reason: input.reason,
          nextVerificationDate: input.nextVerificationDate,
        },
        update: {
          status: input.status,
          verifiedByUserId: input.verifiedByUserId,
          verifiedOn: input.verifiedOn,
          source: input.source,
          evidenceRef: input.evidenceRef,
          reason: input.reason,
          nextVerificationDate: input.nextVerificationDate,
        },
      });
      return mapVerification(row);
    },
  };
}
