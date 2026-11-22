import { defaultState, indianStates } from '../enums';
import {
  constitutionTypes,
  contactRoles,
  fieldsForSection,
  insuranceTypes,
  languages,
  locationTypes,
  optional,
  publishableFieldKeys,
  required,
  section,
  sub,
  type ContactRole,
} from './options';
import type { ProviderSection } from './types';

/**
 * Sections 3.1 – 3.9 of docs/field-spec.md: collected for every provider type.
 *
 * Storage: the account and legal-entity fields are columns on
 * `provider_organizations`; the registered office and the branches are rows in
 * `provider_locations`; contacts and insurance have their own tables; the public
 * profile and the declarations are JSONB documents.
 */

const account = fieldsForSection('account', '3.1');
const legalEntity = fieldsForSection('legal_entity', '3.2');
const registeredOffice = fieldsForSection('registered_office', '3.3');
const locations = fieldsForSection('locations', '3.4');
const signatory = fieldsForSection('signatory', '3.5');
const contacts = fieldsForSection('contacts', '3.5a');
const insurance = fieldsForSection('insurance', '3.6');
const serviceArea = fieldsForSection('service_area', '3.7');
const publicProfile = fieldsForSection('public_profile', '3.8');
const declarations = fieldsForSection('declarations', '3.9');

const contactRepeater = (
  key: string,
  label: string,
  role: ContactRole,
  requirement: 'required' | 'optional' | 'conditional',
  help?: string,
) =>
  contacts(key, label, 'repeater', {
    requirement,
    storage: { kind: 'related', table: 'provider_contacts', role },
    help,
    items: [
      sub('name', 'Name', 'text', { requirement: 'required', validation: { maxLength: 120 } }),
      sub('phone', 'Phone', 'phone', { requirement: 'required' }),
      sub('email', 'Email', 'email'),
    ],
  });

const declaration = (key: string, label: string) =>
  declarations(key, label, 'boolean', {
    requirement: 'required',
    storage: { kind: 'column', column: `publication_consents.declarations.${key}` },
  });

