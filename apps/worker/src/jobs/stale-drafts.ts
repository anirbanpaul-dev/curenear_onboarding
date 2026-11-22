import { preferenceOption, renderNotificationEmail } from '@curenear/shared';
import type { AppContext } from '../context';

const DAY_MS = 86_400_000;
const MAX_DRAFTS = 500;

export interface StaleDraftSummary extends Record<string, unknown> {
  candidates: number;
  reminded: number;
}

/**
 * Reminds onboarding staff about drafts that have not been touched for
 * `STALE_DRAFT_DAYS` (7 by default).
 *
 * Idempotent per week: a reminder is only written when this user has not already
 * been reminded about this draft since the cutoff, so a second instance running
 * the same schedule does nothing.
 */
export async function runStaleDraftReminders(
  ctx: AppContext,
  options: { now?: Date } = {},
): Promise<StaleDraftSummary> {
  const now = options.now ?? ctx.now();
  const days = ctx.env.STALE_DRAFT_DAYS;
  const cutoff = new Date(now.getTime() - days * DAY_MS);

  const drafts = await ctx.prisma.providerOrganization.findMany({
    where: { status: 'DRAFT', deletedAt: null, updatedAt: { lt: cutoff } },
    orderBy: { updatedAt: 'asc' },
    take: MAX_DRAFTS,
    select: { id: true, code: true, legalName: true, createdByUserId: true, updatedAt: true },
  });

  const summary: StaleDraftSummary = { candidates: drafts.length, reminded: 0 };
  if (drafts.length === 0) return summary;

  for (const draft of drafts) {
    const recentlyReminded = await ctx.prisma.notification.findFirst({
      where: {
        userId: draft.createdByUserId,
        type: 'provider.stale_draft',
        entityId: draft.id,
        createdAt: { gte: cutoff },
      },
      select: { id: true },
    });
    if (recentlyReminded) continue;

    const title = `${draft.code}: application still in draft`;
    const body = `${draft.legalName ?? draft.code} has been in draft since ${draft.updatedAt
      .toISOString()
      .slice(0, 10)}. Finish the sections and submit it for review.`;

    await ctx.repositories.notifications.create({
      id: crypto.randomUUID(),
      userId: draft.createdByUserId,
      type: 'provider.stale_draft',
      title,
      body,
      entityType: 'provider_organization',
      entityId: draft.id,
      eventId: null,
      createdAt: now,
    });

    const recipient = await ctx.repositories.notifications.recipients(draft.createdByUserId);
    const preferences = recipient
      ? await ctx.repositories.notifications.preferences(recipient.id)
      : [];
    const saved = preferences.find((row) => row.type === 'provider.stale_draft');
    const wantsEmail = saved?.email ?? preferenceOption('provider.stale_draft').defaultEmail;

    if (recipient && wantsEmail) {
      const email = renderNotificationEmail({
        type: 'provider.stale_draft',
        title,
        body,
        entityType: 'provider_organization',
        entityId: draft.id,
        appUrl: ctx.env.APP_URL,
      });
      await ctx.email.send({ to: recipient.email, ...email });
    }

    summary.reminded += 1;
  }

  return summary;
}
