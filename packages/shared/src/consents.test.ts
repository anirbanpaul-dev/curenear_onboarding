import { describe, expect, it } from 'vitest';
import { providerTypes } from './enums';
import {
  agreementTemplateDefinitions,
  agreementTemplateFor,
  commonDeclarations,
  consentGaps,
  declarationByKey,
  declarationsFor,
  hasActiveConsent,
  isActiveConsent,
  type ConsentRecordLike,
} from './consents';

const doctorA = '11111111-1111-4111-8111-111111111111';
const doctorB = '22222222-2222-4222-8222-222222222222';

const record = (patch: Partial<ConsentRecordLike>): ConsentRecordLike => ({
  consentType: 'publication',
  revokedAt: null,
  ...patch,
});

describe('consent catalogue', () => {
  it('always includes the common declarations and adds type-specific ones', () => {
    expect(commonDeclarations.length).toBeGreaterThan(3);
    for (const providerType of providerTypes) {
      const declarations = declarationsFor(providerType);
      expect(declarations.length).toBeGreaterThanOrEqual(commonDeclarations.length);
      expect(new Set(declarations.map((entry) => entry.key)).size).toBe(declarations.length);
      for (const declaration of commonDeclarations) {
        expect(declarations).toContainEqual(declaration);
      }
    }
    expect(declarationsFor('clinic').length).toBeGreaterThan(commonDeclarations.length);
    expect(declarationsFor('doctor').length).toBeGreaterThan(commonDeclarations.length);
    expect(declarationsFor('pharmacy').length).toBeGreaterThan(commonDeclarations.length);
  });

  it('finds a declaration by key only within its provider type', () => {
    const key = commonDeclarations[0]!.key;
    expect(declarationByKey('clinic', key)?.key).toBe(key);
    expect(declarationByKey('clinic', 'not-a-declaration')).toBeUndefined();
  });

  it('publishes a template for every type except clinics, which are deferred', () => {
    expect(agreementTemplateDefinitions).toHaveLength(providerTypes.length - 1);
    expect(agreementTemplateFor('clinic')).toBeNull();
    for (const providerType of providerTypes.filter((type) => type !== 'clinic')) {
      const template = agreementTemplateFor(providerType);
      expect(template?.providerType).toBe(providerType);
      expect(template?.body.length).toBeGreaterThan(200);
      expect(template?.version).toBeTruthy();
    }
  });

  it('treats only unrevoked records as active', () => {
    expect(isActiveConsent(record({}))).toBe(true);
    expect(isActiveConsent(record({ revokedAt: new Date() }))).toBe(false);
    expect(isActiveConsent(record({ revokedAt: '2026-01-01' }))).toBe(false);
  });

  it('matches consents by type, declaration key and doctor profile', () => {
    const records = [
      record({}),
      record({
        consentType: 'declarations',
        confirmationMeta: { declarationKey: 'information_accuracy' },
      }),
      record({ consentType: 'doctor_confirmation', doctorProfileId: doctorA }),
    ];

    expect(hasActiveConsent(records, 'publication')).toBe(true);
    expect(
      hasActiveConsent(records, 'declarations', { declarationKey: 'information_accuracy' }),
    ).toBe(true);
    expect(hasActiveConsent(records, 'declarations', { declarationKey: 'other_declaration' })).toBe(
      false,
    );
    expect(hasActiveConsent(records, 'doctor_confirmation', { doctorProfileId: doctorA })).toBe(
      true,
    );
    expect(hasActiveConsent(records, 'doctor_confirmation', { doctorProfileId: doctorB })).toBe(
      false,
    );
    expect(
      hasActiveConsent(
        [record({ consentType: 'publication', revokedAt: new Date() })],
        'publication',
      ),
    ).toBe(false);
  });

  it('lists every blocking gap for an empty consent set', () => {
    const gaps = consentGaps({
      providerType: 'clinic',
      records: [],
      agreementRequired: true,
      clinicDoctorProfileIds: [doctorA],
    });
    expect(gaps.map((gap) => gap.kind)).toEqual(
      expect.arrayContaining([
        'publication',
        'data_privacy_notice',
        'declaration',
        'agreement',
        'doctor_confirmation',
      ]),
    );
    expect(gaps.filter((gap) => gap.kind === 'declaration')).toHaveLength(
      declarationsFor('clinic').length,
    );
  });

  it('returns no gaps when every required consent is active', () => {
    const records: ConsentRecordLike[] = [
      record({ consentType: 'publication' }),
      record({ consentType: 'data_privacy_notice' }),
      record({ consentType: 'agreement' }),
      ...declarationsFor('pharmacy').map((declaration) =>
        record({
          consentType: 'declarations',
          confirmationMeta: { declarationKey: declaration.key },
        }),
      ),
    ];
    expect(
      consentGaps({
        providerType: 'pharmacy',
        records,
        agreementRequired: true,
        clinicDoctorProfileIds: [doctorA],
      }).map((gap) => gap.kind),
    ).toEqual(['doctor_confirmation']);
  });

  it('does not require an agreement when it is deferred', () => {
    const records: ConsentRecordLike[] = [
      record({ consentType: 'publication' }),
      record({ consentType: 'data_privacy_notice' }),
      ...declarationsFor('diagnostic_centre').map((declaration) =>
        record({
          consentType: 'declarations',
          confirmationMeta: { declarationKey: declaration.key },
        }),
      ),
    ];
    expect(
      consentGaps({
        providerType: 'diagnostic_centre',
        records,
        agreementRequired: false,
      }),
    ).toEqual([]);
  });
});
