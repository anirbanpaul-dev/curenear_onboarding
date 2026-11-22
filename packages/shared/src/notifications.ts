import { z } from 'zod';

/**
 * In-app notification types, per-user preferences and the email templates that
 * the worker uses when an event asks for an email.
 *
 * Types double as preference keys, so a user can mute one kind of event without
 * muting the rest. Unknown types default to "in-app and email on".
 */

export const notificationAudiences = ['admins', 'owner'] as const;
export type NotificationAudience = (typeof notificationAudiences)[number];

export interface NotificationPreferenceOption {
  type: string;
  label: string;
  description: string;
  defaultInApp: boolean;
  defaultEmail: boolean;
}

export const notificationPreferenceCatalogue: readonly NotificationPreferenceOption[] = [
  {
    type: 'staff.created',
    label: 'Staff accounts',
    description: 'A new onboarding staff account was created.',
    defaultInApp: true,
    defaultEmail: false,
  },
  {
    type: 'provider.stale_draft',
    label: 'Draft reminders',
    description: 'An application has been left in draft for a week.',
    defaultInApp: true,
    defaultEmail: true,
  },
  {
    type: 'provider.submitted',
    label: 'New submissions',
    description: 'A provider application was submitted for review.',
    defaultInApp: true,
    defaultEmail: true,
  },
  {
    type: 'provider.changes_requested',
    label: 'Changes requested',
    description: 'A reviewer asked for changes on one of your applications.',
    defaultInApp: true,
    defaultEmail: true,
  },
  {
    type: 'provider.approved',
    label: 'Approvals',
    description: 'A provider application was approved.',
    defaultInApp: true,
    defaultEmail: true,
  },
  {
    type: 'provider.rejected',
    label: 'Rejections',
    description: 'A provider application was rejected.',
    defaultInApp: true,
    defaultEmail: true,
  },
  {
    type: 'provider.suspended',
    label: 'Suspensions',
    description: 'A provider was suspended, in whole or in scope.',
    defaultInApp: true,
    defaultEmail: true,
  },
  {
    type: 'provider.reinstated',
    label: 'Reinstatements',
    description: 'A suspended provider was reinstated.',
    defaultInApp: true,
    defaultEmail: true,
  },
  {
    type: 'provider.terminated',
    label: 'Terminations',
    description: 'A provider relationship was terminated.',
    defaultInApp: true,
    defaultEmail: true,
  },
  {
    type: 'document.verified',
    label: 'Document verification',
    description: 'A document was verified by an administrator.',
    defaultInApp: true,
    defaultEmail: false,
  },
  {
    type: 'document.expiring',
    label: 'Document reminders',
    description: 'A document or licence is approaching its expiry date.',
    defaultInApp: true,
    defaultEmail: true,
  },
  {
    type: 'document.expired',
    label: 'Expired documents',
    description: 'A document or licence has expired and needs replacing.',
    defaultInApp: true,
    defaultEmail: true,
  },
  {
    type: 'consent.revoked',
    label: 'Consent revocations',
    description: 'A provider withdrew a consent.',
    defaultInApp: true,
    defaultEmail: true,
  },
  {
    type: 'doctor.linked_to_clinic',
    label: 'Doctor links',
    description: 'A doctor profile was linked to a clinic.',
    defaultInApp: true,
    defaultEmail: false,
  },
  {
    type: 'export.ready',
    label: 'Exports',
    description: 'A CSV export you requested is ready to download.',
    defaultInApp: true,
    // The file is in the portal; an email copy would only add a stale link.
    defaultEmail: false,
  },
];

export const notificationTypes = notificationPreferenceCatalogue.map((entry) => entry.type);

export function preferenceOption(type: string): NotificationPreferenceOption {
  return (
    notificationPreferenceCatalogue.find((entry) => entry.type === type) ?? {
      type,
      label: type,
      description: '',
      defaultInApp: true,
      defaultEmail: true,
    }
  );
}

export function isNotifiableEvent(type: string): boolean {
  return notificationTypes.includes(type);
}

/** Attention-grabbing suffixes so a review queue never silently waits. */
const EMAIL_SUBJECT_PREFIX: Record<string, string> = {
  'provider.changes_requested': 'Changes requested',
  'provider.approved': 'Approved',
  'provider.rejected': 'Rejected',
  'provider.suspended': 'Suspended',
  'provider.reinstated': 'Reinstated',
  'provider.terminated': 'Terminated',
  'document.expired': 'Document expired',
  'document.expiring': 'Document expiring',
  'provider.submitted': 'New application submitted',
};

export function emailSubjectFor(type: string, title: string): string {
  const prefix = EMAIL_SUBJECT_PREFIX[type];
  return prefix ? `[CureNear] ${prefix}: ${title}` : `[CureNear] ${title}`;
}

export interface NotificationEmailInput {
  type: string;
  title: string;
  body: string;
  entityType?: string | null;
  entityId?: string | null;
  appUrl: string;
}

export function portalPathFor(
  entityType: string | null | undefined,
  entityId: string | null | undefined,
): string {
  if (entityType === 'provider_organization' && entityId) return `/admin/review/${entityId}`;
  if (entityType === 'export_job') return '/exports';
  return '/notifications';
}

export const notificationsQuerySchema = z
  .object({
    unread: z.enum(['true', 'false']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;

export const markNotificationsReadSchema = z
  .object({ ids: z.array(z.string().uuid()).max(200).optional() })
  .strict();
export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadSchema>;

export const notificationPreferencesSchema = z
  .object({
    preferences: z
      .array(
        z
          .object({
            type: z.string().trim().min(1).max(120),
            in_app: z.boolean(),
            email: z.boolean(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListResult {
  rows: NotificationDto[];
  total: number;
  unread: number;
  page: number;
  pageSize: number;
}

export interface NotificationPreferenceDto {
  type: string;
  label: string;
  description: string;
  inApp: boolean;
  email: boolean;
}

export function renderNotificationEmail(input: NotificationEmailInput): {
  subject: string;
  text: string;
} {
  const base = input.appUrl.replace(/\/$/, '');
  const link =
    input.entityType === 'provider_organization' && input.entityId
      ? `${base}/admin/review/${input.entityId}`
      : input.entityType === 'export_job'
        ? `${base}/exports`
        : `${base}/notifications`;

  return {
    subject: emailSubjectFor(input.type, input.title),
    text: [
      input.title,
      '',
      input.body,
      '',
      `Open CureNear: ${link}`,
      '',
      'You can change which notifications you receive in CureNear → Notifications → Preferences.',
    ].join('\n'),
  };
}
