import { describe, expect, it } from 'vitest';
import { allFieldsFor, sectionsFor } from './field-registry';
import type { ProviderType } from './enums';
import { AppError } from './errors';
import {
  buildProviderDataSchema,
  collectExpiringLicences,
  collectProviderDataIssues,
  deriveProviderColumns,
  validateProviderData,
} from './provider-data';
import { providerTypes } from './enums';
import { rupeesToPaise, paiseToRupees, pinCodeSchema, kolkataDayStartUtc } from './utils';

const baseDoctor = {
  reg_addr_line1: '12 Park Street',
  reg_city: 'Kolkata',
  reg_district: 'Kolkata',
  reg_state: 'West Bengal',
  reg_pin: '700016',
  locations: [
    {
      loc_name: 'Park Street Clinic',
      loc_type: 'clinic',
      loc_address: {
        line1: '12 Park Street',
        city: 'Kolkata',
        state: 'West Bengal',
        pin: '700016',
      },
      loc_pin: '700016',
      loc_geo: { lat: 22.5535, lng: 88.3521 },
      loc_hours: [{ day: 'Monday', open: '09:00', close: '13:00', closed: false }],
      loc_booking_phone: '9830012345',
      loc_public: true,
    },
  ],
  profile_display_name: 'Dr A. Sen',
  profile_description: 'General physician with 12 years of practice.',
  consent_publish_photo: true,
  public_fields: ['profile_display_name'],
};

