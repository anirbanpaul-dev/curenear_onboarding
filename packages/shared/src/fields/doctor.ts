import {
  appointmentConfirmers,
  appointmentMethods,
  feeCollectionOptions,
  fieldsForSection,
  insuranceTypes,
  languages,
  medicalSpecialties,
  practiceTypes,
  registrationCouncils,
  required,
  section,
  sub,
  systemsOfMedicine,
} from './options';
import type { ProviderTypeDefinition } from './types';

/**
 * Section 4 of docs/field-spec.md (Doctor Partner Agreement clauses 4, 9, 10,
 * 14, 18 and Schedules A, B, C).
 *
 * Identity and registration live in `doctor_profiles`/`provider_licences`;
 * practice links live in `doctor_locations`; appointments, fees, disclosures and
 * the doctor-specific declaration stay in `type_data`.
 *
 * `practice_locations` keeps the shape the onboarding form already stores (one
 * repeater of practice entries) so the portal and the normalized tables describe
 * the same thing.
 */

const identity = fieldsForSection('doctor_identity', 'Doctor 4.1');
const qualifications = fieldsForSection('doctor_qualifications', 'Doctor 4.2');
const practice = fieldsForSection('doctor_practice', 'Doctor 4.3');
const operations = fieldsForSection('doctor_operations', 'Doctor 4.4');
const disclosures = fieldsForSection('doctor_disclosures', 'Doctor 4.5');

