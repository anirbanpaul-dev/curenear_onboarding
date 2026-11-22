import { describe, expect, it } from 'vitest';
import { providerTypes } from './enums';
import {
  defaultReviewSla,
  doctorVerificationItems,
  requiredVerificationItemsFor,
  reviewCommentSchema,
  reviewDecisionSchema,
  reviewQueueQuerySchema,
  reviewSettingsSchema,
  reviewSlaState,
  verificationItemCatalogue,
  verificationItemsForSection,
} from './review';

const id = '11111111-1111-4111-8111-111111111111';

describe('review verification catalogue', () => {
  it('builds a non-empty, unique checklist for every provider type', () => {
    expect(verificationItemCatalogue.length).toBeGreaterThan(5);
    for (const providerType of providerTypes) {
      const items = requiredVerificationItemsFor(providerType);
      expect(items.length, providerType).toBeGreaterThan(0);
      expect(new Set(items.map((item) => item.code)).size).toBe(items.length);
      for (const item of items) {
        expect(item.label).toBeTruthy();
        expect(item.sectionKey).toBeTruthy();
        expect(typeof item.required).toBe('boolean');
      }
    }
    expect(requiredVerificationItemsFor('doctor').map((item) => item.code)).toEqual(
      expect.arrayContaining(['registration', 'qualification']),
    );
  });

  it('gives linked doctors their own registration and qualification checks', () => {
    expect(doctorVerificationItems()).toEqual([
      {
        code: 'registration',
        label: 'Medical registration',
        sectionKey: 'doctor_identity',
        required: true,
      },
      {
        code: 'qualification',
        label: 'Qualification',
        sectionKey: 'doctor_qualifications',
        required: true,
      },
    ]);
  });

  it('maps an edited section to the checks it invalidates', () => {
    expect(verificationItemsForSection('licences')).toContain('drug_licence');
    expect(verificationItemsForSection('insurance')).toEqual(['insurance']);
    expect(verificationItemsForSection('locations')).toEqual(['address']);
    expect(verificationItemsForSection('doctor_qualifications')).toEqual(['qualification']);
    expect(verificationItemsForSection('signatory')).toEqual(['signatory_authority']);
    expect(verificationItemsForSection('not_a_section')).toEqual([]);
  });

  it('reports SLA state at the warning and breach boundaries', () => {
    const now = new Date('2026-11-22T12:00:00.000Z');
    const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

    expect(reviewSlaState(null, now, defaultReviewSla)).toBe('ok');
    expect(reviewSlaState(hoursAgo(47), now, defaultReviewSla)).toBe('ok');
    expect(reviewSlaState(hoursAgo(48), now, defaultReviewSla)).toBe('warning');
    expect(reviewSlaState(hoursAgo(71), now, defaultReviewSla)).toBe('warning');
    expect(reviewSlaState(hoursAgo(72), now, defaultReviewSla)).toBe('breached');
  });

  it('validates every review decision variant', () => {
    expect(reviewDecisionSchema.safeParse({ decision: 'approve' }).success).toBe(true);
    expect(
      reviewDecisionSchema.safeParse({
        decision: 'request_changes',
        comment: 'The licence scan is unreadable',
        sections: ['licences'],
      }).success,
    ).toBe(true);
    expect(
      reviewDecisionSchema.safeParse({
        decision: 'request_changes',
        comment: 'short',
        sections: [],
      }).success,
    ).toBe(false);
    expect(
      reviewDecisionSchema.safeParse({ decision: 'reject', reason: 'Expired registration' })
        .success,
    ).toBe(true);
    expect(reviewDecisionSchema.safeParse({ decision: 'reject', reason: 'no' }).success).toBe(
      false,
    );
    expect(
      reviewDecisionSchema.safeParse({
        decision: 'suspend',
        reason: 'Patient safety concern',
        scope: 'LOCATION',
        scope_ref_id: id,
      }).success,
    ).toBe(true);
    expect(
      reviewDecisionSchema.safeParse({
        decision: 'suspend',
        reason: 'Patient safety concern',
        scope: 'EVERYTHING',
      }).success,
    ).toBe(false);
    expect(
      reviewDecisionSchema.safeParse({
        decision: 'reinstate',
        reason: 'Resolved by the operator',
        scope: 'WHOLE_PROFILE',
      }).success,
    ).toBe(true);
    expect(reviewDecisionSchema.safeParse({ decision: 'archive' }).success).toBe(false);
  });

  it('validates comments, queue filters and SLA settings', () => {
    expect(
      reviewCommentSchema.safeParse({ section_key: 'licences', body: 'Please re-upload' }).success,
    ).toBe(true);
    expect(reviewCommentSchema.safeParse({ section_key: 'licences', body: 'x' }).success).toBe(
      false,
    );
    expect(reviewQueueQuerySchema.parse({}).page).toBe(1);
    expect(reviewQueueQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
    expect(reviewSettingsSchema.safeParse({ warn_hours: 24, breach_hours: 48 }).success).toBe(true);
    expect(reviewSettingsSchema.safeParse({ warn_hours: 48, breach_hours: 24 }).success).toBe(
      false,
    );
    expect(reviewSettingsSchema.safeParse({ warnHours: 24, breachHours: 48 }).success).toBe(false);
  });
});
