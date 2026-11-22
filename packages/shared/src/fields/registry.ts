import { providerTypes, type ProviderType } from '../enums';
import { commonFieldSections } from './common';
import { doctorDefinition } from './doctor';
import { clinicDefinition } from './clinic';
import { pharmacyDefinition } from './pharmacy';
import { diagnosticCentreDefinition } from './diagnostic-centre';
import { careProviderDefinition } from './care-provider';
import type {
  ConditionExpr,
  DocumentRequirement,
  FieldRequirement,
  ProviderField,
  ProviderSection,
  ProviderSubField,
  ProviderTypeDefinition,
} from './types';

/**
 * Per-type registries assembled with the common sections. Everything the portal
 * renders, validates and asks the provider to upload comes from here.
 */

const definitions: Record<ProviderType, ProviderTypeDefinition> = {
  doctor: doctorDefinition,
  clinic: clinicDefinition,
  pharmacy: pharmacyDefinition,
  diagnostic_centre: diagnosticCentreDefinition,
  care_provider: careProviderDefinition,
};

export function providerDefinition(providerType: ProviderType): ProviderTypeDefinition {
  return definitions[providerType];
}

export function schemaVersionFor(providerType: ProviderType): number {
  return definitions[providerType].schemaVersion;
}

/** Common sections first, then the type-specific ones. */
export function sectionsForProvider(providerType: ProviderType): ProviderSection[] {
  return [...commonFieldSections(), ...definitions[providerType].sections];
}

/** Fields whose value is stored in `provider_organizations.type_data`. */
export function typeDataFieldsFor(providerType: ProviderType): ProviderField[] {
  return sectionsForProvider(providerType)
    .flatMap((section) => section.fields)
    .filter((field) => field.storage.kind === 'type_data');
}

export function allFieldsForProvider(providerType: ProviderType): ProviderField[] {
  return sectionsForProvider(providerType).flatMap((section) => section.fields);
}

export function fieldByKey(providerType: ProviderType, key: string): ProviderField | undefined {
  return allFieldsForProvider(providerType).find((field) => field.key === key);
}

/** Fields only an administrator may write (for example the online-sale switches). */
export function adminOnlyFieldsFor(providerType: ProviderType): ProviderField[] {
  return allFieldsForProvider(providerType).filter(
    (field) => field.adminOnly && field.storage.kind === 'type_data',
  );
}

/**
 * `type_data` without the fields only an administrator may see or write.
 * Staff-facing responses pass through this; the admin directory does not, so
 * the online-sale switches and high-risk flags stay on the admin screens.
 */
export function stripAdminOnlyTypeData(
  providerType: ProviderType,
  typeData: Record<string, unknown>,
): Record<string, unknown> {
  const hidden = new Set(adminOnlyFieldsFor(providerType).map((field) => field.key));
  if (hidden.size === 0) return typeData;
  return Object.fromEntries(Object.entries(typeData).filter(([key]) => !hidden.has(key)));
}

/**
 * Registry-owned defaults for `type_data`, written when a provider is created so
 * an unset switch is never undefined (pharmacy online sale defaults to false).
 */
export function typeDataDefaultsFor(providerType: ProviderType): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const field of typeDataFieldsFor(providerType)) {
    if (field.defaultValue === undefined) continue;
    defaults[field.key] = Array.isArray(field.defaultValue)
      ? [...field.defaultValue]
      : field.defaultValue;
  }
  return defaults;
}

export function allDefinitions(): Record<ProviderType, ProviderTypeDefinition> {
  return definitions;
}

export const registryProviderTypes: readonly ProviderType[] = providerTypes;

/** Evaluates a condition against a `type_data` payload. */
export function evaluateCondition(
  condition: ConditionExpr,
  data: Record<string, unknown>,
): boolean {
  if ('all' in condition) return condition.all.every((entry) => evaluateCondition(entry, data));
  if ('any' in condition) return condition.any.some((entry) => evaluateCondition(entry, data));

  const value = data[condition.field];
  switch (condition.op) {
    case 'equals':
      return value === condition.value;
    case 'notEquals':
      return value !== condition.value;
    case 'includes':
      return Array.isArray(value) && value.includes(condition.value);
    case 'isTrue':
      return value === true;
    case 'isFalse':
      return value === false;
    case 'isPresent':
      return value !== undefined && value !== null && value !== '';
    default:
      return false;
  }
}

function isRequiredForAll(requested: FieldRequirement): boolean {
  return requested === 'required';
}

function collectDocuments(
  fields: readonly ProviderField[],
  sectionKey: string,
  output: DocumentRequirement[],
): void {
  for (const field of fields) {
    if (field.storage.kind === 'related' && field.storage.table === 'provider_documents') {
      output.push({
        key: field.key,
        label: field.label,
        requirement: field.requirement,
        section: sectionKey,
        clause: field.clause,
        ...(field.conditionNote ? { conditionNote: field.conditionNote } : {}),
        ...(field.todo ? { todo: field.todo } : {}),
      });
    }
    // A licence/insurance repeater carries its own document sub-field.
    if (
      field.storage.kind === 'related' &&
      (field.storage.table === 'provider_licences' ||
        field.storage.table === 'provider_insurance') &&
      field.items
    ) {
      for (const item of field.items) {
        if (item.type !== 'file') continue;
        output.push({
          key: `${field.key}.${item.key}`,
          label: `${field.label}: ${item.label}`,
          requirement: item.requirement ?? field.requirement,
          section: sectionKey,
          clause: field.clause,
        });
      }
    }
    if (field.type === 'file' && field.storage.kind === 'type_data') {
      output.push({
        key: field.key,
        label: field.label,
        requirement: field.requirement,
        section: sectionKey,
        clause: field.clause,
        ...(field.conditionNote ? { conditionNote: field.conditionNote } : {}),
        ...(field.todo ? { todo: field.todo } : {}),
      });
    }
  }
}

/** The document checklist the provider sees for its type, derived from the registry. */
export function documentRequirementsFor(providerType: ProviderType): DocumentRequirement[] {
  const output: DocumentRequirement[] = [];
  for (const section of sectionsForProvider(providerType)) {
    collectDocuments(section.fields, section.key, output);
  }
  return output;
}

/** Sections the UI renders, with fields excluded for this provider type removed. */
export function formSectionsFor(providerType: ProviderType): ProviderSection[] {
  return sectionsForProvider(providerType)
    .map((section) => ({
      ...section,
      fields: section.fields.filter((field) => !(field.excludedFor ?? []).includes(providerType)),
    }))
    .filter((section) => section.fields.length > 0);
}

/** Every key the registry knows, for the spec checker. */
export function registryKeysFor(providerType: ProviderType): {
  fields: string[];
  subFields: string[];
} {
  const fields: string[] = [];
  const subFields: string[] = [];
  const walkSub = (items: readonly ProviderSubField[]): void => {
    for (const item of items) {
      subFields.push(item.key);
      if (item.items) walkSub(item.items);
    }
  };
  for (const field of allFieldsForProvider(providerType)) {
    fields.push(field.key);
    if (field.items) walkSub(field.items);
  }
  return { fields, subFields };
}

/** True when the field is mandatory for this type regardless of other answers. */
export function isAlwaysRequiredFor(field: ProviderField, providerType: ProviderType): boolean {
  if ((field.excludedFor ?? []).includes(providerType)) return false;
  return isRequiredForAll(field.requirement) && !field.condition;
}
