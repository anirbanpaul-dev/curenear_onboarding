import type { OutboxEventRecord } from '@curenear/shared';
import type { AppContext } from '../context';

/** A notification to one audience, before recipients are resolved. */
export interface NotificationDraft {
  audience: 'admins' | 'owner';
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  ownerUserId?: string | null;
}

/**
 * Turns an event into human-readable notifications. Recipients are resolved from
 * the database, never from the payload — events deliberately carry no names or
 * email addresses.
 */
export async function buildNotificationDrafts(
  type: string,
  event: OutboxEventRecord,
  ctx: AppContext,
): Promise<NotificationDraft[]> {
  const organizationId = organizationIdOf(event);
  const organization = organizationId
    ? await ctx.repositories.onboarding.findOrganizationById(organizationId)
    : null;
  const code = organization?.code ?? 'Provider';
  const label = organization?.legalName ?? code;
  const reason =
    typeof event.payload.reason === 'string' && event.payload.reason.trim().length > 0
      ? ` Reason: ${event.payload.reason.trim()}`
      : '';

  const providerDraft = (
    summary: string,
    detail: string,
    audience: 'admins' | 'owner' = 'owner',
  ): NotificationDraft => ({
    audience,
    title: `${code}: ${summary}`,
    body: detail,
    entityType: 'provider_organization',
    entityId: organizationId,
    ownerUserId: organization?.createdByUserId ?? null,
  });

  switch (type) {
    case 'staff.created':
      return [
        {
          audience: 'admins',
          title: 'New staff account created',
          body: 'An onboarding staff account was created and emailed its temporary password.',
          entityType: 'user',
          entityId:
            typeof event.payload.staffUserId === 'string' ? event.payload.staffUserId : null,
        },
      ];

    case 'provider.submitted':
      return [
        providerDraft(
          'submitted for review',
          `${label} was submitted and is waiting in the review queue.`,
          'admins',
        ),
      ];

    case 'provider.review_started':
      return [providerDraft('review started', `${label} is now being reviewed.`)];

    case 'provider.changes_requested':
      return [
        providerDraft('changes requested', `A reviewer asked for changes on ${label}.${reason}`),
      ];

    case 'provider.approved':
      return [providerDraft('approved', `${label} was approved and is ready to publish.`)];

    case 'provider.rejected':
      return [providerDraft('rejected', `${label} was rejected.${reason}`)];

    case 'provider.suspended':
      return [providerDraft('suspended', `${label} was suspended.${reason}`)];

    case 'provider.reinstated':
      return [providerDraft('reinstated', `${label} was reinstated.${reason}`)];

    case 'provider.terminated':
      return [providerDraft('terminated', `${label} was terminated.${reason}`)];

    case 'document.verified':
      return [providerDraft('document verified', `A document for ${label} was verified.`)];

    case 'document.expiring':
    case 'document.expired': {
      const subject =
        typeof event.payload.documentTypeCode === 'string'
          ? event.payload.documentTypeCode
          : event.payload.subjectType === 'licence'
            ? 'Licence'
            : 'Document';
      const daysLeft = typeof event.payload.daysLeft === 'number' ? event.payload.daysLeft : null;
      const expiring = type === 'document.expiring';
      return [
        providerDraft(
          expiring ? `${subject} expiring` : `${subject} expired`,
          expiring
            ? `${label} has a ${subject} expiring in ${daysLeft ?? 'a few'} day(s). Upload a renewal to keep the profile compliant.`
            : `${label} has an expired ${subject}. The provider is flagged until a valid document is uploaded.`,
          'owner',
        ),
        {
          ...providerDraft(
            expiring ? `${subject} expiring` : `${subject} expired`,
            expiring
              ? `${label} has a ${subject} expiring in ${daysLeft ?? 'a few'} day(s).`
              : `${label} has an expired ${subject} and is flagged.`,
            'admins',
          ),
          ownerUserId: null,
        },
      ];
    }

    case 'consent.revoked':
      return [
        {
          audience: 'admins',
          title: `${code}: consent revoked`,
          body: `A consent was revoked for ${label}. Review publication permissions.`,
          entityType: 'provider_organization',
          entityId: organizationId,
        },
      ];

    case 'doctor.linked_to_clinic':
      return [providerDraft('doctor linked', `A doctor profile was linked to ${label}.`)];

    default:
      return [];
  }
}

function organizationIdOf(event: OutboxEventRecord): string | null {
  for (const key of ['organizationId', 'ownerId', 'providerId']) {
    const value = event.payload[key];
    if (typeof value === 'string') return value;
  }
  return event.aggregateType === 'provider_organization' ? event.aggregateId : null;
}
