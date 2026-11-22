import type { AuditRepository } from '@curenear/shared';
import type { DbClient } from '../client';
import { mapAudit } from '../mappers';

export function createAuditRepository(db: DbClient): AuditRepository {
  return {
    async append(input) {
      await db.auditLog.create({
        data: {
          id: input.id,
          actorUserId: input.actorUserId,
          actorRole: input.actorRole,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          requestId: input.requestId,
          changedFieldKeys: input.changedFieldKeys,
          fromStatus: input.fromStatus,
          toStatus: input.toStatus,
          reason: input.reason,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          createdAt: input.createdAt,
        },
      });
    },

    async listForEntity(entityType, entityId, limit) {
      const rows = await db.auditLog.findMany({
        where: { entityType, entityId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      return rows.map(mapAudit);
    },

    async listRecent(limit) {
      const rows = await db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
      return rows.map(mapAudit);
    },
  };
}