export const doctorDefinition: ProviderTypeDefinition = {
  providerType: 'doctor',
  schemaVersion: 1,
  sections: [
    section('doctor_identity', 'Identity and registration', 'Doctor 4.1', [
      identity('doc_full_name', 'Full name (with title)', 'text', {
        requirement: required,
        storage: { kind: 'related', table: 'doctor_profiles' },
        validation: { maxLength: 160 },
      }),
      identity('doc_photo', 'Photograph', 'file', {
        storage: { kind: 'related', table: 'provider_documents', role: 'doctor_photo' },
        help: 'Published only with the doctor’s consent.',
      }),
      identity('doc_reg_no', 'Medical registration number', 'text', {
        requirement: required,
        storage: { kind: 'related', table: 'doctor_profiles' },
        validation: { maxLength: 60 },
      }),
      identity('doc_reg_council', 'Registering authority / council', 'select', {
        requirement: required,
        storage: { kind: 'related', table: 'doctor_profiles' },
        validation: { options: registrationCouncils },
      }),
      identity('doc_reg_date', 'Registration date', 'date', {
        requirement: required,
        storage: { kind: 'related', table: 'provider_licences', role: 'medical_registration' },
      }),
      identity('doc_reg_valid_to', 'Registration valid until', 'date', {
        requirement: 'conditional',
        storage: { kind: 'related', table: 'provider_licences', role: 'medical_registration' },
        conditionNote: 'Required where the council requires renewal.',
        todo: 'The spec says "C" without naming the condition; whether a council requires renewal is not data we hold yet.',
      }),
      identity('doc_reg_doc', 'Registration certificate', 'file', {
        requirement: required,
        storage: { kind: 'related', table: 'provider_documents', role: 'medical_registration' },
      }),
      identity('doc_system', 'System of medicine', 'select', {
        requirement: required,
        storage: { kind: 'related', table: 'doctor_profiles' },
        validation: { options: systemsOfMedicine },
      }),
    ]),

    section('doctor_qualifications', 'Qualifications and specialty', 'Doctor 4.2', [
      qualifications('doc_qualifications', 'Qualifications', 'repeater', {
        requirement: required,
        storage: { kind: 'related', table: 'doctor_profiles' },
        items: [
          sub('degree', 'Degree', 'text', {
            requirement: required,
            validation: { maxLength: 120 },
          }),
          sub('institution', 'University / institution', 'text', {
            requirement: required,
            validation: { maxLength: 160 },
          }),
          sub('year', 'Year', 'number'),
          sub('document', 'Certificate', 'file'),
        ],
      }),
      qualifications('doc_specialty', 'Recognized specialty', 'select', {
        requirement: 'conditional',
        storage: { kind: 'related', table: 'doctor_profiles' },
        validation: { options: medicalSpecialties },
        conditionNote: 'Must match a recognised specialty.',
        todo: 'The spec marks this "C" without a condition; the portal treats it as optional on submit.',
      }),
      qualifications('doc_subspecialty', 'Super-specialty / areas of interest', 'multiselect', {
        validation: { options: medicalSpecialties },
      }),
      qualifications('doc_specialty_doc', 'Specialty qualification certificate', 'file', {
        requirement: 'conditional',
        storage: { kind: 'related', table: 'provider_documents', role: 'specialty' },
        conditionNote: 'Required when a specialty qualification is claimed.',
      }),
      qualifications('doc_experience_years', 'Years of experience', 'number', {
        validation: { min: 0, max: 80, integer: true },
      }),
      qualifications('doc_languages', 'Languages', 'multiselect', {
        validation: { options: languages },
      }),
    ]),

    section('doctor_practice', 'Practice locations', 'Doctor 4.3', [
      practice('practice_locations', 'Practice locations', 'repeater', {
        requirement: required,
        storage: { kind: 'related', table: 'doctor_locations' },
        items: [
          sub('prac_type', 'Practice type', 'select', {
            requirement: required,
            validation: { options: practiceTypes },
          }),
          sub('prac_clinic_id', 'Linked establishment', 'text', {
            requirement: 'conditional',
            conditionNote: 'Required when the practice type is a linked establishment.',
            help: 'Identifier of an onboarded clinic, or add the location below.',
            validation: { maxLength: 60 },
          }),
          sub('prac_location', 'Location', 'address', { requirement: required }),
          sub('prac_timings', 'Consultation timings', 'repeater', {
            requirement: required,
            items: [
              sub('day', 'Day', 'select', {
                requirement: required,
                validation: {
                  options: [
                    'Monday',
                    'Tuesday',
                    'Wednesday',
                    'Thursday',
                    'Friday',
                    'Saturday',
                    'Sunday',
                  ],
                },
              }),
              sub('start', 'Start (HH:MM)', 'text', { validation: { maxLength: 5 } }),
              sub('end', 'End (HH:MM)', 'text', { validation: { maxLength: 5 } }),
              sub('slot_minutes', 'Slot duration (minutes)', 'number'),
            ],
          }),
          sub('prac_fee', 'In-clinic consultation fee (INR)', 'money', { requirement: required }),
          sub('prac_followup_fee', 'Follow-up fee (INR)', 'money'),
          sub('prac_followup_days', 'Follow-up validity (days)', 'number'),
          sub('prac_contact', 'Public appointment contact', 'text', {
            requirement: required,
            validation: { maxLength: 160 },
          }),
          sub('prac_establishment_licence', 'Establishment licence of the location', 'text', {
            requirement: 'conditional',
            conditionNote: 'Required for linked establishments.',
            validation: { maxLength: 80 },
            todo: 'The spec gives this field two types (text and file); modelled as text with the licence document in provider_licences.',
          }),
        ],
      }),
    ]),

    section('doctor_operations', 'Appointments, fees and operations', 'Doctor 4.4', [
      operations('appt_confirmer', 'Who confirms appointments', 'select', {
        requirement: required,
        storage: { kind: 'type_data' },
        validation: { options: appointmentConfirmers },
      }),
      operations('appt_confirm_method', 'Confirmation method', 'select', {
        requirement: required,
        validation: { options: appointmentMethods },
      }),
      operations('appt_contact', 'Reliable response contact', 'repeater', {
        requirement: required,
        items: [
          sub('name', 'Name', 'text', { requirement: required, validation: { maxLength: 120 } }),
          sub('phone', 'Phone', 'phone', { requirement: required }),
          sub('email', 'Email', 'email'),
        ],
      }),
      operations('appt_cancel_policy', 'Cancellation process', 'textarea', {
        requirement: required,
        validation: { maxLength: 1000 },
      }),
      operations('appt_deposit', 'Deposits / cancellation charges', 'text', {
        validation: { maxLength: 500 },
      }),
      operations('fee_collection', 'Consultation fee collection', 'select', {
        requirement: required,
        validation: { options: feeCollectionOptions },
      }),
      operations('doc_complaint_contact', 'Patient complaint contact', 'repeater', {
        requirement: required,
        items: [
          sub('name', 'Name', 'text', { requirement: required, validation: { maxLength: 120 } }),
          sub('phone', 'Phone', 'phone', { requirement: required }),
          sub('email', 'Email', 'email'),
        ],
      }),
      operations('doc_pi_insurance', 'Professional indemnity insurance', 'repeater', {
        storage: { kind: 'related', table: 'provider_insurance' },
        help: 'Mandatory only where Schedule B requires it.',
        items: [
          sub('ins_type', 'Insurance type', 'select', { validation: { options: insuranceTypes } }),
          sub('ins_insurer', 'Insurer', 'text', { validation: { maxLength: 160 } }),
          sub('ins_policy_no', 'Policy number', 'text', { validation: { maxLength: 80 } }),
          sub('ins_limit', 'Sum insured (INR)', 'money'),
          sub('ins_from', 'Valid from', 'date'),
          sub('ins_to', 'Valid to', 'date'),
          sub('ins_doc', 'Policy document', 'file'),
        ],
      }),
    ]),

    section('doctor_disclosures', 'Disclosures and ethics', 'Doctor 4.5', [
      disclosures(
        'doc_restriction_flag',
        'Any suspension, cancellation or material restriction?',
        'boolean',
        {
          requirement: required,
        },
      ),
      disclosures('doc_restriction_details', 'Details', 'textarea', {
        requirement: 'conditional',
        condition: { field: 'doc_restriction_flag', op: 'isTrue' },
        conditionNote: 'Required when a restriction is disclosed.',
        validation: { maxLength: 1000 },
      }),
      disclosures('doc_disciplinary_flag', 'Pending disciplinary proceedings?', 'boolean'),
      disclosures('doc_tele_interest', 'Interested in teleconsultation later?', 'boolean', {
        help: 'Interest only; teleconsultation is not activated.',
      }),
      disclosures(
        'decl_doc_ethics',
        'No testimonials, before-after photos or prohibited advertising',
        'boolean',
        {
          requirement: required,
        },
      ),
    ]),
  ],
};
