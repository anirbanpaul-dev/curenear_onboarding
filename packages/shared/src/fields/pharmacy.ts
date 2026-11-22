import {
  courierMethods,
  fieldsForSection,
  pharmacistQualifications,
  pharmacyCategories,
  pharmacyRestrictedCategories,
  required,
  scheduleFlagOptions,
  section,
  stockUpdateMethods,
  sub,
} from './options';
import type { ProviderTypeDefinition } from './types';

/**
 * Section 7 of docs/field-spec.md (Pharmacy Partner Agreement clauses 4-11, 14,
 * 19 and Schedules A, B, C).
 *
 * Premises is a `provider_locations` row, drug licences are
 * `provider_licences` rows, delivery coverage is `provider_service_pins`; the
 * rest is `type_data`. Online sale stays disabled (section 7.5): interest is
 * captured, the admin switches live in their own hidden section.
 */

const premises = fieldsForSection('pharmacy_premises', '7.1');
const pharmacists = fieldsForSection('pharmacy_pharmacists', '7.2');
const fulfilment = fieldsForSection('pharmacy_fulfilment', '7.3');
const declarations = fieldsForSection('pharmacy_declarations', '7.4');
const admin = fieldsForSection('pharmacy_admin', '7.5');

export const pharmacyDefinition: ProviderTypeDefinition = {
  providerType: 'pharmacy',
  schemaVersion: 1,
  sections: [
    section('pharmacy_premises', 'Licences and premises', '7.1', [
      premises('ph_premises', 'Licensed premises address', 'address', {
        requirement: required,
        storage: { kind: 'related', table: 'provider_locations', role: 'primary' },
        help: 'Must match the licence.',
      }),
      premises('ph_licences', 'Drug licence(s)', 'repeater', {
        requirement: required,
        storage: { kind: 'related', table: 'provider_licences', role: 'drug_licence' },
        items: [
          sub('number', 'Licence number', 'text', {
            requirement: required,
            validation: { maxLength: 80 },
          }),
          sub('form_type', 'Form type(s) as printed', 'text', {
            requirement: required,
            validation: { maxLength: 120 },
          }),
          sub('authority', 'Licensing authority', 'text', {
            requirement: required,
            validation: { maxLength: 160 },
          }),
          sub('scope', 'Scope (retail/wholesale, categories)', 'text', {
            requirement: required,
            validation: { maxLength: 200 },
          }),
          sub('issue_date', 'Issue date', 'date'),
          sub('valid_to', 'Valid to', 'date', { requirement: required }),
          sub('document', 'Document', 'file', { requirement: required }),
        ],
      }),
      premises('ph_licence_retention_doc', 'Licence retention / validity evidence', 'file', {
        storage: { kind: 'related', table: 'provider_documents', role: 'licence_retention' },
      }),
      premises('ph_authorized_person', 'Authorized person named on licence', 'text', {
        requirement: required,
        validation: { maxLength: 160 },
      }),
      premises('ph_sched_flags', 'Schedule permissions', 'multiselect', {
        requirement: required,
        validation: { options: scheduleFlagOptions },
      }),
      premises('ph_cold_chain', 'Cold-chain products handled?', 'boolean', {
        requirement: required,
      }),
      premises('ph_fssai', 'FSSAI (if food/nutrition products sold)', 'text', {
        requirement: 'conditional',
        condition: { field: 'ph_categories', op: 'includes', value: 'nutrition and food' },
        storage: { kind: 'related', table: 'provider_licences', role: 'fssai' },
        conditionNote: 'Required when nutrition or food products are sold (field-spec 7.1).',
        validation: { maxLength: 40 },
        todo: 'The spec gives this field two types (text and file) and no condition; modelled as text with the certificate as a licence document.',
      }),
      premises('ph_fssai_doc', 'FSSAI document', 'file', {
        requirement: 'conditional',
        condition: { field: 'ph_categories', op: 'includes', value: 'nutrition and food' },
        storage: { kind: 'related', table: 'provider_documents', role: 'fssai' },
        conditionNote: 'Required when nutrition or food products are sold (field-spec 7.1).',
      }),
    ]),

    section('pharmacy_pharmacists', 'Registered pharmacist', '7.2', [
      pharmacists('ph_pharmacists', 'Registered pharmacists (at least one)', 'repeater', {
        requirement: required,
        items: [
          sub('name', 'Name', 'text', { requirement: required, validation: { maxLength: 160 } }),
          sub('qualification', 'Qualification', 'select', {
            requirement: required,
            validation: { options: pharmacistQualifications },
          }),
          sub('reg_no', 'Registration number', 'text', {
            requirement: required,
            validation: { maxLength: 60 },
          }),
          sub('council', 'State Pharmacy Council', 'text', {
            requirement: required,
            validation: { maxLength: 160 },
          }),
          sub('valid_to', 'Valid to', 'date'),
          sub('document', 'Certificate', 'file', { requirement: required }),
          sub('mobile', 'Mobile', 'phone', { requirement: required }),
        ],
      }),
      pharmacists('ph_pharmacist_ft', 'Pharmacist works full time at this premises', 'boolean', {
        requirement: required,
        todo: 'The spec marks this "inferred" from the legally required supervision; confirm it is a question worth asking.',
      }),
    ]),

    section('pharmacy_fulfilment', 'Products, ordering and fulfilment', '7.3', [
      fulfilment('ph_categories', 'Permitted product categories', 'multiselect', {
        requirement: required,
        validation: { options: pharmacyCategories },
      }),
      fulfilment('ph_restricted', 'Restricted categories handled', 'multiselect', {
        requirement: required,
        validation: { options: pharmacyRestrictedCategories },
        help: 'Admins may block categories pending legal review.',
      }),
      fulfilment('ph_rx_process', 'Prescription review and dispensing process', 'textarea', {
        requirement: required,
        validation: { maxLength: 1000 },
      }),
      fulfilment('ph_stock_method', 'Stock / availability update method', 'select', {
        validation: { options: stockUpdateMethods },
      }),
      fulfilment('ph_delivery', 'Delivery offered', 'boolean', { requirement: required }),
      fulfilment('ph_delivery_pins', 'Delivery PIN codes', 'pinlist', {
        requirement: 'conditional',
        condition: { field: 'ph_delivery', op: 'isTrue' },
        conditionNote: 'Required when delivery is offered.',
        storage: { kind: 'related', table: 'provider_service_pins', role: 'delivery' },
      }),
      fulfilment('ph_delivery_hours', 'Delivery hours', 'repeater', {
        requirement: 'conditional',
        condition: { field: 'ph_delivery', op: 'isTrue' },
        conditionNote: 'Required when delivery is offered.',
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
      fulfilment(
        'ph_service_standards',
        'Service standards (delivery time, packaging)',
        'textarea',
        {
          requirement: 'conditional',
          condition: { field: 'ph_delivery', op: 'isTrue' },
          validation: { maxLength: 1000 },
        },
      ),
      fulfilment('ph_courier', 'Delivery method', 'select', {
        requirement: 'conditional',
        condition: { field: 'ph_delivery', op: 'isTrue' },
        validation: { options: courierMethods },
      }),
      fulfilment('ph_courier_details', 'Courier details', 'repeater', {
        requirement: 'conditional',
        condition: { field: 'ph_delivery', op: 'isTrue' },
        items: [
          sub('name', 'Courier name', 'text', {
            requirement: required,
            validation: { maxLength: 160 },
          }),
          sub('insurance', 'Insurance', 'text', { validation: { maxLength: 200 } }),
          sub('data_access_terms', 'Data access terms', 'text', { validation: { maxLength: 300 } }),
        ],
      }),
      fulfilment('ph_delivery_charges', 'Delivery charges', 'text', {
        requirement: 'conditional',
        condition: { field: 'ph_delivery', op: 'isTrue' },
        help: 'Must be disclosed to patients.',
        validation: { maxLength: 300 },
      }),
      fulfilment('ph_dpco_decl', 'Price control (DPCO) compliance declaration', 'boolean', {
        requirement: required,
      }),
      fulfilment('ph_returns_policy', 'Returns, refunds, cancellation policy', 'textarea', {
        requirement: required,
        validation: { maxLength: 1000 },
      }),
      fulfilment('ph_pv_contact', 'Pharmacovigilance / adverse event contact', 'repeater', {
        items: [
          sub('name', 'Name', 'text', { requirement: required, validation: { maxLength: 120 } }),
          sub('phone', 'Phone', 'phone', { requirement: required }),
          sub('email', 'Email', 'email'),
        ],
      }),
    ]),

    section('pharmacy_declarations', 'Pharmacy declarations and online interest', '7.4', [
      declarations(
        'decl_ph_quality',
        'No expired, counterfeit, spurious or recalled medicines',
        'boolean',
        {
          requirement: required,
        },
      ),
      declarations(
        'decl_ph_sourcing',
        'Lawful sourcing and statutory records maintained',
        'boolean',
        {
          requirement: required,
        },
      ),
      declarations(
        'decl_ph_blocking',
        'CureNear may block categories pending legal review',
        'boolean',
        {
          requirement: required,
        },
      ),
      declarations(
        'decl_ph_no_online_sale',
        'No general online-sale authorisation is implied',
        'boolean',
        {
          requirement: required,
        },
      ),
      declarations('ph_online_interest', 'Interested in receiving online orders?', 'boolean', {
        help: 'Interest only. Online orders stay disabled until the client decides.',
      }),
    ]),

    section(
      'pharmacy_admin',
      'Online sale switches',
      '7.5',
      [
        admin('ph_online_enabled', 'Online orders enabled', 'boolean', {
          adminOnly: true,
          defaultValue: false,
          help: 'Admin only. Default false until the client decides.',
        }),
        admin('ph_online_categories', 'Categories enabled for online orders', 'multiselect', {
          adminOnly: true,
          defaultValue: [],
          help: 'Admin only. Empty until the client decides.',
        }),
      ],
      'The client has not decided which categories or prescription workflows will be enabled. Everything stays disabled.',
      { notInProviderForm: true },
    ),
  ],
};
