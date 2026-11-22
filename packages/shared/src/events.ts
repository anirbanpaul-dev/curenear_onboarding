import { z } from 'zod';
import { providerStatuses, providerTypes } from './enums';
import { organizationStatuses } from './provider-lifecycle';
import { AppError } from './errors';

/**
 * The domain event catalogue (docs/events.md).
 *
 * Every event is versioned, carries a Zod schema and is written to
 * `outbox_events` in the same transaction as the change that produced it. The
 * worker publishes each row to the internal handlers exactly once per handler
 * (see `processed_event_handlers`).
 *
 * Payloads carry identifiers, status and structural metadata only — never names,
 * phone numbers, emails or document contents (minimum-data rule). Handlers that
 * need contact details look them up server-side.
 */

const isoDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');

/** Provider lifecycle events (organization model). */
export const providerLifecyclePayloadSchema = z.object({
  organizationId: z.string().uuid(),
  providerType: z.enum(providerTypes),
  status: z.enum(organizationStatuses),
  recordVersion: z.number().int().positive(),
  actorUserId: z.string().uuid().nullable(),
  reason: z.string().max(1000).optional(),
  changedFieldKeys: z.array(z.string()).optional(),
});

/** Staff events carry identifiers and structure only — no name, email or mobile. */
export const staffEventPayloadSchema = z.object({
  staffUserId: z.string().uuid(),
  role: z.string().min(1),
  actorUserId: z.string().uuid().nullable(),
  active: z.boolean().optional(),
  deleted: z.boolean().optional(),
  changedFieldKeys: z.array(z.string()).optional(),
});

export const userEventPayloadSchema = z.object({
  userId: z.string().uuid(),
  role: z.string().min(1),
  actorUserId: z.string().uuid().nullable(),
});

/** Consent events carry identifiers and structure, never names or signed text. */
export const consentEventPayloadSchema = z.object({
  providerId: z.string().uuid(),
  consentId: z.string().uuid(),
  consentType: z.string().min(1),
  method: z.string().min(1),
  actorUserId: z.string().uuid().nullable(),
  publicationPermissionOff: z.boolean().optional(),
});

export const documentEventPayloadSchema = z
  .object({
    documentId: z.string().uuid(),
    ownerType: z.enum(['provider', 'provider_organization']),
    ownerId: z.string().uuid(),
    documentTypeCode: z.string().min(1),
    expiresOn: isoDateString.nullable().optional(),
    actorUserId: z.string().uuid().nullable().optional(),
  })
  .passthrough();

export const documentExpiryPayloadSchema = z
  .object({
    subjectType: z.enum(['document', 'licence']),
    subjectId: z.string().uuid(),
    organizationId: z.string().uuid(),
    documentTypeCode: z.string().min(1).optional(),
    expiresOn: isoDateString,
    daysLeft: z.number().int(),
  })
  .passthrough();

export const doctorLinkPayloadSchema = z.object({
  organizationId: z.string().uuid(),
  doctorProfileId: z.string().uuid(),
  clinicLinkId: z.string().uuid(),
  actorUserId: z.string().uuid().nullable(),
});

/** Older shapes kept so already-emitted rows stay readable. */
const permissiveSchema = z.object({}).passthrough();

export interface EventDefinition {
  version: number;
  schema: z.ZodTypeAny;
  description: string;
}

