import type { ProviderType } from '../enums';

/**
 * Field registry types — the executable copy of docs/field-spec.md for the
 * normalized provider model.
 *
 * Common data goes into relational columns (`provider_organizations`,
 * `provider_locations`, `provider_contacts`, ...). Everything that only exists
 * for one provider type goes into `type_data` JSONB and is validated by the
 * generated Zod schema. `storage` says where a field lives, so the same
 * definition drives the form, the JSON schema and the document checklist.
 */

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'secret'
  | 'email'
  | 'phone'
  | 'url'
  | 'number'
  | 'money'
  | 'date'
  | 'time'
  | 'select'
  | 'multiselect'
  | 'boolean'
  | 'file'
  | 'address'
  | 'pin'
  | 'pinlist'
  | 'geo'
  | 'repeater';

/** `required` = always, `optional` = never, `conditional` = only when `condition` holds. */
export type FieldRequirement = 'required' | 'optional' | 'conditional';

export type ConditionExpr =
  | { field: string; op: 'equals' | 'notEquals'; value: string | boolean }
  | { field: string; op: 'includes'; value: string }
  | { field: string; op: 'isTrue' | 'isFalse' | 'isPresent' }
  | { all: ConditionExpr[] }
  | { any: ConditionExpr[] };

export interface FieldValidation {
  maxLength?: number;
  minLength?: number;
  /** Allowed values for `select` and `multiselect`. */
  options?: readonly string[];
  min?: number;
  max?: number;
  integer?: boolean;
  /** Anchored regular expression source, applied to trimmed input. */
  pattern?: string;
}

/** Tables the registry can point a field at, besides `type_data`. */
export type RelatedTable =
  | 'provider_organizations'
  | 'provider_locations'
  | 'provider_service_pins'
  | 'provider_contacts'
  | 'provider_licences'
  | 'provider_insurance'
  | 'provider_documents'
  | 'doctor_profiles'
  | 'doctor_locations'
  | 'users'
  | 'auth';

export type FieldStorage =
  | { kind: 'type_data' }
  | {
      kind: 'column';
      /** Column on `provider_organizations`, or `table.column` for another table. */
      column: string;
    }
  | { kind: 'related'; table: RelatedTable; role?: string };

export interface ProviderSubField {
  key: string;
  label: string;
  type: FieldKind;
  requirement?: FieldRequirement;
  validation?: FieldValidation;
  help?: string;
  /** Sub-field condition, evaluated against the parent row plus its section values. */
  condition?: ConditionExpr;
  /** Human-readable reading of a conditional sub-field's condition. */
  conditionNote?: string;
  /** Set when the spec is ambiguous; mirrored in docs/open-questions.md. */
  todo?: string;
  /** Nested repeating group (for example staff registrations inside a category). */
  items?: readonly ProviderSubField[];
}

export interface ProviderField {
  key: string;
  label: string;
  type: FieldKind;
  requirement: FieldRequirement;
  /** Only meaningful when `requirement` is `conditional`. */
  condition?: ConditionExpr;
  /** Human-readable reading of the condition, for the form and the docs. */
  conditionNote?: string;
  validation?: FieldValidation;
  help?: string;
  /** Section key this field is rendered in. */
  section: string;
  /** Agreement clause or schedule the field comes from (for example `Doctor 4.1`). */
  clause: string;
  storage: FieldStorage;
  /** Entity-level fields that do not apply to these types (spec 3.2 note). */
  excludedFor?: readonly ProviderType[];
  /** Admin-filled field: present in the registry, hidden from the provider form. */
  adminOnly?: boolean;
  /** Value written when the provider record is created (registry-owned defaults). */
  defaultValue?: unknown;
  /** Sub-fields; only for `repeater` and `address`. */
  items?: readonly ProviderSubField[];
  /** Set when the spec is ambiguous; mirrored in docs/open-questions.md. */
  todo?: string;
}

export interface ProviderSection {
  key: string;
  title: string;
  description?: string;
  clause: string;
  fields: readonly ProviderField[];
  /** Account/login and admin sections are registry data but not part of the provider form. */
  notInProviderForm?: boolean;
}

export interface ProviderTypeDefinition {
  providerType: ProviderType;
  /** Version of the generated `type_data` schema; stored on every organization. */
  schemaVersion: number;
  sections: readonly ProviderSection[];
}

/** A document the provider must upload, derived from the registry's file fields. */
export interface DocumentRequirement {
  key: string;
  label: string;
  requirement: FieldRequirement;
  section: string;
  clause: string;
  conditionNote?: string;
  todo?: string;
}
