import {
  canonicalEventType,
  notificationTypes,
  preferenceOption,
  renderNotificationEmail,
} from '@curenear/shared';
import type { NotificationDraft } from './notification-drafts';
import { buildNotificationDrafts } from './notification-drafts';
import type { EventHandler } from './types';

/**
 * Fan-out into in-app notifications and email.
 *
 * In-app rows are idempotent: `(user_id, type, event_id)` is unique, so a retried
 * handler cannot duplicate a bell entry. Email is at-least-once — a crash after
 * SMTP accepted the message but before the handler marker was written sends it
 * again. That trade-off is deliberate: a missing compliance reminder is worse
 * than a duplicate.
 */
export const notificationsHandler: EventHandler = {
  name: 'notifications',
  handles: (eventType) => notificationTypes.includes(eventType),

  async handle(event, ctx) {
    const type = canonicalEventType(event.eventType);
    const drafts = await buildNotificationDrafts(type, event, ctx);
    if (drafts.length === 0) return;

    const admins = drafts.some((draft) => draft.audience === 'admins')
      ? await ctx.repositories.users.listByRole('ADMIN')
      : [];

    for (const draft of drafts) {
      const recipients =
        draft.audience === 'admins'
          ? admins.map((user) => ({ id: user.id, email: user.email }))
          : draft.ownerUserId
            ? await ownerRecipient(ctx, draft.ownerUserId)
            : [];

      for (const recipient of recipients) {
        const preferences = await ctx.repositories.notifications.preferences(recipient.id);
        const saved = preferences.find((row) => row.type === type);
        const option = preferenceOption(type);
        const inApp = saved?.inApp ?? option.defaultInApp;
        const wantsEmail = saved?.email ?? option.defaultEmail;

        if (inApp) {
          await ctx.repositories.notifications.create({
            id: crypto.randomUUID(),
            userId: recipient.id,
            type,
            title: draft.title,
            body: draft.body,
            entityType: draft.entityType,
            entityId: draft.entityId,
            eventId: event.id,
            createdAt: ctx.now(),
          });
        }

        if (wantsEmail && recipient.email) {
          const email = renderNotificationEmail({
            type,
            title: draft.title,
            body: draft.body,
            entityType: draft.entityType,
            entityId: draft.entityId,
            appUrl: ctx.env.APP_URL,
          });
          await ctx.email.send({ to: recipient.email, ...email });
        }
      }
    }

    ctx.logger.info({ eventId: event.id, type, drafts: drafts.length }, 'notifications_dispatched');
  },
};

async function ownerRecipient(
  ctx: Parameters<EventHandler['handle']>[1],
  userId: string,
): Promise<Array<{ id: string; email: string }>> {
  const user = await ctx.repositories.notifications.recipients(userId);
  return user ? [{ id: user.id, email: user.email }] : [];
}

export type { NotificationDraft };
