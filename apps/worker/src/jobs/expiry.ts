import type { AppContext } from '../context';

const DAY_MS = 86_400_000;
/** How far ahead the scan looks; 65 days covers the 60-day reminder ladder. */
const SCAN_HORIZON_DAYS = 65;
const MAX_CANDIDATES = 2000;

export interface ExpiryScanSummary extends Record<string, unknown> {
  documents: number;
  licences: number;
  expiring: number;
  expired: number;
}

/** Whole calendar days from `now` to `target`, ignoring the time of day. */
export function calendarDaysUntil(target: Date, now: Date): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const day = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  return Math.round((day - today) / DAY_MS);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function emitOnce(
  ctx: AppContext,
  input: {
    eventType: 'document.expiring' | 'document.expired';
    aggregateId: string;
    payload: Record<string, unknown>;
    occurredAt: Date;
    dedupeKey: string;
  },
): Promise<boolean> {
  try {
    await ctx.repositories.outbox.append({
      id: crypto.randomUUID(),
      eventType: input.eventType,
      eventVersion: 1,
      aggregateType: 'provider_organization',
      aggregateId: input.aggregateId,
      payload: input.payload,
      occurredAt: input.occurredAt,
      dedupeKey: input.dedupeKey,
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
}

/**
 * Daily document and licence expiry scan.
 *
 * - On a configured reminder day (`document_types.expiry_reminder_days`; licences
 *   use 60/30/7) a `document.expiring` event is written. The dedupe key includes
 *   the day count, so rerunning the job on the same day is a no-op.
 * - Past the expiry date the document becomes EXPIRED, the provider gets a
 *   compliance flag and a `document.expired` event is written once.
 * - An organisation whose expired items have since been replaced has its flag
 *   cleared on the next run.
 */
export async function runExpiryScan(
  ctx: AppContext,
  options: { now?: Date } = {},
): Promise<ExpiryScanSummary> {
  const now = options.now ?? ctx.now();
  const horizon = new Date(now.getTime() + SCAN_HORIZON_DAYS * DAY_MS);
  const summary: ExpiryScanSummary = { documents: 0, licences: 0, expiring: 0, expired: 0 };

  const documents = await ctx.repositories.documents.listExpiring(horizon, MAX_CANDIDATES);
  summary.documents = documents.length;

  for (const document of documents) {
    const daysLeft = calendarDaysUntil(document.expiresOn, now);
    const base = {
      subjectType: 'document' as const,
      subjectId: document.documentId,
      organizationId: document.organizationId,
      documentTypeCode: document.documentTypeCode,
      expiresOn: isoDate(document.expiresOn),
      daysLeft,
    };

    if (daysLeft < 0) {
      const marked = await ctx.repositories.documents.markExpired(document.documentId, now);
      if (!marked) continue;
      await ctx.repositories.documents.setComplianceFlag({
        organizationId: document.organizationId,
        flagged: true,
        reason: `${document.documentTypeName} expired on ${isoDate(document.expiresOn)}`,
      });
      const emitted = await emitOnce(ctx, {
        eventType: 'document.expired',
        aggregateId: document.organizationId,
        payload: base,
        occurredAt: now,
        dedupeKey: `document:${document.documentId}:expired`,
      });
      if (emitted) summary.expired += 1;
      continue;
    }

    if (document.reminderDays.includes(daysLeft)) {
      const emitted = await emitOnce(ctx, {
        eventType: 'document.expiring',
        aggregateId: document.organizationId,
        payload: base,
        occurredAt: now,
        dedupeKey: `document:${document.documentId}:expiring:${daysLeft}`,
      });
      if (emitted) summary.expiring += 1;
    }
  }

  const licences = await ctx.repositories.documents.listLicencesExpiring(horizon, MAX_CANDIDATES);
  summary.licences = licences.length;

  for (const licence of licences) {
    const daysLeft = calendarDaysUntil(licence.validTo, now);
    const base = {
      subjectType: 'licence' as const,
      subjectId: licence.licenceId,
      organizationId: licence.organizationId,
      documentTypeCode: licence.licenceTypeName ?? 'Licence',
      expiresOn: isoDate(licence.validTo),
      daysLeft,
    };

    if (daysLeft < 0) {
      await ctx.repositories.documents.setComplianceFlag({
        organizationId: licence.organizationId,
        flagged: true,
        reason: `${licence.licenceTypeName ?? 'Licence'} ${licence.licenceNumber} expired on ${isoDate(licence.validTo)}`,
      });
      const emitted = await emitOnce(ctx, {
        eventType: 'document.expired',
        aggregateId: licence.organizationId,
        payload: base,
        occurredAt: now,
        dedupeKey: `licence:${licence.licenceId}:expired`,
      });
      if (emitted) summary.expired += 1;
      continue;
    }

    if (licence.reminderDays.includes(daysLeft)) {
      const emitted = await emitOnce(ctx, {
        eventType: 'document.expiring',
        aggregateId: licence.organizationId,
        payload: base,
        occurredAt: now,
        dedupeKey: `licence:${licence.licenceId}:expiring:${daysLeft}`,
      });
      if (emitted) summary.expiring += 1;
    }
  }

  await clearResolvedFlags(ctx, now);
  return summary;
}

/**
 * Clears the flag for organisations that no longer have an expired document or
 * licence. Runs after the scan so a replacement uploaded yesterday removes the
 * flag today.
 */
async function clearResolvedFlags(ctx: AppContext, now: Date): Promise<void> {
  const flagged = await ctx.prisma.providerOrganization.findMany({
    where: { complianceFlag: true, deletedAt: null },
    select: { id: true },
    take: MAX_CANDIDATES,
  });
  if (flagged.length === 0) return;

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  for (const organization of flagged) {
    const [expiredDocuments, expiredLicences] = await Promise.all([
      ctx.prisma.document.count({
        where: {
          ownerType: 'provider_organization',
          ownerId: organization.id,
          deletedAt: null,
          status: 'EXPIRED',
        },
      }),
      ctx.prisma.providerLicence.count({
        where: { organizationId: organization.id, validTo: { lt: today } },
      }),
    ]);

    if (expiredDocuments === 0 && expiredLicences === 0) {
      await ctx.repositories.documents.setComplianceFlag({
        organizationId: organization.id,
        flagged: false,
        reason: null,
      });
    }
  }
}
