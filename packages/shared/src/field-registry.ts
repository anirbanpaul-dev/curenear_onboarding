import type { ProviderType } from './enums';
import {
  appointmentConfirmers,
  appointmentMethods,
  constitutionTypes,
  feeCollectionOptions,
  insuranceTypes,
  languages,
  locationTypes,
  medicalSpecialties,
  priceUnits,
  publishableFieldKeys,
  registrationCouncils,
  systemsOfMedicine,
} from './fields/options';
import { commonFieldSections } from './fields/common';
import { providerDefinition } from './fields/registry';
import type { ProviderField, ProviderSection, ProviderSubField } from './fields/types';

/**
 * Legacy form view of the field registry.
 *
 * `packages/shared/src/fields` is the single executable copy of
 * docs/field-spec.md. This module projects it into the `FieldDef`/`SectionDef`
 * shape the onboarding form and `provider-data.ts` were built on, so the two
 * registries cannot drift apart.
 *
 * Projection rules:
 * - `required` → `Y`, `conditional` → `C`, `optional` → `N`.
 * - `excludedFor` becomes `notRequiredFor`; the fields stay in the form (the
 *   portal shows them) but are not required for that provider type.
 * - `adminOnly` fields and `notInProviderForm` sections (login/account and the
 *   admin-only online-sale switches) are not part of the provider form.
 * - A `select` without an option list falls back to free text, and `secret`
 *   renders as text, because the legacy form has no credential input here.
 */

export type FieldType =
  | 'text'
  | 'textarea'
  | 'email'
  | 'phone'
  | 'url'
  | 'number'
  | 'money'
  | 'date'
  | 'pin'
  | 'pinlist'
  | 'select'
  | 'multiselect'
  | 'boolean'
  | 'file'
  | 'address'
  | 'geo'
  | 'repeater';

export type Requirement = 'Y' | 'N' | 'C';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  /** Y = mandatory on submit, N = optional, C = conditional (see decisions D6). */
  required: Requirement;
  /** Doctor entities are individuals, so entity-level fields are not mandatory for them. */
  notRequiredFor?: readonly ProviderType[];
  options?: readonly string[];
  maxLength?: number;
  /** Sub-fields for `repeater`. */
  items?: readonly FieldDef[];
  help?: string;
}

export interface SectionDef {
  key: string;
  title: string;
  description?: string;
  fields: readonly FieldDef[];
}

export {
  appointmentConfirmers,
  appointmentMethods,
  constitutionTypes,
  feeCollectionOptions,
  insuranceTypes,
  languages,
  locationTypes,
  medicalSpecialties,
  priceUnits,
  publishableFieldKeys,
  registrationCouncils,
  systemsOfMedicine,
};

function mapRequirement(requirement: ProviderField['requirement']): Requirement {
  if (requirement === 'required') return 'Y';
  if (requirement === 'conditional') return 'C';
  return 'N';
}

const legacyTypes: ReadonlySet<string> = new Set<FieldType>([
  'text',
  'textarea',
  'email',
  'phone',
  'url',
  'number',
  'money',
  'date',
  'pin',
  'pinlist',
  'select',
  'multiselect',
  'boolean',
  'file',
  'address',
  'geo',
  'repeater',
]);

function projectField(field: ProviderField): FieldDef {
  const options = field.validation?.options;
  let type = legacyTypes.has(field.type) ? (field.type as FieldType) : 'text';
  if (type === 'select' && (!options || options.length === 0)) type = 'text';

  return {
    key: field.key,
    label: field.label,
    type,
    required: mapRequirement(field.requirement),
    ...(field.excludedFor?.length ? { notRequiredFor: field.excludedFor } : {}),
    ...(options?.length ? { options } : {}),
    ...(field.validation?.maxLength ? { maxLength: field.validation.maxLength } : {}),
    ...(field.help ? { help: field.help } : {}),
    ...(field.items ? { items: field.items.map(projectSubField) } : {}),
  };
}

function projectSubField(item: ProviderSubField): FieldDef {
  const options = item.validation?.options;
  let type = legacyTypes.has(item.type) ? (item.type as FieldType) : 'text';
  if (type === 'select' && (!options || options.length === 0)) type = 'text';

  return {
    key: item.key,
    label: item.label,
    type,
    required:
      item.requirement === 'required' ? 'Y' : item.requirement === 'conditional' ? 'C' : 'N',
    ...(options?.length ? { options } : {}),
    ...(item.validation?.maxLength ? { maxLength: item.validation.maxLength } : {}),
    ...(item.help ? { help: item.help } : {}),
    ...(item.items ? { items: item.items.map(projectSubField) } : {}),
  };
}

function projectSection(section: ProviderSection): SectionDef {
  return {
    key: section.key,
    title: section.title,
    ...(section.description ? { description: section.description } : {}),
    fields: section.fields.filter((field) => !field.adminOnly).map(projectField),
  };
}

/** Sections 3.2 – 3.9: collected for every provider type. */
export function commonSections(): SectionDef[] {
  return commonFieldSections()
    .filter((section) => !section.notInProviderForm)
    .map(projectSection);
}

/** Common sections first, then the provider-type sections (field-spec 4–8). */
export function sectionsFor(providerType: ProviderType): SectionDef[] {
  const typeSections = providerDefinition(providerType)
    .sections.filter((section) => !section.notInProviderForm)
    .map(projectSection);
  return [...commonSections(), ...typeSections];
}

export function allFieldsFor(providerType: ProviderType): FieldDef[] {
  return sectionsFor(providerType).flatMap((section) => section.fields);
}

/** Field definitions whose value the provider may publish (used by the consent UI). */
export function publishableFieldsFor(providerType: ProviderType): FieldDef[] {
  const keys = new Set<string>(publishableFieldKeys);
  return allFieldsFor(providerType).filter((field) => keys.has(field.key));
}
