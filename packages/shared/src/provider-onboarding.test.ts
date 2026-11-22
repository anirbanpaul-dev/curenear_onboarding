import { describe, expect, it } from 'vitest';
import {
  clinicDoctorCreateSchema,
  contactInputSchema,
  createOrganizationSchema,
  doctorPracticeInputSchema,
  doctorProfileSaveSchema,
  documentInputSchema,
  duplicatePreviewSchema,
  insuranceInputSchema,
  licenceInputSchema,
  locationInputSchema,
  locationUpdateSchema,
  sectionSaveSchema,
  servicePinInputSchema,
} from './provider-onboarding';

const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';

const location = {
  name: 'Salt Lake branch',
  location_type: 'clinic',
  address_line1: '12 Main Road',
  city: 'Kolkata',
  pin_code: '700091',
};

describe('provider onboarding schemas', () => {
  it('starts an organization draft with a type and legal name', () => {
    expect(
      createOrganizationSchema.parse({
        provider_type: 'diagnostic_centre',
        legal_name: '  Diagnostics Private Limited ',
        mobile: '9876543210',
        primary_pin_code: '700091',
      }),
    ).toMatchObject({
      provider_type: 'diagnostic_centre',
      legal_name: 'Diagnostics Private Limited',
      mobile: '9876543210',
    });
    expect(createOrganizationSchema.safeParse({ provider_type: 'clinic' }).success).toBe(false);
    expect(
      createOrganizationSchema.safeParse({ provider_type: 'clinic', legal_name: 'X', extra: 1 })
        .success,
    ).toBe(false);
    expect(
      createOrganizationSchema.safeParse({
        provider_type: 'clinic',
        legal_name: 'X',
        website: 'not-a-url',
      }).success,
    ).toBe(false);
    expect(
      createOrganizationSchema.safeParse({
        provider_type: 'clinic',
        legal_name: 'X',
        primary_pin_code: '012345',
      }).success,
    ).toBe(false);
  });

  it('previews duplicates and saves optimistic sections', () => {
    expect(
      duplicatePreviewSchema.safeParse({ legal_name: 'CareNear Clinic', pin_code: '700091' })
        .success,
    ).toBe(true);
    expect(duplicatePreviewSchema.safeParse({ legal_name: 'X', mobile: '12345' }).success).toBe(
      false,
    );
    expect(sectionSaveSchema.safeParse({ version: 2, data: { legal_entity: {} } }).success).toBe(
      true,
    );
    expect(sectionSaveSchema.safeParse({ version: 0, data: {} }).success).toBe(false);
  });

  it('validates locations, co-ordinates and partial updates', () => {
    expect(locationInputSchema.safeParse(location).success).toBe(true);
    expect(
      locationInputSchema.safeParse({ ...location, latitude: '22.57', longitude: '88.36' }).success,
    ).toBe(true);
    expect(locationInputSchema.safeParse({ ...location, latitude: 91 }).success).toBe(false);
    expect(locationInputSchema.safeParse({ ...location, pin_code: '012345' }).success).toBe(false);
    expect(locationInputSchema.safeParse({ ...location, booking_phone: '12345' }).success).toBe(
      false,
    );
    expect(locationUpdateSchema.safeParse({ name: 'Renamed' }).success).toBe(true);
    expect(locationUpdateSchema.safeParse({ pin_code: 'bad' }).success).toBe(false);
  });

  it('validates contacts, licences, insurance and service PINs', () => {
    expect(
      contactInputSchema.safeParse({
        role: 'owner',
        name: 'Dr Owner',
        phone: '9876543210',
        email: 'owner@clinic.in',
        address: {
          line1: '12 Main Road',
          city: 'Kolkata',
          state: 'West Bengal',
          pin: '700091',
        },
      }).success,
    ).toBe(true);
    expect(contactInputSchema.safeParse({ role: 'owner', name: 'X', phone: '123' }).success).toBe(
      false,
    );

    expect(
      licenceInputSchema.safeParse({
        number: 'WB/CLINIC/2026/1',
        authority: 'West Bengal Clinical Establishments',
        valid_to: '2027-12-31',
        status: 'active',
      }).success,
    ).toBe(true);
    expect(licenceInputSchema.safeParse({ number: '', status: 'active' }).success).toBe(false);
    expect(licenceInputSchema.safeParse({ number: 'X', status: 'unknown' }).success).toBe(false);

    expect(
      insuranceInputSchema.safeParse({
        type: 'professional_indemnity',
        insurer: 'Insurer',
        policy_no: 'POL-1',
        limit_paise: 5_000_000,
      }).success,
    ).toBe(true);
    expect(
      insuranceInputSchema.safeParse({ type: 'x', insurer: 'y', policy_no: 'z', limit_paise: -1 })
        .success,
    ).toBe(false);

    expect(servicePinInputSchema.parse({ pin_code: '700091' }).service_kind).toBe('service');
    expect(
      servicePinInputSchema.safeParse({ pin_code: '700091', service_kind: 'diagnostics' }).success,
    ).toBe(true);
  });

  it('validates uploaded document metadata and doctor profile saves', () => {
    expect(
      documentInputSchema.safeParse({
        file_name: 'licence.pdf',
        mime_type: 'application/pdf',
        size_bytes: 2048,
        storage_key: 'documents/licence.pdf',
        role: 'licence',
      }).success,
    ).toBe(true);
    expect(
      documentInputSchema.safeParse({
        file_name: 'licence.pdf',
        mime_type: 'text/html',
        size_bytes: 2048,
        role: 'licence',
      }).success,
    ).toBe(false);
    expect(
      documentInputSchema.safeParse({
        file_name: 'licence.pdf',
        mime_type: 'application/pdf',
        size_bytes: 11 * 1024 * 1024,
        role: 'licence',
      }).success,
    ).toBe(false);

    expect(
      doctorProfileSaveSchema.safeParse({
        version: 1,
        section: 'doctor_identity',
        data: { full_name: 'Dr Test' },
      }).success,
    ).toBe(true);
    expect(
      doctorProfileSaveSchema.safeParse({ version: 1, section: 'unknown', data: {} }).success,
    ).toBe(false);
  });

  it('validates practice addresses and clinic-added doctor payloads', () => {
    expect(
      doctorPracticeInputSchema.safeParse({
        practice_type: 'clinic',
        clinic_organization_id: id,
        address: {
          line1: '12 Main Road',
          city: 'Kolkata',
          state: 'West Bengal',
          pin: '700091',
        },
        timings: [{ day: 'Monday', start: '09:00', end: '17:00' }],
        fee_paise: 50_000,
        public_contact: '9876543210',
      }).success,
    ).toBe(true);
    expect(doctorPracticeInputSchema.safeParse({ practice_type: 'clinic' }).success).toBe(false);

    expect(
      clinicDoctorCreateSchema.safeParse({
        doctor_profile_id: otherId,
        role_at_clinic: 'Consultant',
        timings: [{ day: 'Monday', start: '09:00', end: '13:00' }],
        fee_paise: 50_000,
        clinic_attestation: true,
      }).success,
    ).toBe(true);
    expect(clinicDoctorCreateSchema.safeParse({ full_name: 'Dr Added' }).success).toBe(false);
  });
});
