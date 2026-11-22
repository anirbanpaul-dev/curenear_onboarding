import {
  appointmentMethods,
  dataCategories,
  diagnosticHighRiskWorkflows,
  diagnosticServices,
  fieldsForSection,
  performedAtOptions,
  reportAccessOptions,
  reportDeliveryChannels,
  required,
  sampleTypes,
  section,
  sub,
  testCategories,
} from './options';
import type { ProviderTypeDefinition } from './types';

/**
 * Section 8 of docs/field-spec.md (Diagnostic Centre Partner Agreement clauses
 * 3-8, 14, 17 and Schedules A, B, C).
 *
 * Licences (establishment, NABL, PC-PNDT, AERB, BMW) are `provider_licences`
 * rows; the test catalogue, workflow requests and data responsibilities are
 * `type_data`. Sex-determination tests are blocked by the generated schema.
 */

const licences = fieldsForSection('diagnostic_licences', '8.1');
const services = fieldsForSection('diagnostic_services', '8.2');
const homeCollection = fieldsForSection('diagnostic_home_collection', '8.4');
const data = fieldsForSection('diagnostic_data', '8.5');
const admin = fieldsForSection('diagnostic_admin', '8.2, 8.3');

export const diagnosticCentreDefinition: ProviderTypeDefinition = {
  providerType: 'diagnostic_centre',
  schemaVersion: 1,
  sections: [
    section('diagnostic_licences', 'Licences and regulatory verification', '8.1', [
      licences('dc_establishment', 'Establishment licence(s)', 'repeater', {
        requirement: required,
        storage: { kind: 'related', table: 'provider_licences', role: 'clinical_establishment' },
        items: [
          sub('number', 'Licence number', 'text', {
            requirement: required,
            validation: { maxLength: 80 },
          }),
          sub('authority', 'Authority', 'text', {
            requirement: required,
            validation: { maxLength: 160 },
          }),
          sub('status', 'Status', 'text', { requirement: required, validation: { maxLength: 60 } }),
          sub('valid_to', 'Valid to', 'date'),
          sub('document', 'Document', 'file', { requirement: required }),
        ],
      }),
      licences('dc_nabl_flag', 'NABL accredited?', 'boolean', {
        requirement: required,
        help: 'NABL is not mandatory. Claim only if the accreditation is valid.',
      }),
      licences('dc_nabl_details', 'NABL certificate', 'repeater', {
        requirement: 'conditional',
        condition: { field: 'dc_nabl_flag', op: 'isTrue' },
        conditionNote: 'Required when NABL accreditation is claimed.',
        storage: { kind: 'related', table: 'provider_licences', role: 'nabl' },
        items: [
          sub('number', 'Certificate number', 'text', {
            requirement: required,
            validation: { maxLength: 80 },
          }),
          sub('valid_to', 'Valid to', 'date'),
          sub('scope', 'Scope', 'text', { requirement: required, validation: { maxLength: 300 } }),
          sub('document', 'Document', 'file'),
        ],
        todo: 'The spec types this group as text, date and file without sub-keys; the structural sub-keys need confirmation.',
      }),
      licences('dc_pcpndt', 'PC-PNDT registration', 'text', {
        requirement: 'conditional',
        condition: { field: 'dc_services', op: 'includes', value: 'prenatal diagnostics' },
        conditionNote: 'Required for prenatal diagnostic facilities or activities.',
        storage: { kind: 'related', table: 'provider_licences', role: 'pcpndt' },
        validation: { maxLength: 120 },
      }),
      licences('dc_pcpndt_doc', 'PC-PNDT document', 'file', {
        requirement: 'conditional',
        condition: { field: 'dc_services', op: 'includes', value: 'prenatal diagnostics' },
        conditionNote: 'Required for prenatal diagnostic facilities or activities.',
        storage: { kind: 'related', table: 'provider_documents', role: 'pcpndt' },
      }),
      licences('dc_aerb', 'AERB permissions', 'repeater', {
        requirement: 'conditional',
        condition: { field: 'dc_services', op: 'includes', value: 'radiology' },
        storage: { kind: 'related', table: 'provider_licences', role: 'aerb' },
        conditionNote: 'Required for radiation equipment (X-ray, CT) — radiology services.',
        items: [
          sub('equipment', 'Equipment', 'text', {
            requirement: required,
            validation: { maxLength: 160 },
          }),
          sub('number', 'Permission number', 'text', {
            requirement: required,
            validation: { maxLength: 80 },
          }),
          sub('valid_to', 'Valid to', 'date'),
          sub('document', 'Document', 'file'),
        ],
      }),
      licences('dc_bmw', 'Biomedical waste authorisation / arrangement', 'text', {
        requirement: required,
        storage: { kind: 'related', table: 'provider_licences', role: 'biomedical_waste' },
        validation: { maxLength: 200 },
      }),
      licences('dc_bmw_doc', 'Biomedical waste document', 'file', {
        requirement: required,
        storage: { kind: 'related', table: 'provider_documents', role: 'biomedical_waste' },
      }),
      licences('dc_director', 'Medical / lab director', 'repeater', {
        requirement: required,
        items: [
          sub('name', 'Name', 'text', { requirement: required, validation: { maxLength: 160 } }),
          sub('qualification', 'Qualification', 'text', {
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
          sub('document', 'Document', 'file'),
        ],
      }),
      licences('dc_signatories', 'Qualified report signatories', 'repeater', {
        requirement: required,
        items: [
          sub('name', 'Name', 'text', { requirement: required, validation: { maxLength: 160 } }),
          sub('qualification', 'Qualification', 'text', {
            requirement: required,
            validation: { maxLength: 120 },
          }),
          sub('reg_no', 'Registration number', 'text', {
            requirement: required,
            validation: { maxLength: 60 },
          }),
          sub('tests', 'Tests / department', 'text', {
            requirement: required,
            validation: { maxLength: 200 },
          }),
        ],
      }),
      licences('dc_other_licences', 'Other licences', 'repeater', {
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
    ]),

    section('diagnostic_services', 'Services, workflow approvals and pricing', '8.2', [
      services('dc_services', 'Services offered', 'multiselect', {
        requirement: required,
        validation: { options: diagnosticServices },
      }),
      services('dc_home_collection', 'Home collection requested', 'boolean', {
        requirement: required,
      }),
      services('dc_highrisk_requests', 'Higher-risk workflows requested', 'multiselect', {
        validation: { options: diagnosticHighRiskWorkflows },
        help: 'Requests are captured; the workflows stay disabled until admin approves them.',
      }),
      services('dc_report_channel', 'Report delivery channel', 'select', {
        requirement: required,
        validation: { options: reportDeliveryChannels },
        help: 'CureNear does not host reports by default.',
      }),
      services('dc_tests', 'Test catalogue', 'repeater', {
        requirement: required,
        items: [
          sub('test_name', 'Test name', 'text', {
            requirement: required,
            validation: { maxLength: 160 },
          }),
          sub('test_code', 'Test code (internal)', 'text', { validation: { maxLength: 60 } }),
          sub('test_category', 'Category / department', 'select', {
            requirement: required,
            validation: { options: testCategories },
          }),
          sub('test_price', 'Price (INR)', 'money', { requirement: required }),
          sub('test_sample', 'Sample type', 'select', { validation: { options: sampleTypes } }),
          sub('test_prep', 'Preparation requirements', 'textarea', {
            requirement: required,
            validation: { maxLength: 500 },
          }),
          sub('test_tat', 'Expected turnaround time', 'text', {
            requirement: required,
            validation: { maxLength: 120 },
          }),
          sub('test_rx_required', 'Prescription required?', 'boolean', { requirement: required }),
          sub('test_performed_at', 'Where performed', 'select', {
            requirement: required,
            validation: { options: performedAtOptions },
          }),
          sub('test_perf_lab', 'Performing laboratory and accreditation', 'text', {
            requirement: 'conditional',
            condition: { field: 'test_performed_at', op: 'notEquals', value: 'on site' },
            conditionNote: 'Required when the test is outsourced.',
            validation: { maxLength: 200 },
          }),
          sub('test_home', 'Home collection available', 'boolean', {
            requirement: 'conditional',
            condition: { field: 'dc_home_collection', op: 'isTrue' },
            conditionNote: 'Only collected when home collection is offered (field-spec 8.3).',
          }),
        ],
      }),
      services('dc_packages', 'Packages', 'repeater', {
        items: [
          sub('name', 'Package name', 'text', {
            requirement: required,
            validation: { maxLength: 160 },
          }),
          sub('included_tests', 'Included tests', 'text', {
            requirement: required,
            validation: { maxLength: 500 },
          }),
          sub('price', 'Price (INR)', 'money', { requirement: required }),
          sub('validity', 'Validity', 'text', { validation: { maxLength: 120 } }),
        ],
        todo: 'The spec lists package contents without keys; structural sub-keys need confirmation.',
      }),
      services('price_list_version', 'Price-list version', 'text', {
        requirement: required,
        validation: { maxLength: 40 },
      }),
      services('price_effective_from', 'Price effective from', 'date', {
        requirement: required,
      }),
    ]),

    section('diagnostic_home_collection', 'Home collection and patient communication', '8.4', [
      homeCollection('dc_collection_pins', 'Home collection PIN codes', 'pinlist', {
        requirement: 'conditional',
        condition: { field: 'dc_home_collection', op: 'isTrue' },
        conditionNote: 'Required when home collection is requested.',
        storage: { kind: 'related', table: 'provider_service_pins', role: 'collection' },
      }),
      homeCollection('dc_collection_hours', 'Home collection hours', 'repeater', {
        requirement: 'conditional',
        condition: { field: 'dc_home_collection', op: 'isTrue' },
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
      homeCollection('dc_collection_charges', 'Home collection charges (INR)', 'money', {
        requirement: 'conditional',
        condition: { field: 'dc_home_collection', op: 'isTrue' },
      }),
      homeCollection(
        'dc_collector_decl',
        'Sample collectors trained and background-verified',
        'boolean',
        {
          requirement: 'conditional',
          condition: { field: 'dc_home_collection', op: 'isTrue' },
        },
      ),
      homeCollection('dc_booking_confirm', 'Booking confirmation method', 'select', {
        requirement: required,
        validation: { options: appointmentMethods },
      }),
      homeCollection('dc_support_phone', 'Patient support number', 'phone', {
        requirement: required,
      }),
      homeCollection('dc_cancel_policy', 'Cancellation / refund policy', 'textarea', {
        requirement: required,
        validation: { maxLength: 1000 },
      }),
      homeCollection('dc_sla', 'Service-level expectations', 'textarea', {
        validation: { maxLength: 1000 },
      }),
    ]),

    section('diagnostic_data', 'Data and security responsibilities', '8.5', [
      data('dc_data_categories', 'Data categories sent to CureNear', 'multiselect', {
        requirement: required,
        validation: { options: dataCategories },
        help: 'Default: booking data only.',
      }),
      data('dc_data_purpose', 'Purpose and legal basis / notice', 'textarea', {
        requirement: required,
        validation: { maxLength: 1000 },
      }),
      data('dc_data_recipients', 'Data recipients', 'text', { validation: { maxLength: 300 } }),
      data('dc_report_access', 'CureNear access to clinical reports', 'select', {
        requirement: required,
        validation: { options: reportAccessOptions },
        defaultValue: 'no',
        help: 'Default No unless separately approved; admin-controlled.',
      }),
      data('dc_subprocessors', 'Subprocessors', 'repeater', {
        items: [
          sub('name', 'Name', 'text', { requirement: required, validation: { maxLength: 160 } }),
          sub('purpose', 'Purpose', 'text', {
            requirement: required,
            validation: { maxLength: 200 },
          }),
        ],
        todo: 'The spec names the repeater without sub-keys; confirm which details are required per subprocessor.',
      }),
      data('dc_retention', 'Retention and deletion schedule', 'text', {
        validation: { maxLength: 300 },
      }),
      data('dc_rights_contact', 'Patient complaint and rights contact', 'repeater', {
        requirement: required,
        items: [
          sub('name', 'Name', 'text', { requirement: required, validation: { maxLength: 120 } }),
          sub('phone', 'Phone', 'phone', { requirement: required }),
          sub('email', 'Email', 'email'),
        ],
      }),
      data('dc_dpa_required', 'Separate data processing addendum required?', 'boolean'),
    ]),

    section(
      'diagnostic_admin',
      'Operational approvals and test review',
      '8.2, 8.3',
      [
        admin('dc_highrisk_status', 'Higher-risk workflow decisions', 'repeater', {
          adminOnly: true,
          defaultValue: [],
          help: 'Admin only. Providers request a workflow; the status is set here.',
          items: [
            sub('workflow', 'Workflow', 'select', {
              requirement: required,
              validation: { options: diagnosticHighRiskWorkflows },
            }),
            sub('status', 'Status', 'select', {
              requirement: required,
              validation: { options: ['requested', 'approved', 'not approved'] },
            }),
            sub('decided_at', 'Decided on', 'date'),
            sub('decided_by', 'Decided by', 'text', { validation: { maxLength: 160 } }),
          ],
          todo: 'The spec asks for a per-item status but not the decision fields; decided on/by mirror the audit trail.',
        }),
        admin('dc_test_review_flags', 'Test catalogue items flagged for review', 'repeater', {
          adminOnly: true,
          defaultValue: [],
          help: 'Set by the catalogue import for prenatal or otherwise sensitive tests.',
          items: [
            sub('test_name', 'Test name', 'text', {
              requirement: required,
              validation: { maxLength: 160 },
            }),
            sub('reason', 'Reason', 'text', {
              requirement: required,
              validation: { maxLength: 200 },
            }),
            sub('status', 'Review status', 'select', {
              requirement: required,
              validation: { options: ['pending review', 'approved', 'rejected'] },
            }),
          ],
        }),
      ],
      'Higher-risk workflows require affirmative operational approval (cl. 3); sex-determination tests are blocked outright (cl. 6).',
      { notInProviderForm: true },
    ),
  ],
};
