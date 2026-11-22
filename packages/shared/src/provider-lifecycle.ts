import { z } from 'zod';
import { AppError } from './errors';
import { providerTypes } from './enums';
import type { Actor } from './policy';
import type { OutboxEventType } from './events';

/**
 * Provider organization lifecycle (normalized model).
 *
 * The table is the contract: every transition names the statuses it connects,
 * who may trigger it, and whether it needs a reason or a passing full
 * validation. Services ask this module instead of comparing status strings, so
 * the API, the tests and the docs cannot drift.
 */

export const organizationStatuses = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'SUSPENDED',
  'REJECTED',
  'TERMINATED',
] as const;
export type OrganizationStatus = (typeof organizationStatuses)[number];

/** `owner` covers the staff member who created the application; admins may always act. */
export const organizationTransitionActors = ['owner', 'admin'] as const;
export type OrganizationTransitionActor = (typeof organizationTransitionActors)[number];

export interface OrganizationTransition {
  from: OrganizationStatus;
  to: OrganizationStatus;
  actors: readonly OrganizationTransitionActor[];
  /** Outbox event written with the transition. */
  event: Extract<OutboxEventType, `provider.${string}`>;
  /** A human reason is mandatory (suspension). */
  requiresReason?: boolean;
  /** Submission needs a full validation pass first. */
  requiresValidation?: boolean;
  /** Audit verb (dotted), also used as the action recorded on audit_logs. */
  action: string;
}

export const organizationTransitions: readonly OrganizationTransition[] = [
  {
    from: 'DRAFT',
    to: 'SUBMITTED',
    actors: ['owner', 'admin'],
    event: 'provider.submitted',
    requiresValidation: true,
    action: 'provider.submitted',
  },
  {
    from: 'SUBMITTED',
    to: 'UNDER_REVIEW',
    actors: ['admin'],
    event: 'provider.review_started',
    action: 'provider.under_review',
  },
  {
    from: 'UNDER_REVIEW',
    to: 'APPROVED',
    actors: ['admin'],
    event: 'provider.approved',
    action: 'provider.approved',
  },
  {
    from: 'UNDER_REVIEW',
    to: 'REJECTED',
    actors: ['admin'],
    event: 'provider.rejected',
    requiresReason: true,
    action: 'provider.rejected',
  },
  {
    from: 'UNDER_REVIEW',
    to: 'CHANGES_REQUESTED',
    actors: ['admin'],
    event: 'provider.changes_requested',
    requiresReason: true,
    action: 'provider.changes_requested',
  },
  {
    from: 'CHANGES_REQUESTED',
    to: 'SUBMITTED',
    actors: ['owner', 'admin'],
    event: 'provider.submitted',
    requiresValidation: true,
    action: 'provider.submitted',
  },
  {
    from: 'APPROVED',
    to: 'SUSPENDED',
    actors: ['admin'],
    event: 'provider.suspended',
    requiresReason: true,
    action: 'provider.suspended',
  },
  {
    from: 'SUSPENDED',
    to: 'APPROVED',
    actors: ['admin'],
    event: 'provider.reinstated',
    action: 'provider.reinstated',
  },
  {
    from: 'SUSPENDED',
    to: 'TERMINATED',
    actors: ['admin'],
    event: 'provider.terminated',
    requiresReason: true,
    action: 'provider.terminated',
  },
];

export function findOrganizationTransition(
  from: OrganizationStatus,
  to: OrganizationStatus,
): OrganizationTransition | undefined {
  return organizationTransitions.find((rule) => rule.from === from && rule.to === to);
}

export function canTransitionOrganization(
  from: OrganizationStatus,
  to: OrganizationStatus,
): boolean {
  return findOrganizationTransition(from, to) !== undefined;
}

export function allowedTransitionsFor(from: OrganizationStatus): OrganizationStatus[] {
  return organizationTransitions.filter((rule) => rule.from === from).map((rule) => rule.to);
}

/** Statuses in which the owner may still edit the application. */
export const ownerEditableStatuses: readonly OrganizationStatus[] = ['DRAFT', 'CHANGES_REQUESTED'];

export function isOwnerEditableStatus(status: OrganizationStatus): boolean {
  return ownerEditableStatuses.includes(status);
}

function roleActor(actor: Actor, ownerUserId: string): OrganizationTransitionActor | null {
  if (actor.role === 'ADMIN') return 'admin';
  return actor.userId === ownerUserId ? 'owner' : null;
}

export interface OrganizationTransitionRequest {
  from: OrganizationStatus;
  to: OrganizationStatus;
  actor: Actor;
  ownerUserId: string;
  reason?: string | null;
  /** Set once the caller has run full validation; submission requires it. */
  validationPassed?: boolean;
}

/**
 * Checks a transition against the table, the actor's relationship to the
 * application, the reason requirement and (for submissions) validation.
 * Throws `AppError`; returns the rule on success.
 */
export function assertOrganizationTransition(
  request: OrganizationTransitionRequest,
): OrganizationTransition {
  const { from, to, actor, ownerUserId, reason, validationPassed } = request;
  const rule = findOrganizationTransition(from, to);
  if (!rule) {
    throw new AppError('INVALID_TRANSITION', `A provider cannot move from ${from} to ${to}`, {
      from,
      to,
      allowed: allowedTransitionsFor(from),
    });
  }

  const as = roleActor(actor, ownerUserId);
  if (!as || !rule.actors.includes(as)) {
    throw new AppError(
      'FORBIDDEN',
      as === null
        ? 'Only the staff member who created this application or an administrator can do this'
        : `Only an administrator can move a provider from ${from} to ${to}`,
      { from, to, requiredActors: rule.actors },
    );
  }

  if (rule.requiresReason && !(reason ?? '').trim()) {
    throw new AppError('VALIDATION_ERROR', `A reason is required to move a provider to ${to}`, {
      issues: [{ path: 'reason', message: 'Give a reason for this decision' }],
    });
  }

  if (rule.requiresValidation && validationPassed !== true) {
    throw new AppError(
      'VALIDATION_ERROR',
      'The provider must pass validation before it can be submitted',
    );
  }

  return rule;
}

export const organizationEventPayloadSchema = z.object({
  organizationId: z.string().uuid(),
  providerType: z.enum(providerTypes),
  status: z.enum(organizationStatuses),
  recordVersion: z.number().int().positive(),
  actorUserId: z.string().uuid().nullable(),
  reason: z.string().max(1000).optional(),
  changedFieldKeys: z.array(z.string()).optional(),
});

export type OrganizationEventPayload = z.infer<typeof organizationEventPayloadSchema>;
