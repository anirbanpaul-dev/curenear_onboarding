import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import {
  allowedTransitionsFor,
  assertOrganizationTransition,
  canTransitionOrganization,
  findOrganizationTransition,
  organizationStatuses,
  organizationTransitions,
  type OrganizationStatus,
} from './provider-lifecycle';

const owner = { userId: '11111111-1111-4111-8111-111111111111', role: 'STAFF' as const };
const otherStaff = { userId: '22222222-2222-4222-8222-222222222222', role: 'STAFF' as const };
const admin = { userId: '33333333-3333-4333-8333-333333333333', role: 'ADMIN' as const };

const validPairs: Array<[OrganizationStatus, OrganizationStatus]> = organizationTransitions.map(
  (rule) => [rule.from, rule.to],
);

function refused(fn: () => unknown, code: string): AppError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return error as AppError;
  }
  throw new Error(`Expected AppError ${code}`);
}

describe('provider lifecycle', () => {
  it('allows exactly the transitions in the table', () => {
    for (const from of organizationStatuses) {
      for (const to of organizationStatuses) {
        const expected = validPairs.some(([a, b]) => a === from && b === to);
        expect(canTransitionOrganization(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it('lists only the next statuses of the current one', () => {
    expect(allowedTransitionsFor('DRAFT')).toEqual(['SUBMITTED']);
    expect(allowedTransitionsFor('UNDER_REVIEW').sort()).toEqual(
      ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'].sort(),
    );
    expect(allowedTransitionsFor('SUSPENDED').sort()).toEqual(['APPROVED', 'TERMINATED'].sort());
    expect(allowedTransitionsFor('TERMINATED')).toEqual([]);
  });

  it('accepts every valid transition for its permitted actor', () => {
    for (const rule of organizationTransitions) {
      const actors = [
        ...(rule.actors.includes('owner') ? [owner] : []),
        ...(rule.actors.includes('admin') ? [admin] : []),
      ];
      for (const actor of actors) {
        expect(
          assertOrganizationTransition({
            from: rule.from,
            to: rule.to,
            actor,
            ownerUserId: owner.userId,
            reason: rule.requiresReason ? 'because' : undefined,
            validationPassed: rule.requiresValidation ? true : undefined,
          }).event,
        ).toBe(rule.event);
      }
    }
  });

  it('rejects a transition that is not in the table with INVALID_TRANSITION', () => {
    const error = refused(
      () =>
        assertOrganizationTransition({
          from: 'DRAFT',
          to: 'APPROVED',
          actor: admin,
          ownerUserId: owner.userId,
        }),
      'INVALID_TRANSITION',
    );
    expect(error.details).toMatchObject({ from: 'DRAFT', to: 'APPROVED', allowed: ['SUBMITTED'] });

    refused(
      () =>
        assertOrganizationTransition({
          from: 'TERMINATED',
          to: 'APPROVED',
          actor: admin,
          ownerUserId: owner.userId,
        }),
      'INVALID_TRANSITION',
    );
  });

  it('keeps review transitions to administrators', () => {
    for (const [from, to] of [
      ['SUBMITTED', 'UNDER_REVIEW'],
      ['UNDER_REVIEW', 'APPROVED'],
      ['UNDER_REVIEW', 'REJECTED'],
      ['UNDER_REVIEW', 'CHANGES_REQUESTED'],
      ['APPROVED', 'SUSPENDED'],
      ['SUSPENDED', 'TERMINATED'],
    ] as Array<[OrganizationStatus, OrganizationStatus]>) {
      refused(
        () => assertOrganizationTransition({ from, to, actor: owner, ownerUserId: owner.userId }),
        'FORBIDDEN',
      );
    }
  });

  it('lets the owning staff member (and only them) submit', () => {
    expect(
      assertOrganizationTransition({
        from: 'CHANGES_REQUESTED',
        to: 'SUBMITTED',
        actor: owner,
        ownerUserId: owner.userId,
        validationPassed: true,
      }).event,
    ).toBe('provider.submitted');

    refused(
      () =>
        assertOrganizationTransition({
          from: 'DRAFT',
          to: 'SUBMITTED',
          actor: otherStaff,
          ownerUserId: owner.userId,
          validationPassed: true,
        }),
      'FORBIDDEN',
    );
  });

  it('requires a full validation pass before SUBMITTED', () => {
    refused(
      () =>
        assertOrganizationTransition({
          from: 'DRAFT',
          to: 'SUBMITTED',
          actor: owner,
          ownerUserId: owner.userId,
          validationPassed: false,
        }),
      'VALIDATION_ERROR',
    );
  });

  it('requires a reason to suspend, reject or request changes', () => {
    for (const [from, to] of [
      ['APPROVED', 'SUSPENDED'],
      ['UNDER_REVIEW', 'REJECTED'],
      ['UNDER_REVIEW', 'CHANGES_REQUESTED'],
      ['SUSPENDED', 'TERMINATED'],
    ] as Array<[OrganizationStatus, OrganizationStatus]>) {
      refused(
        () => assertOrganizationTransition({ from, to, actor: admin, ownerUserId: owner.userId }),
        'VALIDATION_ERROR',
      );
      expect(
        findOrganizationTransition(from, to)?.requiresReason,
        `${from} -> ${to} requires a reason`,
      ).toBe(true);
    }
  });
});
