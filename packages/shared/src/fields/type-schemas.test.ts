import { describe, expect, it } from 'vitest';
import { collectTypeDataIssues, validateTypeData } from './schema';
import { typeDataDefaultsFor } from './registry';
import { assessCompleteness } from '../provider-completeness';
import type { ProviderOrganizationRecord } from '../provider-onboarding';
import type { ProviderType } from '../enums';

/**
 * Fields kept in related rows (licences, service PINs) are not part of the
 * `type_data` schema; the submit gate enforces their "required if" rules through
 * completeness, so those conditions are asserted here.
 */
function missingRequired(providerType: ProviderType, typeData: Record<string, unknown>) {
  const organization = {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'TEST-0001',
    providerType,
    status: 'DRAFT',
    legalName: 'Test provider',
    tradeName: null,
    constitutionType: null,
    registrationNumber: null,
    establishedOn: null,
    website: null,
    email: null,
    mobile: '9876543210',
    primaryPinCode: '700091',
    primaryDistrictId: null,
    primaryStateId: null,
    typeData,
    typeDataSchemaVersion: 1,
    profileData: {},
    publicationConsents: {},
    createdByUserId: '22222222-2222-4222-8222-222222222222',
    submittedAt: null,
    approvedAt: null,
    approvedByUserId: null,
    version: 1,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as ProviderOrganizationRecord;
  return assessCompleteness(providerType, {
    organization,
    locations: [],
    contacts: [],
    licences: [],
    insurance: [],
    servicePins: [],
    documents: [],
  }).missingRequiredFields;
}

/**
 * Schema tests for the type-specific sections (field-spec 5, 7, 8). The
 * conditional "required if" rules must come from the registry, so each test
 * flips the controlling answer and asserts the dependent field becomes required.
 */

const contact = [{ name: 'Asha Roy', phone: '9876543210' }];

const pharmacyPayload: Record<string, unknown> = {
  ph_authorized_person: 'Rakesh Sen',
  ph_sched_flags: ['Schedule H'],
  ph_cold_chain: true,
  ph_pharmacists: [
    {
      name: 'Rakesh Sen',
      qualification: 'B.Pharm',
      reg_no: 'WB/PH/12345',
      council: 'West Bengal State Pharmacy Council',
      mobile: '9876543210',
      document: {
        fileName: 'pharmacist.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 120_000,
        uploadedAt: '2026-01-10T10:00:00.000Z',
        uploadedBy: '11111111-1111-4111-8111-111111111111',
      },
    },
  ],
  ph_pharmacist_ft: true,
  ph_categories: ['prescription medicines', 'OTC medicines'],
  ph_restricted: ['Schedule H'],
  ph_rx_process: 'A registered pharmacist reviews every prescription.',
  ph_delivery: false,
  ph_dpco_decl: true,
  ph_returns_policy: 'Unopened medicines can be returned within 7 days.',
  decl_ph_quality: true,
  decl_ph_sourcing: true,
  decl_ph_blocking: true,
  decl_ph_no_online_sale: true,
};

const diagnosticPayload: Record<string, unknown> = {
  dc_nabl_flag: false,
  dc_director: [
    {
      name: 'Dr Meera Das',
      qualification: 'MD Pathology',
      reg_no: 'WBMC/99881',
      council: 'West Bengal Medical Council',
    },
  ],
  dc_signatories: [
    {
      name: 'Dr Meera Das',
      qualification: 'MD Pathology',
      reg_no: 'WBMC/99881',
      tests: 'Haematology',
    },
  ],
  dc_services: ['pathology'],
  dc_home_collection: false,
  dc_report_channel: 'email',
  dc_tests: [
    {
      test_name: 'Complete Blood Count',
      test_category: 'pathology',
      test_price: 450,
      test_prep: 'No fasting required.',
      test_tat: '24 hours',
      test_rx_required: false,
      test_performed_at: 'on site',
    },
  ],
  price_list_version: 'PL-2026-01',
  price_effective_from: '2026-01-01',
  dc_booking_confirm: 'call',
  dc_support_phone: '9876543210',
  dc_cancel_policy: 'Free rescheduling up to 4 hours before the slot.',
  dc_data_categories: ['booking data'],
  dc_data_purpose: 'Appointment scheduling only.',
  dc_report_access: 'no',
  dc_rights_contact: contact,
  dc_dpa_required: false,
};

const careCategory = (overrides: Record<string, unknown> = {}) => ({
  cp_category: 'non-clinical attendant',
  cp_services: ['personal care'],
  cp_scope: 'Daily living assistance under a care plan.',
  cp_staff_count: 4,
  cp_price: 400,
  cp_price_unit: 'per hour',
  cp_limitations: 'No clinical procedures.',
  cp_supervision_notes: 'A coordinator reviews the care plan weekly.',
  cp_cancel_policy: 'Cancel 12 hours ahead.',
  cp_replacement_process: 'A replacement is arranged within 24 hours.',
  cp_hours: [{ day: 'Monday', open: '08:00', close: '20:00' }],
  cp_pins: ['700016'],
  ...overrides,
});

const carePayload = (category: Record<string, unknown> = careCategory()) => ({
  cp_labour_decl: true,
  cp_service_categories: [category],
  cp_staff_model: 'employed',
  cp_subcontract_flag: false,
  cp_training_decl: true,
});

describe('pharmacy schema (field-spec 7)', () => {
  it('accepts a complete payload', () => {
    expect(collectTypeDataIssues('pharmacy', pharmacyPayload)).toEqual([]);
  });

  it('requires the FSSAI licence only for nutrition and food products', () => {
    expect(missingRequired('pharmacy', pharmacyPayload)).not.toContain('ph_fssai');
    expect(
      missingRequired('pharmacy', { ...pharmacyPayload, ph_categories: ['nutrition and food'] }),
    ).toContain('ph_fssai');
  });

  it('requires delivery PINs and charges only when delivery is offered', () => {
    expect(missingRequired('pharmacy', pharmacyPayload)).not.toContain('ph_delivery_pins');
    const delivering = { ...pharmacyPayload, ph_delivery: true };
    expect(missingRequired('pharmacy', delivering)).toContain('ph_delivery_pins');
    const issues = collectTypeDataIssues('pharmacy', delivering);
    expect(issues.some((issue) => issue.path === 'ph_delivery_charges')).toBe(true);
    expect(issues.some((issue) => issue.path === 'ph_delivery_hours')).toBe(true);
  });

  it('records online interest without switching online sale on', () => {
    const parsed = validateTypeData('pharmacy', {
      ...pharmacyPayload,
      ph_online_interest: true,
    }) as Record<string, unknown>;
    expect(parsed.ph_online_interest).toBe(true);
    expect(parsed.ph_online_enabled).toBeUndefined();
    expect(typeDataDefaultsFor('pharmacy')).toEqual({
      ph_online_enabled: false,
      ph_online_categories: [],
    });
  });
});

describe('diagnostic centre schema (field-spec 8)', () => {
  it('accepts a complete payload', () => {
    expect(collectTypeDataIssues('diagnostic_centre', diagnosticPayload)).toEqual([]);
  });

  it('requires NABL details when accreditation is claimed', () => {
    expect(missingRequired('diagnostic_centre', diagnosticPayload)).not.toContain(
      'dc_nabl_details',
    );
    expect(
      missingRequired('diagnostic_centre', { ...diagnosticPayload, dc_nabl_flag: true }),
    ).toContain('dc_nabl_details');
  });

  it('requires PC-PNDT for prenatal diagnostics', () => {
    const prenatal = { ...diagnosticPayload, dc_services: ['pathology', 'prenatal diagnostics'] };
    expect(missingRequired('diagnostic_centre', prenatal)).toContain('dc_pcpndt');
    expect(
      missingRequired('diagnostic_centre', prenatal).filter((key) => key === 'dc_pcpndt_doc'),
    ).toHaveLength(1);
  });

  it('requires an AERB permission for radiology', () => {
    const radiology = { ...diagnosticPayload, dc_services: ['pathology', 'radiology'] };
    expect(missingRequired('diagnostic_centre', radiology)).toContain('dc_aerb');
  });

  it('blocks sex-determination tests in the catalogue', () => {
    const issues = collectTypeDataIssues('diagnostic_centre', {
      ...diagnosticPayload,
      dc_tests: [
        {
          test_name: 'Ultrasound for sex determination',
          test_category: 'ultrasound',
          test_price: 900,
          test_prep: 'None',
          test_tat: '1 hour',
          test_rx_required: true,
          test_performed_at: 'on site',
        },
      ],
    });
    expect(issues.some((issue) => issue.message.includes('Sex-determination'))).toBe(true);
  });

  it('requires the performing laboratory only when the test is outsourced', () => {
    const outsourced = {
      ...diagnosticPayload,
      dc_tests: [
        {
          ...(diagnosticPayload.dc_tests as Array<Record<string, unknown>>)[0],
          test_performed_at: 'third-party lab',
        },
      ],
    };
    expect(
      collectTypeDataIssues('diagnostic_centre', outsourced).some(
        (issue) => issue.path === 'dc_tests.0.test_perf_lab',
      ),
    ).toBe(true);
  });

  it('requires a per-test home-collection answer when home collection is offered', () => {
    const issues = collectTypeDataIssues('diagnostic_centre', {
      ...diagnosticPayload,
      dc_home_collection: true,
    });
    expect(issues.some((issue) => issue.path === 'dc_tests.0.test_home')).toBe(true);
  });

  it('defaults report access to no', () => {
    expect(typeDataDefaultsFor('diagnostic_centre')).toMatchObject({ dc_report_access: 'no' });
  });
});

describe('care provider schema (field-spec 5)', () => {
  it('accepts a complete payload for a non-clinical category', () => {
    expect(collectTypeDataIssues('care_provider', carePayload())).toEqual([]);
  });

  it('requires clinical registrations and a supervisor for nursing', () => {
    const issues = collectTypeDataIssues(
      'care_provider',
      carePayload(careCategory({ cp_category: 'registered nursing' })),
    );
    expect(issues.some((issue) => issue.path === 'cp_service_categories.0.cp_staff_regs')).toBe(
      true,
    );
    expect(issues.some((issue) => issue.path === 'cp_service_categories.0.cp_supervisor')).toBe(
      true,
    );

    const completed = carePayload(
      careCategory({
        cp_category: 'registered nursing',
        cp_staff_quals: [{ qualification: 'GNM', count: 2 }],
        cp_staff_regs: [
          {
            name: 'Rina Das',
            role: 'staff nurse',
            reg_no: 'WBNC/12345',
            council: 'West Bengal Nursing Council',
          },
        ],
        cp_supervisor: [{ name: 'Dr S. Bose', qualification: 'MD', reg_no: 'WBMC/7788' }],
      }),
    );
    expect(collectTypeDataIssues('care_provider', completed)).toEqual([]);
  });

  it('requires subcontractor details when agencies are used', () => {
    const issues = collectTypeDataIssues('care_provider', {
      ...carePayload(),
      cp_subcontract_flag: true,
    });
    expect(issues.some((issue) => issue.path === 'cp_subcontractors')).toBe(true);
  });

  it('requires coverage PIN codes for each category', () => {
    const issues = collectTypeDataIssues(
      'care_provider',
      carePayload(careCategory({ cp_pins: [] })),
    );
    expect(issues.some((issue) => issue.path === 'cp_service_categories.0.cp_pins')).toBe(true);
  });
});