export const eventCatalogue = {
  'staff.created': {
    version: 1,
    schema: staffEventPayloadSchema,
    description: 'A staff account was created by an administrator.',
  },
  'staff.deactivated': {
    version: 1,
    schema: staffEventPayloadSchema,
    description: 'A staff account was deactivated; its sessions are revoked.',
  },
  'provider.created': {
    version: 1,
    schema: providerLifecyclePayloadSchema,
    description: 'A draft provider application was created.',
  },
  'provider.updated': {
    version: 1,
    schema: providerLifecyclePayloadSchema,
    description: 'A section of a provider application changed.',
  },
  'provider.submitted': {
    version: 1,
    schema: providerLifecyclePayloadSchema,
    description: 'The provider application was submitted for review.',
  },
  'provider.review_started': {
    version: 1,
    schema: providerLifecyclePayloadSchema,
    description: 'An administrator opened the application for review.',
  },
  'provider.changes_requested': {
    version: 1,
    schema: providerLifecyclePayloadSchema,
    description: 'The reviewer asked the onboarding staff for changes.',
  },
  'provider.approved': {
    version: 1,
    schema: providerLifecyclePayloadSchema,
    description: 'The provider application was approved.',
  },
  'provider.rejected': {
    version: 1,
    schema: providerLifecyclePayloadSchema,
    description: 'The provider application was rejected.',
  },
  'provider.suspended': {
    version: 1,
    schema: providerLifecyclePayloadSchema,
    description: 'An approved provider was suspended, in whole or in scope.',
  },
  'provider.reinstated': {
    version: 1,
    schema: providerLifecyclePayloadSchema,
    description: 'A suspended provider was reinstated.',
  },
  'provider.terminated': {
    version: 1,
    schema: providerLifecyclePayloadSchema,
    description: 'The provider relationship was terminated.',
  },
  'document.uploaded': {
    version: 1,
    schema: documentEventPayloadSchema,
    description: 'A document upload was confirmed and hashed.',
  },
  'document.verified': {
    version: 1,
    schema: documentEventPayloadSchema,
    description: 'An administrator verified a document.',
  },
  'document.expiring': {
    version: 1,
    schema: documentExpiryPayloadSchema,
    description: 'A document or licence reached a configured reminder day.',
  },
  'document.expired': {
    version: 1,
    schema: documentExpiryPayloadSchema,
    description: 'A document or licence passed its expiry date.',
  },
  'consent.captured': {
    version: 1,
    schema: consentEventPayloadSchema,
    description: 'A consent or agreement was captured.',
  },
  'consent.revoked': {
    version: 1,
    schema: consentEventPayloadSchema,
    description: 'A consent was revoked by the provider contact.',
  },
  'doctor.linked_to_clinic': {
    version: 1,
    schema: doctorLinkPayloadSchema,
    description: 'A doctor profile was linked to a clinic.',
  },

  // --- Deprecated names still written by older code paths -------------------
  'provider.under_review': {
    version: 1,
    schema: permissiveSchema,
    description: 'Deprecated alias of provider.review_started.',
  },
  'provider.review.approved': {
    version: 1,
    schema: permissiveSchema,
    description: 'Deprecated alias of provider.approved.',
  },
  'provider.review.changes_requested': {
    version: 1,
    schema: permissiveSchema,
    description: 'Deprecated alias of provider.changes_requested.',
  },
  'provider.review.rejected': {
    version: 1,
    schema: permissiveSchema,
    description: 'Deprecated alias of provider.rejected.',
  },
  'provider.consent.captured': {
    version: 1,
    schema: consentEventPayloadSchema,
    description: 'Deprecated alias of consent.captured.',
  },
  'provider.consent.revoked': {
    version: 1,
    schema: consentEventPayloadSchema,
    description: 'Deprecated alias of consent.revoked.',
  },
  'provider.licence.expiring': {
    version: 1,
    schema: permissiveSchema,
    description: 'Deprecated alias of document.expiring.',
  },
  'provider.verification.updated': {
    version: 1,
    schema: z
      .object({
        providerId: z.string().uuid(),
        item: z.string().min(1),
        status: z.string().min(1),
        actorUserId: z.string().uuid().nullable(),
      })
      .passthrough(),
    description: 'One review checklist item changed state.',
  },
  'provider.deleted': {
    version: 1,
    schema: permissiveSchema,
    description: 'A draft provider was deleted.',
  },
  'staff.updated': {
    version: 1,
    schema: staffEventPayloadSchema,
    description: 'A staff account was edited.',
  },
  'user.created': {
    version: 1,
    schema: userEventPayloadSchema,
    description: 'A portal user was created.',
  },
} as const satisfies Record<string, EventDefinition>;

