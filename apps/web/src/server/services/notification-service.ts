import {
  notificationPreferenceCatalogue,
  type Actor,
  type MarkNotificationsReadInput,
  type NotificationDto,
  type NotificationListResult,
  type NotificationPreferenceDto,
  type NotificationPreferencesInput,
  type NotificationsQuery,
} from '@curenear/shared';
import type { ServiceDeps } from './service-deps';

/**
 * A user's own notifications. Every method is scoped to `actor.userId`, so one
 * account can never read or mark another account's rows.
 */
export function createNotificationService(deps: ServiceDeps) {
  async function preferences(actor: Actor): Promise<NotificationPreferenceDto[]> {
    const saved = await deps.repositories.notifications.preferences(actor.userId);
    return notificationPreferenceCatalogue.map((option) => {
      const row = saved.find((entry) => entry.type === option.type);
      return {
        type: option.type,
        label: option.label,
        description: option.description,
        inApp: row?.inApp ?? option.defaultInApp,
        email: row?.email ?? option.defaultEmail,
      };
    });
  }

  return {
    async list(actor: Actor, query: NotificationsQuery): Promise<NotificationListResult> {
      const page = {
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      };
      const result = await deps.repositories.notifications.listForUser(actor.userId, page, {
        unreadOnly: query.unread === 'true',
      });

      const rows: NotificationDto[] = result.rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        entityType: row.entityType,
        entityId: row.entityId,
        readAt: row.readAt ? row.readAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      }));

      return {
        rows,
        total: result.total,
        unread: result.unread,
        page: query.page,
        pageSize: query.pageSize,
      };
    },

    async unreadCount(actor: Actor): Promise<{ unread: number }> {
      return { unread: await deps.repositories.notifications.unreadCount(actor.userId) };
    },

    async markRead(
      actor: Actor,
      input: MarkNotificationsReadInput,
    ): Promise<{ marked: number; unread: number }> {
      const marked = await deps.repositories.notifications.markRead({
        userId: actor.userId,
        ...(input.ids ? { ids: input.ids } : {}),
        readAt: deps.now(),
      });
      const unread = await deps.repositories.notifications.unreadCount(actor.userId);
      return { marked, unread };
    },

    preferences,

    async savePreferences(
      actor: Actor,
      input: NotificationPreferencesInput,
    ): Promise<NotificationPreferenceDto[]> {
      await deps.repositories.notifications.savePreferences(
        actor.userId,
        input.preferences.map((preference) => ({
          type: preference.type,
          inApp: preference.in_app,
          email: preference.email,
        })),
        deps.now(),
      );
      return preferences(actor);
    },
  };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
