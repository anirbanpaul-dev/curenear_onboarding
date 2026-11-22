import {
  evaluateCondition,
  type ProviderField,
  type ProviderSection,
  type ProviderType,
} from '@curenear/shared';
import type { OrganizationDto } from '@/lib/types';

/**
 * Turns a provider organization into the values a section form edits. Only
 * columns and `type_data` live here; related rows (locations, contacts, ...)
 * have their own editors.
 */

const organizationColumns: Record<string, keyof OrganizationDto> = {
  legal_name: 'legalName',
  trade_name: 'tradeName',
  constitution_type: 'constitutionType',
  registration_number: 'registrationNumber',
  established_on: 'establishedOn',
  website: 'website',
  email: 'email',
  mobile: 'mobile',
  primary_pin_code: 'primaryPinCode',
};

function readPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value && typeof value === 'object') return (value as Record<string, unknown>)[key];
    return undefined;
  }, source);
}

export function readColumn(organization: OrganizationDto, column: string): unknown {
  if (column.startsWith('profile_data.')) {
    return readPath(organization.profileData, column.slice('profile_data.'.length));
  }
  if (column.startsWith('publication_consents.')) {
    return readPath(organization.publicationConsents, column.slice('publication_consents.'.length));
  }
  const key = column.startsWith('provider_organizations.')
    ? column.slice('provider_organizations.'.length)
    : column;
  const field = organizationColumns[key];
  return field ? organization[field] : undefined;
}

function displayValue(field: ProviderField, value: unknown): unknown {
  // Money is stored as integer paise; the form works in rupees and the API
  // converts back on save.
  if (field.type === 'money' && typeof value === 'number') return value / 100;
  if (field.type === 'date' && typeof value === 'string') return value.slice(0, 10);
  return value;
}

export function initialSectionValues(
  section: ProviderSection,
  organization: OrganizationDto,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of section.fields) {
    if (field.storage.kind === 'related' || field.adminOnly) continue;
    const value =
      field.storage.kind === 'type_data'
        ? organization.typeData[field.key]
        : readColumn(organization, field.storage.column);
    if (value !== undefined) values[field.key] = displayValue(field, value);
  }
  return values;
}

/** Values from every editable section, used to evaluate cross-section conditions. */
export function allSectionValues(
  sections: readonly ProviderSection[],
  organization: OrganizationDto,
): Record<string, unknown> {
  return sections.reduce<Record<string, unknown>>(
    (values, section) => ({ ...values, ...initialSectionValues(section, organization) }),
    {},
  );
}

export function isFieldVisible(
  field: ProviderField,
  values: Record<string, unknown>,
  providerType: ProviderType,
): boolean {
  if (field.adminOnly) return false;
  if (field.excludedFor?.includes(providerType)) return false;
  if (field.requirement === 'conditional' && field.condition) {
    return evaluateCondition(field.condition, values);
  }
  return true;
}

export function isFieldRequired(field: ProviderField, values: Record<string, unknown>): boolean {
  if (field.requirement === 'required') return true;
  return Boolean(
    field.requirement === 'conditional' &&
    field.condition &&
    evaluateCondition(field.condition, values),
  );
}

export function visibleSectionFields(
  section: ProviderSection,
  values: Record<string, unknown>,
  providerType: ProviderType,
): ProviderField[] {
  return section.fields.filter(
    (field) =>
      field.storage.kind !== 'related' &&
      !field.adminOnly &&
      isFieldVisible(field, values, providerType),
  );
}

export function missingRequired(
  fields: readonly ProviderField[],
  values: Record<string, unknown>,
): string[] {
  return fields
    .filter((field) => isFieldRequired(field, values))
    .filter((field) => {
      const value = values[field.key];
      if (value === undefined || value === null) return true;
      if (typeof value === 'string') return value.trim() === '';
      if (Array.isArray(value)) return value.length === 0;
      return false;
    })
    .map((field) => field.key);
}