export type OutboxEventType = keyof typeof eventCatalogue;

export const outboxEventTypes = Object.keys(eventCatalogue) as OutboxEventType[];

export const outboxEventVersions = Object.fromEntries(
  outboxEventTypes.map((type) => [type, eventCatalogue[type].version]),
) as Record<OutboxEventType, number>;

/** Event names retired in favour of the catalogue names above. */
export const eventAliases: Readonly<Record<string, OutboxEventType>> = {
  'provider.under_review': 'provider.review_started',
  'provider.review.approved': 'provider.approved',
  'provider.review.changes_requested': 'provider.changes_requested',
  'provider.review.rejected': 'provider.rejected',
  'provider.consent.captured': 'consent.captured',
  'provider.consent.revoked': 'consent.revoked',
  'provider.licence.expiring': 'document.expiring',
};

/** The catalogue name for a stored event type (unknown names are returned as-is). */
export function canonicalEventType(type: string): string {
  return eventAliases[type] ?? type;
}

export function eventDefinitionFor(type: string): EventDefinition | null {
  const canonical = canonicalEventType(type);
  return (eventCatalogue as Record<string, EventDefinition>)[canonical] ?? null;
}

/** Validates a payload against the catalogue; returns the Zod result. */
export function validateEventPayload(
  type: string,
  payload: Record<string, unknown>,
): z.SafeParseReturnType<unknown, unknown> {
  const definition = eventDefinitionFor(type);
  if (!definition) {
    return {
      success: false,
      error: new z.ZodError([
        { code: z.ZodIssueCode.custom, path: [], message: `Unknown event type ${type}` },
      ]),
    };
  }
  return definition.schema.safeParse(payload);
}

/** Wire format consumed by the aggregator (`version` allows additive changes). */
export interface DomainEventEnvelope {
  id: string;
  type: string;
  version: number;
  aggregate: { type: string; id: string };
  occurredAt: string;
  payload: Record<string, unknown>;
}

export function toEnvelope(event: {
  id: string;
  eventType: string;
  eventVersion: number;
  aggregateType: string;
  aggregateId: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
}): DomainEventEnvelope {
  return {
    id: event.id,
    type: event.eventType,
    version: event.eventVersion,
    aggregate: { type: event.aggregateType, id: event.aggregateId },
    occurredAt: event.occurredAt.toISOString(),
    payload: event.payload,
  };
}

/* --- Payloads kept for the legacy flat `providers` model ------------------ */

export const providerEventPayloadSchema = z.object({
  providerId: z.string().uuid(),
  providerType: z.enum(providerTypes),
  status: z.enum(providerStatuses),
  recordVersion: z.number().int().positive(),
  actorUserId: z.string().uuid().nullable(),
  changedFieldKeys: z.array(z.string()).optional(),
  reason: z.string().max(1000).optional(),
});

export type ProviderEventPayload = z.infer<typeof providerEventPayloadSchema>;

export const providerVerificationPayloadSchema = z.object({
  providerId: z.string().uuid(),
  item: z.string().min(1),
  status: z.string().min(1),
  actorUserId: z.string().uuid().nullable(),
});

/** Rejects an event payload that would leak personal data by accident. */
export function assertEventPayloadIsSafe(payload: Record<string, unknown>): void {
  const forbidden = ['name', 'fullName', 'legalName', 'email', 'mobile', 'phone', 'document'];
  const leaked = Object.keys(payload).filter((key) => forbidden.includes(key));
  if (leaked.length > 0) {
    throw new AppError('INTERNAL_ERROR', 'Outbox payload must not contain personal data', {
      leaked,
    });
  }
}
