import {
  appointmentMethods,
  clinicFacilities,
  clinicOwnershipTypes,
  clinicServices,
  clinicSystemsOfMedicine,
  clinicTypes,
  doctorRolesAtClinic,
  fieldsForSection,
  languages,
  medicalSpecialties,
  required,
  section,
  sub,
} from './options';
import type { ProviderTypeDefinition } from './types';

/**
 * Section 6 of docs/field-spec.md. There is no Clinic agreement yet, so this
 * form is our proposal, modelled on the Doctor, Diagnostic and Home-Care
 * agreements.
 *
 * Establishment registrations are `provider_licences` rows (detail in
 * `details`); the clinical and commercial answers stay in `type_data`.
 * `clinic_doctors` is the clinic-adds-a-doctor sub-form: it is registry data for
 * the invitation flow, not part of the clinic's own onboarding form.
 */

const establishment = fieldsForSection('clinic_establishment', '6.1');
const services = fieldsForSection('clinic_services', '6.2');
const operations = fieldsForSection('clinic_operations', '6.3');
const declarations = fieldsForSection('clinic_declarations', '6.4');
const clinicDoctors = fieldsForSection('clinic_doctors', '6.5');

export const clinicDefinition: ProviderTypeDefinition = {
  providerType: 'clinic',
  schemaVersion: 1,
  sections: [
    section(
      'clinic_establishment',
      'Establishment details and licences',
      '6.1',
      [
        establishment('clinic_type', 'Clinic type', 'select', {
          requirement: required,
          validation: { options: clinicTypes },
        }),
        establishment('clinic_systems', 'Systems of medicine practised', 'multiselect', {
          requirement: required,
          validation: { options: clinicSystemsOfMedicine },
        }),
        establishment('clinic_ownership', 'Ownership', 'select', {
          requirement: required,
          validation: { options: clinicOwnershipTypes },
        }),
        establishment('clinic_owner', 'Owner / proprietor name', 'text', {
          requirement: required,
          validation: { maxLength: 160 },
        }),
        establishment(
          'clinic_ce_applicable',
          'Clinical establishment registration applicable?',
          'select',
          {
            requirement: required,
            validation: { options: ['yes', 'exempt', 'not sure'] },
          },
        ),
        establishment('clinic_ce_exempt_reason', 'Reason for exemption', 'text', {
          requirement: 'conditional',
          condition: { field: 'clinic_ce_applicable', op: 'equals', value: 'exempt' },
          conditionNote: 'Required when the clinic is exempt.',
          validation: { maxLength: 300 },
        }),
        establishment('clinic_ce_reg_no', 'Clinical establishment registration number', 'text', {
          requirement: 'conditional',
          condition: { field: 'clinic_ce_applicable', op: 'equals', value: 'yes' },
          conditionNote: 'Required when registration is applicable.',
          storage: { kind: 'related', table: 'provider_licences', role: 'clinical_establishment' },
          validation: { maxLength: 80 },
        }),
        establishment('clinic_ce_authority', 'Registering authority', 'text', {
          requirement: 'conditional',
          condition: { field: 'clinic_ce_applicable', op: 'equals', value: 'yes' },
          storage: { kind: 'related', table: 'provider_licences', role: 'clinical_establishment' },
          validation: { maxLength: 160 },
        }),
        establishment('clinic_ce_category', 'Registration category', 'text', {
          requirement: 'conditional',
          condition: { field: 'clinic_ce_applicable', op: 'equals', value: 'yes' },
          storage: { kind: 'related', table: 'provider_licences', role: 'clinical_establishment' },
          validation: { maxLength: 120 },
        }),
        establishment('clinic_ce_from', 'Valid from', 'date', {
          requirement: 'conditional',
          condition: { field: 'clinic_ce_applicable', op: 'equals', value: 'yes' },
          storage: { kind: 'related', table: 'provider_licences', role: 'clinical_establishment' },
        }),
        establishment('clinic_ce_to', 'Valid to', 'date', {
          requirement: 'conditional',
          condition: { field: 'clinic_ce_applicable', op: 'equals', value: 'yes' },
          storage: { kind: 'related', table: 'provider_licences', role: 'clinical_establishment' },
          help: 'Expiry drives reminders.',
        }),
        establishment('clinic_ce_doc', 'Registration certificate', 'file', {
          requirement: 'conditional',
          condition: { field: 'clinic_ce_applicable', op: 'equals', value: 'yes' },
          storage: { kind: 'related', table: 'provider_documents', role: 'clinical_establishment' },
        }),
        establishment('clinic_bmw', 'Biomedical waste authorisation', 'text', {
          requirement: 'conditional',
          storage: { kind: 'related', table: 'provider_licences', role: 'biomedical_waste' },
          help: 'Required if the clinic generates biomedical waste (injections, dressings, procedures).',
          conditionNote: 'Required when the clinic generates biomedical waste.',
          validation: { maxLength: 120 },
          todo: 'No field captures whether the clinic generates biomedical waste; needs a product decision.',
        }),
        establishment('clinic_bmw_doc', 'Biomedical waste document', 'file', {
          requirement: 'conditional',
          storage: { kind: 'related', table: 'provider_documents', role: 'biomedical_waste' },
          conditionNote: 'Required when the clinic generates biomedical waste.',
        }),
        establishment('clinic_aerb', 'AERB permission', 'text', {
          requirement: 'conditional',
          storage: { kind: 'related', table: 'provider_licences', role: 'aerb' },
          help: 'Required if X-ray or other radiation equipment is on site.',
          conditionNote: 'Required when radiation equipment is on site.',
          validation: { maxLength: 120 },
          todo: 'No field captures whether radiation equipment is on site; needs a product decision.',
        }),
        establishment('clinic_aerb_doc', 'AERB document', 'file', {
          requirement: 'conditional',
          storage: { kind: 'related', table: 'provider_documents', role: 'aerb' },
          conditionNote: 'Required when radiation equipment is on site.',
        }),
        establishment('clinic_other_licences', 'Other licences', 'repeater', {
          storage: { kind: 'related', table: 'provider_licences', role: 'other' },
          items: [
            sub('name', 'Licence name', 'text', {
              requirement: required,
              validation: { maxLength: 120 },
            }),
            sub('number', 'Number', 'text', { validation: { maxLength: 80 } }),
            sub('valid_to', 'Valid to', 'date'),
            sub('document', 'Document', 'file'),
          ],
        }),
        establishment('clinic_incharge', 'Medical director / in-charge doctor', 'text', {
          requirement: required,
          validation: { maxLength: 160 },
          help: 'Must be one of the clinic doctors with a registration number.',
        }),
      ],
      'No Clinic agreement exists yet; fields follow the proposed Section 6 form.',
    ),

    section('clinic_services', 'Services and facilities', '6.2', [
      services('clinic_specialties', 'Specialties offered', 'multiselect', {
        requirement: required,
        validation: { options: medicalSpecialties },
      }),
      services('clinic_services', 'Services / procedures offered', 'multiselect', {
        validation: { options: clinicServices },
      }),
      services('clinic_facilities', 'Facilities', 'multiselect', {
        validation: { options: clinicFacilities },
      }),
      services('clinic_rooms', 'Number of consultation rooms', 'number', {
        validation: { integer: true, min: 0 },
      }),
      services('clinic_beds', 'Observation / day-care beds', 'number', {
        validation: { integer: true, min: 0 },
      }),
      services('clinic_home_visit', 'Home visits offered', 'boolean'),
      services('clinic_languages', 'Languages spoken at clinic', 'multiselect', {
        validation: { options: languages },
      }),
      services('clinic_insurance_panels', 'Insurance / cashless panels accepted', 'text', {
        validation: { maxLength: 300 },
        todo: 'The spec allows free text or a list; kept as free text until the panel list exists.',
      }),
      services('clinic_tele_interest', 'Interested in teleconsultation later?', 'boolean'),
      services('clinic_emergency_flag', 'Provides emergency or casualty care?', 'boolean', {
        help: 'Information only; the platform is not an emergency service.',
      }),
    ]),

    section('clinic_operations', 'Appointments, fees and operations', '6.3', [
      operations('clinic_appt_confirmer', 'Who confirms appointments', 'select', {
        requirement: required,
        validation: { options: ['clinic front desk', 'individual doctor'] },
      }),
      operations('clinic_appt_method', 'Confirmation method', 'select', {
        requirement: required,
        validation: { options: appointmentMethods },
      }),
      operations('clinic_fees', 'Consultation fee schedule', 'repeater', {
        requirement: required,
        items: [
          sub('item', 'Doctor or service', 'text', {
            requirement: required,
            validation: { maxLength: 160 },
          }),
          sub('fee', 'Fee (INR)', 'money', { requirement: required }),
          sub('followup_fee', 'Follow-up fee (INR)', 'money'),
          sub('followup_days', 'Follow-up validity (days)', 'number'),
        ],
      }),
      operations('clinic_deposit_policy', 'Deposits and cancellation charges', 'text', {
        validation: { maxLength: 500 },
      }),
      operations('clinic_cancel_policy', 'Cancellation and rescheduling policy', 'textarea', {
        requirement: required,
        validation: { maxLength: 1000 },
      }),
      operations('clinic_fee_collection', 'Fee collection at clinic', 'select', {
        requirement: required,
        validation: { options: ['clinic collects directly', 'doctor collects directly'] },
      }),
      operations('clinic_support_phone', 'Patient support number', 'phone', {
        requirement: required,
      }),
    ]),

    section('clinic_declarations', 'Clinic declarations', '6.4', [
      declarations(
        'decl_clinic_doctors',
        'All doctors listed are registered and have agreed to be listed',
        'boolean',
        {
          requirement: required,
        },
      ),
      declarations(
        'decl_clinic_licences',
        'The clinic holds all registrations required for its activities',
        'boolean',
        {
          requirement: required,
        },
      ),
      declarations(
        'decl_clinic_ethics',
        'No testimonials, before-and-after photographs or prohibited advertising',
        'boolean',
        {
          requirement: required,
        },
      ),
      declarations(
        'decl_clinic_no_referral',
        'No referral commissions or fee-splitting',
        'boolean',
        {
          requirement: required,
        },
      ),
    ]),

    section(
      'clinic_doctors',
      'Clinic adds doctors',
      '6.5',
      [
        clinicDoctors('cd_mobile', 'Doctor mobile', 'phone', {
          storage: { kind: 'related', table: 'doctor_profiles' },
          help: 'Invitation and OTP go here. Captured on the doctor profile, not the clinic.',
          todo: 'doctor_profiles has no mobile/email columns; the invite contact needs a storage decision.',
        }),
        clinicDoctors('cd_email', 'Doctor email', 'email', {
          storage: { kind: 'related', table: 'doctor_profiles' },
          todo: 'doctor_profiles has no email column; the invite contact needs a storage decision.',
        }),
        clinicDoctors('cd_role', 'Role at this clinic', 'select', {
          storage: { kind: 'related', table: 'doctor_locations' },
          validation: { options: doctorRolesAtClinic },
        }),
        clinicDoctors('cd_clinic_attestation', 'Clinic attestation', 'boolean', {
          storage: { kind: 'related', table: 'doctor_locations' },
          help: '"This doctor has agreed to be listed and I am authorized to add them."',
        }),
      ],
      'The doctor identity fields are the Doctor section fields and are reused here; only the clinic-specific additions are listed. This section drives the invite flow, not the clinic onboarding form.',
      { notInProviderForm: true },
    ),
  ],
};
