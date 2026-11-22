import type {
  NotificationPreferenceRecord,
  NotificationRecord,
  NotificationRepository,
  Role,
} from '@curenear/shared';
import type { DbClient } from '../client';

function mapNotification(row: {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  eventId: string | null;
  readAt: Date | null;
  createdAt: Date;
}): NotificationRecord {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    title: row.title,
    body: row.body,
    entityType: row.entityType,
    entityId: row.entityId,
    eventId: row.eventId,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

/**
 * In-app notifications and per-user preferences.
 *
 * Creation is idempotent through the `(user_id, type, event_id)` unique index:
 * a replayed outbox event returns false instead of adding a second bell entry.
 */
export function createNotificationRepository(db: DbClient): NotificationRepository {
  return {
    async create(input) {
      try {
        await db.notification.create({
          data: {
            id: input.id,
            userId: input.userId,
            type: input.type,
            title: input.title,
            body: input.body,
            entityType: input.entityType,
            entityId: input.entityId,
            eventId: input.eventId,
            createdAt: input.createdAt,
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

    async listForUser(userId, page, options) {
      const where = { userId, ...(options?.unreadOnly ? { readAt: null } : {}) };
      const [rows, total, unread] = await Promise.all([
        db.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: page.skip,
          take: page.take,
        }),
        db.notification.count({ where }),
        db.notification.count({ where: { userId, readAt: null } }),
      ]);
      return { rows: rows.map(mapNotification), total, unread };
    },

    async unreadCount(userId) {
      return db.notification.count({ where: { userId, readAt: null } });
    },

    async markRead(input) {
      const result = await db.notification.updateMany({
        where: {
          userId: input.userId,
          readAt: null,
          ...(input.ids && input.ids.length > 0 ? { id: { in: input.ids } } : {}),
        },
        data: { readAt: input.readAt },
      });
      return result.count;
    },

    async preferences(userId) {
      const rows = await db.notificationPreference.findMany({
        where: { userId },
        orderBy: { type: 'asc' },
      });
      return rows.map((row): NotificationPreferenceRecord => ({
        type: row.type,
        inApp: row.inApp,
        email: row.email,
        updatedAt: row.updatedAt,
      }));
    },

    async savePreferences(userId, values, at) {
      for (const value of values) {
        await db.notificationPreference.upsert({
          where: { userId_type: { userId, type: value.type } },
          create: {
            userId,
            type: value.type,
            inApp: value.inApp,
            email: value.email,
            updatedAt: at,
          },
          update: { inApp: value.inApp, email: value.email, updatedAt: at },
        });
      }
    },

    async recipients(userId) {
      const user = await db.user.findFirst({
        where: { id: userId, deletedAt: null, status: 'ACTIVE' },
        select: { id: true, email: true, role: true },
      });
      return user ? { id: user.id, email: user.email, role: user.role as Role } : null;
    },
  };
}
