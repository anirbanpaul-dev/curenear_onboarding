import { randomUUID } from 'node:crypto';

const fileUpload = (fileName: string) => ({
  fileName,
  mimeType: 'application/pdf' as const,
  sizeBytes: 120_000,
  uploadedAt: '2026-01-10T10:00:00.000Z',
  uploadedBy: '11111111-1111-4111-8111-111111111111',
});

const address = {
  line1: '12 Park Street',
  city: 'Kolkata',
  state: 'West Bengal',
  pin: '700016',
};

/** Every mandatory field for a doctor, as the spec requires on submit. */
export function validDoctorData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    legal_name: 'A. Sen Clinic',
    trade_name: 'Park Street Clinic',
    constitution_type: 'sole proprietorship',
    reg_addr_line1: '12 Park Street',
    reg_city: 'Kolkata',
    reg_district: 'Kolkata',
    reg_state: 'West Bengal',
    reg_pin: '700016',
    locations: [
      {
        loc_name: 'Park Street Clinic',
        loc_type: 'clinic',
        loc_address: address,
        loc_pin: '700016',
        loc_geo: { lat: 22.5535, lng: 88.3521 },
        loc_hours: [{ day: 'Monday', open: '09:00', close: '13:00', closed: false }],
        loc_booking_phone: '9830012345',
        loc_public: true,
      },
    ],
    sig_name: 'A. Sen',
    sig_designation: 'Proprietor',
    sig_mobile: '9830012345',
    sig_email: 'clinic@example.com',
    contact_booking: [{ name: 'Front desk', phone: '9830012345', email: 'front@example.com' }],
    contact_grievance: [{ name: 'Grievance officer', phone: '9830012345' }],
    contact_security: [{ name: 'IT contact', phone: '9830012345' }],
    notice_address: address,
    notice_email: 'legal@example.com',
    profile_display_name: 'Dr A. Sen',
    profile_description: 'General physician with 12 years of practice.',
    consent_publish_photo: true,
    public_fields: ['profile_display_name', 'profile_description'],
    decl_accuracy: true,
    decl_authority: true,
    decl_licences: true,
    decl_notify_changes: true,
    decl_verification: true,
    decl_no_referral_incentive: true,
    decl_no_misleading_claims: true,
    decl_privacy_ack: true,
    doc_full_name: 'Dr A. Sen',
    doc_reg_no: 'WB/12345',
    doc_reg_council: 'West Bengal Medical Council',
    doc_reg_date: '2012-06-01',
    doc_reg_doc: fileUpload('registration.pdf'),
    doc_system: 'allopathy',
    doc_qualifications: [{ degree: 'MBBS', institution: 'Calcutta Medical College', year: 2011 }],
    doc_specialty: 'general medicine',
    practice_locations: [
      {
        prac_type: 'own clinic',
        prac_location: address,
        prac_timings: [{ day: 'Monday', start: '09:00', end: '13:00', slot_minutes: 15 }],
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
    ...overrides,
  };
}

/** Minimal valid pharmacy licence section, used by list/filter tests. */
export function pharmacyDraftData(pin: string): Record<string, unknown> {
  return {
    profile_display_name: 'Wellness Pharmacy',
    legal_name: 'Wellness Pharmacy LLP',
    reg_pin: pin,
    ph_premises: { ...address, pin },
  };
}

export const testUserId = '11111111-1111-4111-8111-111111111111';
export const testAdminId = '22222222-2222-4222-8222-222222222222';
export const newId = (): string => randomUUID();
