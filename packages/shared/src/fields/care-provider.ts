import {
  careEquipment,
  careServiceCategories,
  careServices,
  careStaffModels,
  fieldsForSection,
  priceUnits,
  required,
  section,
  sub,
} from './options';
import type { ProviderTypeDefinition } from './types';

/**
 * Section 5 of docs/field-spec.md (Home-Care Provider Partner Agreement clauses
 * 2-6, 8, 16 and Schedules A, C).
 *
 * Verification is per service category, so each category is a repeater item.
 * Licences are `provider_licences` rows; coverage PINs stay inside the category
 * item and are copied to `provider_service_pins` with the category as
 * `service_kind`.
 */

const licences = fieldsForSection('care_licences', '5.1');
const services = fieldsForSection('care_services', '5.2');
const personnel = fieldsForSection('care_personnel', '5.3');

export const careProviderDefinition: ProviderTypeDefinition = {
  providerType: 'care_provider',
  schemaVersion: 1,
  sections: [
    section('care_licences', 'Entity and licences', '5.1', [
      licences('cp_licences', 'Registration / licence(s)', 'repeater', {
        requirement: required,
        storage: { kind: 'related', table: 'provider_licences', role: 'care_registration' },
        help: 'Includes clinical establishment registration where applicable.',
        items: [
          sub('name', 'Licence name', 'text', {
            requirement: required,
            validation: { maxLength: 160 },
          }),
          sub('number', 'Number', 'text', { requirement: required, validation: { maxLength: 80 } }),
          sub('authority', 'Authority', 'text', {
            requirement: required,
            validation: { maxLength: 160 },
          }),
          sub('valid_to', 'Valid to', 'date'),
          sub('document', 'Document', 'file', { requirement: required }),
        ],
      }),
      licences('cp_bmw', 'Biomedical waste authorisation', 'text', {
        requirement: 'conditional',
        storage: { kind: 'related', table: 'provider_licences', role: 'biomedical_waste' },
        conditionNote: 'Where applicable.',
        validation: { maxLength: 120 },
        todo: 'The spec does not say which care providers need BMW authorisation; needs a product decision.',
      }),
      licences('cp_bmw_doc', 'Biomedical waste document', 'file', {
        requirement: 'conditional',
        storage: { kind: 'related', table: 'provider_documents', role: 'biomedical_waste' },
        conditionNote: 'Where applicable.',
      }),
      licences('cp_labour_decl', 'Labour / employment compliance declaration', 'boolean', {
        requirement: required,
      }),
    ]),

    section(
      'care_services',
      'Service categories',
      '5.2',
      [
        services('cp_service_categories', 'Service categories', 'repeater', {
          requirement: required,
          items: [
            sub('cp_category', 'Service category', 'select', {
              requirement: required,
              validation: { options: careServiceCategories },
            }),
            sub('cp_services', 'Specific services offered', 'multiselect', {
              requirement: required,
              validation: { options: careServices },
              help: 'No invasive procedures or medication administration without qualified personnel.',
            }),
            sub('cp_scope', 'Authorized professional scope', 'textarea', {
              requirement: required,
              validation: { maxLength: 1000 },
            }),
            sub('cp_staff_count', 'Qualified staff available (count)', 'number', {
              requirement: required,
              validation: { integer: true, min: 0 },
            }),
            sub('cp_staff_quals', 'Staff qualification mix', 'repeater', {
              requirement: 'conditional',
              condition: {
                any: [
                  { field: 'cp_category', op: 'equals', value: 'registered nursing' },
                  { field: 'cp_category', op: 'equals', value: 'physiotherapy' },
                ],
              },
              conditionNote: 'Required for nursing and physiotherapy categories (field-spec 5.2).',
              items: [
                sub('qualification', 'Qualification', 'text', {
                  requirement: required,
                  validation: { maxLength: 120 },
                }),
                sub('count', 'Count', 'number', {
                  requirement: required,
                  validation: { integer: true },
                }),
              ],
            }),
            sub('cp_staff_regs', 'Professional registrations of clinical staff', 'repeater', {
              requirement: 'conditional',
              condition: {
                any: [
                  { field: 'cp_category', op: 'equals', value: 'registered nursing' },
                  { field: 'cp_category', op: 'equals', value: 'physiotherapy' },
                ],
              },
              conditionNote: 'Required for nursing and physiotherapy categories (field-spec 5.2).',
              items: [
                sub('name', 'Name', 'text', {
                  requirement: required,
                  validation: { maxLength: 160 },
                }),
                sub('role', 'Role', 'text', {
                  requirement: required,
                  validation: { maxLength: 120 },
                }),
                sub('reg_no', 'Registration number', 'text', {
                  requirement: required,
                  validation: { maxLength: 60 },
                }),
                sub('council', 'Council', 'text', {
                  requirement: required,
                  validation: { maxLength: 160 },
                }),
                sub('valid_to', 'Valid to', 'date'),
              ],
            }),
            sub('cp_supervisor', 'Clinical supervisor', 'repeater', {
              requirement: 'conditional',
              condition: {
                any: [
                  { field: 'cp_category', op: 'equals', value: 'registered nursing' },
                  { field: 'cp_category', op: 'equals', value: 'physiotherapy' },
                  { field: 'cp_category', op: 'equals', value: 'palliative support' },
                ],
              },
              conditionNote:
                'Required for clinical categories (Schedule C "clinical supervision").',
              items: [
                sub('name', 'Name', 'text', {
                  requirement: required,
                  validation: { maxLength: 160 },
                }),
                sub('qualification', 'Qualification', 'text', {
                  requirement: required,
                  validation: { maxLength: 120 },
                }),
                sub('reg_no', 'Registration number', 'text', {
                  requirement: required,
                  validation: { maxLength: 60 },
                }),
              ],
            }),
            sub('cp_price', 'Price (INR)', 'money', { requirement: required }),
            sub('cp_price_unit', 'Pricing unit', 'select', {
              requirement: required,
              validation: { options: priceUnits },
            }),
            sub('cp_min_booking', 'Minimum booking duration', 'text', {
              validation: { maxLength: 120 },
            }),
            sub('cp_equipment', 'Equipment provided / operated', 'multiselect', {
              validation: { options: careEquipment },
            }),
            sub('cp_limitations', 'Service limitations', 'textarea', {
              requirement: required,
              help: 'Disclosed to the user before service.',
              validation: { maxLength: 1000 },
            }),
            sub('cp_supervision_notes', 'Supervision arrangements', 'textarea', {
              requirement: required,
              validation: { maxLength: 1000 },
            }),
            sub('cp_cancel_policy', 'Cancellation rules', 'textarea', {
              requirement: required,
              validation: { maxLength: 1000 },
            }),
            sub('cp_replacement_process', 'Replacement process', 'textarea', {
              requirement: required,
              validation: { maxLength: 1000 },
            }),
            sub('cp_hours', 'Operating hours / 24x7', 'repeater', {
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
                sub('open', 'Opens (HH:MM)', 'text', { validation: { maxLength: 5 } }),
                sub('close', 'Closes (HH:MM)', 'text', { validation: { maxLength: 5 } }),
                sub('closed', 'Closed all day', 'boolean'),
              ],
            }),
            sub('cp_pins', 'Covered PIN codes', 'pinlist', { requirement: required }),
          ],
        }),
      ],
      'Verification is per service category (Home-Care 2.2).',
    ),

    section('care_personnel', 'Personnel, safeguarding and incident readiness', '5.3', [
      personnel('cp_staff_model', 'Staff are employed / contracted / via agency', 'select', {
        requirement: required,
        validation: { options: careStaffModels },
      }),
      personnel('cp_subcontract_flag', 'Uses subcontractors or staffing agencies?', 'boolean', {
        requirement: required,
      }),
      personnel('cp_subcontractors', 'Subcontractor / agency details', 'repeater', {
        requirement: 'conditional',
        condition: { field: 'cp_subcontract_flag', op: 'isTrue' },
        conditionNote: 'Required when subcontractors are used.',
        items: [
          sub('name', 'Name', 'text', { requirement: required, validation: { maxLength: 160 } }),
          sub('registration', 'Registration', 'text', { validation: { maxLength: 80 } }),
          sub('services', 'Services covered', 'text', {
            requirement: required,
            validation: { maxLength: 200 },
          }),
        ],
      }),
      personnel('cp_bg_policy_doc', 'Background check policy', 'file', {
        requirement: required,
        storage: { kind: 'related', table: 'provider_documents', role: 'background_check' },
      }),
      personnel('cp_safeguarding_doc', 'Safeguarding policy', 'file', {
        requirement: required,
        storage: { kind: 'related', table: 'provider_documents', role: 'safeguarding' },
        help: 'Abuse, neglect, harassment, theft and vulnerable adults.',
      }),
      personnel('cp_training_decl', 'Training and competency records maintained', 'boolean', {
        requirement: required,
      }),
      personnel('cp_incident_protocol_doc', 'Incident and emergency escalation protocol', 'file', {
        requirement: required,
        storage: { kind: 'related', table: 'provider_documents', role: 'incident_protocol' },
      }),
    ]),
  ],
};