describe('field registry', () => {
  it('gives every provider type the common sections plus its own', () => {
    for (const type of providerTypes) {
      const sections = sectionsFor(type);
      expect(sections.map((section) => section.key)).toContain('legal_entity');
      expect(sections.length).toBeGreaterThan(5);
    }
  });

  it('keeps field keys unique within a provider type', () => {
    for (const type of providerTypes) {
      const keys = allFieldsFor(type).map((field) => field.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('does not collect prohibited identifiers', () => {
    const forbidden = ['aadhaar', 'pan', 'gstin', 'date_of_birth', 'dob', 'gender', 'bank_acc_no'];
    for (const type of providerTypes) {
      for (const key of allFieldsFor(type).map((field) => field.key)) {
        const collectsForbidden = forbidden.some((token) =>
          new RegExp(`(^|_)${token}(_|$)`).test(key),
        );
        expect(collectsForbidden).toBe(false);
      }
    }
  });
});

describe('provider data validation', () => {
  it('accepts partial data for a draft', () => {
    const data = validateProviderData('doctor', 'draft', { profile_display_name: 'Dr A. Sen' });
    expect(data.profile_display_name).toBe('Dr A. Sen');
  });

  it('rejects invented fields', () => {
    expect(() => validateProviderData('doctor', 'draft', { not_a_spec_field: 'x' })).toThrowError(
      AppError,
    );
  });

  it('requires the mandatory fields on submit', () => {
    const result = buildProviderDataSchema('doctor', 'submit').safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('reg_pin');
      expect(paths).toContain('doc_reg_no');
      expect(paths).toContain('decl_accuracy');
    }
  });

  it('does not require entity fields for individual doctors', () => {
    const result = buildProviderDataSchema('doctor', 'submit').safeParse({
      ...baseDoctor,
      doc_full_name: 'Dr A. Sen',
      doc_reg_no: 'WB/12345',
      doc_reg_council: 'West Bengal Medical Council',
      doc_reg_date: '2012-06-01',
      doc_reg_doc: {
        fileName: 'registration.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 120_000,
        uploadedAt: '2026-01-10T10:00:00.000Z',
        uploadedBy: '11111111-1111-4111-8111-111111111111',
      },
      doc_system: 'allopathy',
      doc_qualifications: [{ degree: 'MBBS', institution: 'Calcutta Medical College', year: 2011 }],
      practice_locations: [
        {
          prac_type: 'own clinic',
          prac_location: {
            line1: '12 Park Street',
            city: 'Kolkata',
            state: 'West Bengal',
            pin: '700016',
          },
          prac_timings: [{ day: 'Monday', start: '09:00', end: '13:00' }],
          prac_fee: '500',
          prac_contact: '9830012345',
        },
      ],
      appt_confirmer: 'doctor',
      appt_confirm_method: 'call',
      appt_contact: [{ name: 'Front desk', phone: '9830012345' }],
      appt_cancel_policy: 'Call the clinic at least 4 hours ahead.',
      fee_collection: 'doctor',
      doc_complaint_contact: [{ name: 'Clinic manager', phone: '9830012345' }],
      doc_restriction_flag: false,
      decl_doc_ethics: true,
      contact_booking: [{ name: 'Front desk', phone: '9830012345' }],
      contact_grievance: [{ name: 'Grievance officer', phone: '9830012345' }],
      contact_security: [{ name: 'IT contact', phone: '9830012345' }],
      notice_address: {
        line1: '12 Park Street',
        city: 'Kolkata',
        state: 'West Bengal',
        pin: '700016',
      },
      notice_email: 'clinic@example.com',
      sig_name: 'A. Sen',
      sig_designation: 'Proprietor',
      sig_mobile: '9830012345',
      sig_email: 'clinic@example.com',
      decl_accuracy: true,
      decl_authority: true,
      decl_licences: true,
      decl_notify_changes: true,
      decl_verification: true,
      decl_no_referral_incentive: true,
      decl_no_misleading_claims: true,
      decl_privacy_ack: true,
    });

    const issues = result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
    expect(issues.filter((path) => path === 'legal_name')).toHaveLength(0);
    expect(issues.filter((path) => path === 'constitution_type')).toHaveLength(0);
  });

  it('never persists undefined leaves (invalid in a JSON column)', () => {
    const data = validateProviderData('doctor', 'draft', {
      profile_display_name: 'Dr A. Sen',
      legal_name: '',
      website: null,
      contact_booking: [],
    });

    expect(Object.keys(data)).not.toContain('legal_name');
    expect(Object.keys(data)).not.toContain('website');
    expect(() => JSON.parse(JSON.stringify(data))).not.toThrow();
  });

  it('normalises money to integer paise', () => {
    const data = validateProviderData('care_provider', 'draft', {
      cp_service_categories: [{ cp_price: '1,250.50' }],
    });
    const categories = data.cp_service_categories as Array<{ cp_price: number }>;
    expect(categories[0]?.cp_price).toBe(125050);
  });

  it('rejects sex-determination tests in a diagnostic catalogue', () => {
    expect(() =>
      validateProviderData('diagnostic_centre', 'draft', {
        dc_tests: [{ test_name: 'Prenatal sex determination panel', test_price: '100' }],
      }),
    ).toThrowError(/invalid/i);
  });

  it('revalidates stored paise without converting again', () => {
    const stored = validateProviderData('care_provider', 'draft', {
      cp_service_categories: [{ cp_price: '1,250.50' }],
    });
    const read = (input: typeof stored, options?: { moneyFormat: 'paise' | 'rupees' }) =>
      (
        (options ? validateProviderData('care_provider', 'draft', input, options) : input)
          .cp_service_categories as Array<{ cp_price: number }>
      )[0]?.cp_price;

    expect(read(stored)).toBe(125050);
    expect(read(stored, { moneyFormat: 'paise' })).toBe(125050);

    // Guessing rupees here is the regression that turned ₹500 into ₹50,000.
    expect(read(stored, { moneyFormat: 'rupees' })).toBe(12505000);
  });

  it('requires restriction details when a restriction is disclosed', () => {
    const issues = collectProviderDataIssues('doctor', 'submit', {
      ...baseDoctor,
      doc_restriction_flag: true,
    });
    expect(issues.map((issue) => issue.path)).toContain('doc_restriction_details');
  });
});

describe('derived columns and utilities', () => {
  it('derives coverage PIN codes from registered office, locations and service area', () => {
    const derived = deriveProviderColumns({
      reg_pin: '700016',
      locations: [{ loc_pin: '700020' }],
      ph_delivery_pins: ['700016', '700091'],
    });
    expect(derived.primaryPinCode).toBe('700016');
    expect(derived.displayName).toBeNull();
    expect(derived.pins.map((pin) => pin.pinCode).sort()).toEqual(['700016', '700020', '700091']);
    expect(derived.pins.find((pin) => pin.pinCode === '700016')?.kind).toBe('registered_office');
  });

  it('converts rupees to paise and back without floating point drift', () => {
    expect(rupeesToPaise('199.99')).toBe(19999);
    expect(rupeesToPaise('0.1')).toBe(10);
    expect(rupeesToPaise('1,000')).toBe(100000);
    expect(rupeesToPaise('12.345')).toBeNull();
    expect(paiseToRupees(19999)).toBe('199.99');
    expect(paiseToRupees(50000)).toBe('500');
  });

  it('rejects PIN codes that are numbers or have a leading zero', () => {
    expect(pinCodeSchema.safeParse('700001').success).toBe(true);
    expect(pinCodeSchema.safeParse('070001').success).toBe(false);
    expect(pinCodeSchema.safeParse(700001).success).toBe(false);
  });

  it('interprets a Kolkata day boundary as UTC', () => {
    expect(kolkataDayStartUtc('2026-01-15').toISOString()).toBe('2026-01-14T18:30:00.000Z');
  });

  it('finds expiring licences in nested repeaters', () => {
    const expiring = collectExpiringLicences(
      {
        ph_licences: [{ valid_to: '2026-02-01' }, { valid_to: '2030-01-01' }],
        ins_to: '2025-12-01',
      },
      new Date('2026-01-01T00:00:00.000Z'),
      60,
    );
    expect(expiring.map((entry) => entry.fieldKey)).toContain('ph_licences[0].valid_to');
    expect(expiring.map((entry) => entry.fieldKey)).toContain('ins_to');
    expect(expiring.find((entry) => entry.fieldKey === 'ins_to')?.daysLeft).toBeLessThan(0);
  });
});

describe('provider type coverage', () => {
  it('validates a draft for every provider type without throwing', () => {
    for (const type of providerTypes as readonly ProviderType[]) {
      expect(() => validateProviderData(type, 'draft', {})).not.toThrow();
    }
  });
});