export function commonFieldSections(): ProviderSection[] {
  return [
    section(
      'account',
      'Account and login',
      '3.1',
      [
        account('provider_type', 'Provider type', 'select', {
          requirement: required,
          storage: { kind: 'column', column: 'provider_organizations.provider_type' },
          validation: {
            options: ['doctor', 'clinic', 'pharmacy', 'diagnostic_centre', 'care_provider'],
          },
        }),
        account('registrant_name', 'Registrant full name', 'text', {
          requirement: required,
          storage: { kind: 'related', table: 'users' },
          validation: { maxLength: 160 },
          help: 'The person creating the account.',
        }),
        account('mobile', 'Mobile number', 'phone', {
          requirement: required,
          storage: { kind: 'column', column: 'provider_organizations.mobile' },
          help: 'OTP verified.',
        }),
        account('email', 'Email', 'email', {
          requirement: required,
          storage: { kind: 'column', column: 'provider_organizations.email' },
          help: 'Verified by link; also used as the legal notice email.',
        }),
        account('auth_secret', 'Password or OTP login', 'secret', {
          requirement: required,
          storage: { kind: 'related', table: 'auth' },
        }),
        account('portal_terms_accepted', 'Terms of Use / Privacy Notice accepted', 'boolean', {
          requirement: required,
          storage: { kind: 'column', column: 'publication_consents.portal_terms_accepted' },
        }),
      ],
      'Handled by authentication; not part of the provider onboarding form.',
      { notInProviderForm: true },
    ),

    section(
      'legal_entity',
      'Legal entity details',
      '3.2',
      [
        legalEntity('legal_name', 'Legal name', 'text', {
          requirement: required,
          excludedFor: ['doctor'],
          storage: { kind: 'column', column: 'provider_organizations.legal_name' },
          validation: { maxLength: 200 },
        }),
        legalEntity('trade_name', 'Trade / display name', 'text', {
          requirement: required,
          excludedFor: ['doctor'],
          storage: { kind: 'column', column: 'provider_organizations.trade_name' },
          validation: { maxLength: 200 },
        }),
        legalEntity('constitution_type', 'Constitution type', 'select', {
          requirement: required,
          excludedFor: ['doctor'],
          storage: { kind: 'column', column: 'provider_organizations.constitution_type' },
          validation: { options: constitutionTypes },
        }),
        legalEntity(
          'registration_number',
          'Registration number (CIN / LLPIN / partnership)',
          'text',
          {
            requirement: 'conditional',
            excludedFor: ['doctor'],
            condition: { field: 'constitution_type', op: 'notEquals', value: 'individual' },
            conditionNote:
              'Required unless the provider is an individual; not required for doctors.',
            storage: { kind: 'column', column: 'provider_organizations.registration_number' },
            validation: { maxLength: 60 },
          },
        ),
        legalEntity('established_on', 'Date of incorporation / establishment', 'date', {
          storage: { kind: 'column', column: 'provider_organizations.established_on' },
        }),
        legalEntity('website', 'Website', 'url', {
          storage: { kind: 'column', column: 'provider_organizations.website' },
          validation: { maxLength: 300 },
        }),
      ],
      'Doctor entities are individuals; only the Doctor section identity applies.',
    ),

    section(
      'registered_office',
      'Registered office address',
      '3.3',
      [
        registeredOffice('reg_addr_line1', 'Address line 1', 'text', {
          requirement: required,
          storage: { kind: 'related', table: 'provider_locations', role: 'primary' },
          validation: { maxLength: 200 },
        }),
        registeredOffice('reg_addr_line2', 'Address line 2', 'text', {
          storage: { kind: 'related', table: 'provider_locations', role: 'primary' },
          validation: { maxLength: 200 },
        }),
        registeredOffice('reg_landmark', 'Landmark', 'text', {
          storage: { kind: 'related', table: 'provider_locations', role: 'primary' },
          validation: { maxLength: 120 },
        }),
        registeredOffice('reg_city', 'City / town', 'text', {
          requirement: required,
          storage: { kind: 'related', table: 'provider_locations', role: 'primary' },
          validation: { maxLength: 120 },
        }),
        registeredOffice('reg_district', 'District', 'text', {
          requirement: required,
          storage: { kind: 'related', table: 'provider_locations', role: 'primary' },
          validation: { maxLength: 120 },
        }),
        registeredOffice('reg_state', 'State', 'select', {
          requirement: required,
          storage: { kind: 'related', table: 'provider_locations', role: 'primary' },
          validation: { options: indianStates },
          help: `Defaults to ${defaultState}.`,
        }),
        registeredOffice('reg_pin', 'PIN code', 'pin', {
          requirement: required,
          storage: { kind: 'related', table: 'provider_locations', role: 'primary' },
          help: 'Copied to provider_organizations.primary_pin_code.',
        }),
      ],
      'Stored as the primary provider_locations row; the PIN is denormalized onto the organization.',
    ),

    section(
      'locations',
      'Locations / branches',
      '3.4',
      [
        locations('locations', 'Locations', 'repeater', {
          requirement: required,
          storage: { kind: 'related', table: 'provider_locations' },
          help: 'At least one. Pharmacy: one location per licensed premises.',
          items: [
            sub('loc_name', 'Location name', 'text', {
              requirement: required,
              validation: { maxLength: 160 },
            }),
            sub('loc_type', 'Location type', 'select', {
              requirement: required,
              validation: { options: locationTypes },
            }),
            sub('loc_address', 'Address', 'address', { requirement: required }),
            sub('loc_pin', 'PIN code', 'pin', { requirement: required }),
            sub('loc_geo', 'Map pin', 'geo', { requirement: required }),
            sub('branch_ref', 'Branch ID (internal)', 'text', { validation: { maxLength: 60 } }),
            sub('loc_hours', 'Operating hours', 'repeater', {
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
                sub('open', 'Opens (HH:MM)', 'time'),
                sub('close', 'Closes (HH:MM)', 'time'),
                sub('closed', 'Closed all day', 'boolean'),
              ],
            }),
            sub('loc_booking_phone', 'Public booking / appointment phone', 'phone', {
              requirement: required,
            }),
            sub('loc_public', 'Publicly listed?', 'boolean', { requirement: required }),
          ],
        }),
      ],
      'One row per branch or licensed premises in provider_locations.',
    ),

    section('signatory', 'Authorized signatory', '3.5', [
      signatory('sig_name', 'Name', 'text', {
        requirement: required,
        storage: { kind: 'related', table: 'provider_contacts', role: 'signatory' },
        validation: { maxLength: 160 },
      }),
      signatory('sig_designation', 'Designation / capacity', 'text', {
        requirement: required,
        storage: { kind: 'related', table: 'provider_contacts', role: 'signatory' },
        validation: { maxLength: 120 },
      }),
      signatory('sig_mobile', 'Mobile', 'phone', {
        requirement: required,
        storage: { kind: 'related', table: 'provider_contacts', role: 'signatory' },
      }),
      signatory('sig_email', 'Email', 'email', {
        requirement: required,
        storage: { kind: 'related', table: 'provider_contacts', role: 'signatory' },
      }),
      signatory('sig_authority_doc', 'Authority document', 'file', {
        requirement: 'conditional',
        storage: { kind: 'related', table: 'provider_documents' },
        help: 'Board resolution, partnership authority or power of attorney. Not needed for individual doctors or sole proprietors.',
        condition: { field: 'constitution_type', op: 'notEquals', value: 'individual' },
        conditionNote: 'Required for entities; not for individuals or sole proprietors.',
        todo: 'The spec says "C" without naming the condition; the constitution-type rule is our reading.',
      }),
    ]),

    section(
      'contacts',
      'Designated contacts',
      '3.5a',
      [
        contactRepeater('contact_booking', 'Booking / orders contact', 'booking', required),
        contactRepeater(
          'contact_grievance',
          'Complaint / grievance officer',
          'grievance',
          required,
        ),
        contactRepeater(
          'contact_emergency',
          'Emergency / clinical incident escalation',
          'emergency',
          'conditional',
          'Mandatory for care providers, diagnostic centres and clinics; optional for doctors.',
        ),
        contactRepeater('contact_security', 'Data security / breach contact', 'security', required),
        contactRepeater('contact_billing', 'Billing / finance contact', 'billing', optional),
        contacts('notice_address', 'Legal notice address', 'address', {
          requirement: required,
          storage: { kind: 'related', table: 'provider_contacts', role: 'legal_notice' },
        }),
        contacts('notice_email', 'Legal notice email', 'email', {
          requirement: required,
          storage: { kind: 'related', table: 'provider_contacts', role: 'legal_notice' },
        }),
      ],
      'One row per role in provider_contacts; one person may fill several roles.',
    ),

    section('insurance', 'Insurance', '3.6', [
      insurance('ins_type', 'Insurance type', 'select', {
        requirement: 'conditional',
        storage: { kind: 'related', table: 'provider_insurance' },
        validation: { options: insuranceTypes },
      }),
      insurance('ins_insurer', 'Insurer', 'text', {
        requirement: 'conditional',
        storage: { kind: 'related', table: 'provider_insurance' },
        validation: { maxLength: 160 },
      }),
      insurance('ins_policy_no', 'Policy number', 'text', {
        requirement: 'conditional',
        storage: { kind: 'related', table: 'provider_insurance' },
        validation: { maxLength: 80 },
      }),
      insurance('ins_limit', 'Sum insured (INR)', 'money', {
        requirement: 'conditional',
        storage: { kind: 'related', table: 'provider_insurance' },
      }),
      insurance('ins_from', 'Valid from', 'date', {
        requirement: 'conditional',
        storage: { kind: 'related', table: 'provider_insurance' },
      }),
      insurance('ins_to', 'Valid to', 'date', {
        requirement: 'conditional',
        storage: { kind: 'related', table: 'provider_insurance' },
      }),
      insurance('ins_doc', 'Policy document', 'file', {
        requirement: 'conditional',
        storage: { kind: 'related', table: 'provider_documents' },
      }),
    ]),

    section('service_area', 'Service area', '3.7', [
      serviceArea('service_pins', 'Serviceable PIN codes', 'pinlist', {
        requirement: 'conditional',
        storage: { kind: 'related', table: 'provider_service_pins', role: 'service' },
        help: 'Required for pharmacy delivery, home collection and home care. Paste a list or upload a CSV.',
      }),
      serviceArea('offers_home_service', 'Home service / delivery offered', 'boolean', {
        requirement: 'conditional',
      }),
      serviceArea('service_area_notes', 'Service area notes', 'textarea', {
        validation: { maxLength: 1000 },
      }),
    ]),

    section(
      'public_profile',
      'Public profile and publication permission',
      '3.8',
      [
        publicProfile('profile_display_name', 'Display name', 'text', {
          requirement: required,
          storage: { kind: 'column', column: 'profile_data.display_name' },
          validation: { maxLength: 160 },
        }),
        publicProfile('profile_description', 'Short description (factual)', 'textarea', {
          requirement: required,
          storage: { kind: 'column', column: 'profile_data.description' },
          validation: { maxLength: 500 },
          help: 'No guaranteed-cure or superiority claims.',
        }),
        publicProfile('profile_logo', 'Logo', 'file', {
          storage: { kind: 'related', table: 'provider_documents', role: 'profile_logo' },
        }),
        publicProfile('profile_photos', 'Photographs', 'file', {
          storage: { kind: 'related', table: 'provider_documents', role: 'profile_photos' },
        }),
        publicProfile('profile_languages', 'Languages spoken', 'multiselect', {
          storage: { kind: 'column', column: 'profile_data.languages' },
          validation: { options: languages },
        }),
        publicProfile('consent_publish_photo', 'Publish photograph', 'boolean', {
          requirement: required,
          storage: { kind: 'column', column: 'publication_consents.consent_publish_photo' },
        }),
        publicProfile('profile_approved_on', 'Profile approved on', 'date', {
          storage: { kind: 'column', column: 'profile_data.approved_on' },
          adminOnly: true,
          help: 'Set by an administrator when the public profile is approved.',
        }),
        publicProfile('public_fields', 'Approved public fields', 'multiselect', {
          requirement: required,
          storage: { kind: 'column', column: 'publication_consents.public_fields' },
          validation: { options: publishableFieldKeys },
          help: 'Tick each field the provider approves for publication. Default is unticked.',
        }),
      ],
      'Only fields the provider approves may be published.',
    ),

    section(
      'declarations',
      'Declarations',
      '3.9',
      [
        declaration('decl_accuracy', 'All submitted information is accurate and complete'),
        declaration('decl_authority', 'I have authority to sign for this entity'),
        declaration('decl_licences', 'I hold all licences required for my actual activities'),
        declaration(
          'decl_notify_changes',
          'I will notify CureNear of regulatory changes within the deadline',
        ),
        declaration('decl_verification', 'I consent to credential verification with registries'),
        declaration(
          'decl_no_referral_incentive',
          'No unlawful referral commissions or fee-splitting',
        ),
        declaration('decl_no_misleading_claims', 'No guaranteed-cure or misleading claims'),
        declaration(
          'decl_privacy_ack',
          'I have read the Privacy Notice and understand the data roles',
        ),
      ],
      'All declarations are required. Version, timestamp, user and IP are recorded when accepted.',
    ),
  ];
}

/** Contact roles the registry uses, exported so services can validate rows. */
export const registryContactRoles = contactRoles;
