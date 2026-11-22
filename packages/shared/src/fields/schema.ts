import { z } from 'zod';
import { AppError } from '../errors';
import { providerTypes, type ProviderType } from '../enums';
import {
  evaluateCondition,
  fieldByKey,
  sectionsForProvider,
  allFieldsForProvider,
  typeDataFieldsFor,
  schemaVersionFor,
} from './registry';
import type { FieldValidation, ProviderField, ProviderSubField } from './types';
import { isSexDeterminationTest } from '../test-blocklist';
import {
  isoDateSchema,
  mobileSchema,
  pinCodeRegex,
  pinCodeSchema,
  rupeesToPaise,
  splitList,
} from '../utils';

/**
 * Generated `type_data` schemas.
 *
 * `draft` accepts partial payloads (save-as-draft); `submit` enforces every
 * field the registry marks `required` plus every `conditional` field whose
 * condition holds. Money arrives in rupees and is stored as integer paise;
 * pass `moneyFormat: 'paise'` when validating data read back from the database.
 */

export type TypeDataMode = 'draft' | 'submit';
export type TypeDataMoneyFormat = 'rupees' | 'paise';

export interface TypeDataOptions {
  mode?: TypeDataMode;
  moneyFormat?: TypeDataMoneyFormat;
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const allowedUploadMimeTypes = ['application/pdf', 'image/jpeg', 'image/png'] as const;

const optionalize = (value: unknown): unknown =>
  value === null || (typeof value === 'string' && value.trim() === '') ? undefined : value;

const optionsTuple = (options: readonly string[]): [string, ...string[]] =>
  options as unknown as [string, ...string[]];

function textField(
  field: ProviderField,
  validation: FieldValidation,
  required: boolean,
): z.ZodTypeAny {
  const max = validation.maxLength ?? 300;
  let base = z
    .string({
      required_error: `${field.label} is required`,
      invalid_type_error: `${field.label} must be text`,
    })
    .trim()
    .max(max, `${field.label} must be ${max} characters or fewer`);
  if (validation.minLength) {
    base = base.min(
      validation.minLength,
      `${field.label} needs at least ${validation.minLength} characters`,
    );
  }
  if (validation.pattern) {
    base = base.regex(
      new RegExp(validation.pattern),
      `${field.label} is not in the expected format`,
    );
  }
  return z.preprocess(
    optionalize,
    required ? base.min(1, `${field.label} is required`) : base.optional(),
  );
}

const dateSchema = z.preprocess(optionalize, isoDateSchema);

function moneySchema(
  field: ProviderField,
  format: TypeDataMoneyFormat,
  required: boolean,
): z.ZodTypeAny {
  const inner =
    format === 'paise'
      ? z
          .number({ invalid_type_error: `${field.label} must be stored as integer paise` })
          .int()
          .min(0, `${field.label} cannot be negative`)
      : z
          .union([z.string(), z.number()])
          .superRefine((value, ctx) => {
            if (rupeesToPaise(value) === null) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `${field.label} must be an amount in rupees with at most 2 decimals`,
              });
            }
          })
          .transform((value) => rupeesToPaise(value) ?? 0);
  return z.preprocess(optionalize, required ? inner : inner.optional());
}

function numberSchema(
  field: ProviderField,
  validation: FieldValidation,
  required: boolean,
): z.ZodTypeAny {
  let inner = z.coerce
    .number({ invalid_type_error: `${field.label} must be a number` })
    .min(validation.min ?? 0, `${field.label} cannot be below ${validation.min ?? 0}`);
  if (validation.integer !== false) inner = inner.int(`${field.label} must be a whole number`);
  if (validation.max !== undefined) {
    inner = inner.max(validation.max, `${field.label} cannot be above ${validation.max}`);
  }
  return z.preprocess(optionalize, required ? inner : inner.optional());
}

function booleanSchema(field: ProviderField, required: boolean): z.ZodTypeAny {
  const coerce = (value: unknown): unknown => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  };
  const inner = z.boolean({
    required_error: `${field.label} must be confirmed`,
    invalid_type_error: `${field.label} must be true or false`,
  });
  return z.preprocess((value) => coerce(optionalize(value)), required ? inner : inner.optional());
}

function pinListSchema(field: ProviderField, required: boolean): z.ZodTypeAny {
  const base = z
    .array(z.string().trim().regex(pinCodeRegex, `${field.label}: enter 6-digit PIN codes`), {
      invalid_type_error: `${field.label} must be a list of PIN codes`,
    })
    .max(500, `${field.label} supports up to 500 PIN codes`);
  const sized = required ? base.min(1, `${field.label} needs at least one PIN code`) : base;
  const deduped = sized.transform((values) => Array.from(new Set(values)));
  return z.preprocess(
    (value) => splitList(optionalize(value)),
    required ? deduped : deduped.optional(),
  );
}

function fileSchema(fieldLabel: string, required: boolean): z.ZodTypeAny {
  const object = z.object({
    fileName: z.string().trim().min(1).max(200),
    mimeType: z.enum(allowedUploadMimeTypes, {
      errorMap: () => ({ message: `${fieldLabel} must be a PDF, JPG or PNG` }),
    }),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(MAX_UPLOAD_BYTES, `${fieldLabel} must be 10 MB or smaller`),
    uploadedAt: z.string().datetime({ offset: true }),
    uploadedBy: z.string().uuid(),
  });
  return z.preprocess(optionalize, required ? object : object.optional());
}

function addressSchema(required: boolean): z.ZodTypeAny {
  const object = z.object({
    line1: z.string().trim().min(1, 'Address line 1 is required').max(200),
    line2: z.string().trim().max(200).optional(),
    landmark: z.string().trim().max(120).optional(),
    city: z.string().trim().min(1, 'City is required').max(120),
    district: z.string().trim().max(120).optional(),
    state: z.string().trim().min(1, 'State is required').max(120),
    pin: pinCodeSchema,
  });
  return z.preprocess(optionalize, required ? object : object.optional());
}

function geoSchema(required: boolean): z.ZodTypeAny {
  const object = z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
  });
  return z.preprocess(optionalize, required ? object : object.optional());
}

function subFieldSchema(
  sub: ProviderSubField,
  validation: FieldValidation,
  required: boolean,
  options: TypeDataOptions,
): z.ZodTypeAny {
  const label = sub.label;
  const field: ProviderField = {
    key: sub.key,
    label,
    type: sub.type,
    requirement: required ? 'required' : 'optional',
    section: '',
    clause: '',
    storage: { kind: 'type_data' },
    validation: sub.validation,
    items: sub.items,
  };
  return fieldSchema(field, validation, required, options);
}

function repeaterSchema(
  field: ProviderField,
  required: boolean,
  options: TypeDataOptions,
): z.ZodTypeAny {
  const items = field.items ?? [];
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const item of items) {
    const itemRequired = item.requirement === 'required';
    shape[item.key] = subFieldSchema(item, item.validation ?? {}, itemRequired, options);
  }
  let itemSchema = z.object(shape).strict();

  // Field-spec 8.3: never allow sex-determination tests in a catalogue.
  if (items.some((item) => item.key === 'test_name')) {
    itemSchema = itemSchema.superRefine((item, ctx) => {
      const name = (item as Record<string, unknown>).test_name;
      if (typeof name === 'string' && isSexDeterminationTest(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['test_name'],
          message: 'Sex-determination tests cannot be listed',
        });
      }
    }) as unknown as typeof itemSchema;
  }

  const base = z.array(itemSchema).max(100, `${field.label} supports up to 100 entries`);
  const inner = required ? base.min(1, `Add at least one entry to ${field.label}`) : base;
  return z.preprocess(optionalize, required ? inner : inner.optional());
}

function fieldSchema(
  field: ProviderField,
  validation: FieldValidation,
  required: boolean,
  options: TypeDataOptions,
): z.ZodTypeAny {
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'secret':
      return textField(field, validation, required);
    case 'email': {
      const base = z
        .string({ required_error: `${field.label} is required` })
        .trim()
        .email(`Enter a valid email for ${field.label}`)
        .max(200);
      return z.preprocess(optionalize, required ? base : base.optional());
    }
    case 'phone':
      return z.preprocess(optionalize, required ? mobileSchema : mobileSchema.optional());
    case 'url': {
      const base = z.string().trim().url(`Enter a valid URL for ${field.label}`).max(300);
      return z.preprocess(optionalize, required ? base : base.optional());
    }
    case 'select': {
      if (!validation.options || validation.options.length === 0) {
        return textField(field, validation, required);
      }
      const base = z.enum(optionsTuple(validation.options), {
        errorMap: () => ({ message: `Choose a valid option for ${field.label}` }),
      });
      return z.preprocess(optionalize, required ? base : base.optional());
    }
    case 'multiselect': {
      if (!validation.options || validation.options.length === 0) {
        const inner = z.array(z.string().trim().min(1)).max(100);
        const sized = required
          ? inner.min(1, `Choose at least one option for ${field.label}`)
          : inner;
        return z.preprocess(
          (value) => splitList(optionalize(value)),
          required ? sized : sized.optional(),
        );
      }
      const inner = z.array(
        z.enum(optionsTuple(validation.options), {
          errorMap: () => ({ message: `Choose valid options for ${field.label}` }),
        }),
      );
      const sized = required
        ? inner.min(1, `Choose at least one option for ${field.label}`)
        : inner;
      return z.preprocess(
        (value) => splitList(optionalize(value)),
        required ? sized : sized.optional(),
      );
    }
    case 'boolean':
      return booleanSchema(field, required);
    case 'number':
      return numberSchema(field, validation, required);
    case 'money':
      return moneySchema(field, options.moneyFormat ?? 'rupees', required);
    case 'date':
      return z.preprocess(optionalize, required ? dateSchema : dateSchema.optional());
    case 'time': {
      const base = z
        .string()
        .trim()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/, `${field.label} must be HH:MM`);
      return z.preprocess(optionalize, required ? base : base.optional());
    }
    case 'pin':
      return z.preprocess(optionalize, required ? pinCodeSchema : pinCodeSchema.optional());
    case 'pinlist':
      return pinListSchema(field, required);
    case 'file':
      return fileSchema(field.label, required);
    case 'address':
      return addressSchema(required);
    case 'geo':
      return geoSchema(required);
    case 'repeater':
      return repeaterSchema(field, required, options);
    default:
      return z.unknown();
  }
}

/**
 * Nested "required if" rules: a repeater item can carry a condition on any
 * sub-field (field-spec 5.2, 8.3). The condition is evaluated against the row
 * plus the section's own values, so a test row can depend on the centre-wide
 * `dc_home_collection` answer.
 */
function repeaterConditionIssues(
  field: ProviderField,
  rows: unknown,
  context: Record<string, unknown>,
): TypeDataIssue[] {
  if (!Array.isArray(rows)) return [];
  const issues: TypeDataIssue[] = [];
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object') return;
    const values = { ...context, ...(row as Record<string, unknown>) };
    for (const item of field.items ?? []) {
      if (item.requirement !== 'conditional' || !item.condition) continue;
      if (!evaluateCondition(item.condition, values)) continue;
      if (isEmpty((row as Record<string, unknown>)[item.key])) {
        issues.push({
          path: `${field.key}.${index}.${item.key}`,
          message: `${item.label} is required`,
        });
      }
    }
  });
  return issues;
}

/**
 * Validates one repeater row (a CSV catalogue line, a single item) with the same
 * sub-field rules the repeater schema uses, including nested conditions.
 */
export function parseRepeaterItem(
  providerType: ProviderType,
  fieldKey: string,
  row: Record<string, unknown>,
  context: Record<string, unknown> = {},
): { issues: TypeDataIssue[]; value: Record<string, unknown> } {
  const field = fieldByKey(providerType, fieldKey);
  if (!field) {
    throw new AppError('NOT_FOUND', `Unknown field: ${fieldKey}`, { fieldKey });
  }
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const item of field.items ?? []) {
    shape[item.key] = subFieldSchema(item, item.validation ?? {}, item.requirement === 'required', {
      mode: 'draft',
    });
  }
  const issues: TypeDataIssue[] = [];
  const result = z.object(shape).strict().safeParse(row);
  if (!result.success) {
    for (const issue of result.error.issues) {
      issues.push({ path: issue.path.join('.'), message: issue.message });
    }
  }
  for (const issue of repeaterConditionIssues(field, [row], context)) {
    issues.push({ path: issue.path.split('.').slice(2).join('.'), message: issue.message });
  }
  return { issues, value: result.success ? (result.data as Record<string, unknown>) : {} };
}

/** Convenience wrapper when only the problems matter. */
export function validateRepeaterItem(
  providerType: ProviderType,
  fieldKey: string,
  row: Record<string, unknown>,
  context: Record<string, unknown> = {},
): TypeDataIssue[] {
  return parseRepeaterItem(providerType, fieldKey, row, context).issues;
}

const isEmpty = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0);

/** Builds the Zod schema for one provider type's `type_data`. */
export function buildTypeDataSchema(
  providerType: ProviderType,
  options: TypeDataOptions = {},
): z.ZodTypeAny {
  const mode: TypeDataMode = options.mode ?? 'submit';
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of typeDataFieldsFor(providerType)) {
    const required = mode === 'submit' && field.requirement === 'required';
    shape[field.key] = fieldSchema(field, field.validation ?? {}, required, options);
  }

  // The doctor profile also mirrors its registry columns into type_data so the
  // review screen can show them when master data lacks a match. They are
  // optional here but must not be rejected as unknown keys at submit.
  for (const field of allFieldsForProvider(providerType)) {
    if (field.storage.kind === 'related' && field.storage.table === 'doctor_profiles') {
      shape[field.key] ??= fieldSchema(field, field.validation ?? {}, false, options);
    }
  }

  const object = z.object(shape).strict();
  if (mode === 'draft') return object;

  return object.superRefine((value, ctx) => {
    const data = value as Record<string, unknown>;
    for (const field of typeDataFieldsFor(providerType)) {
      if (field.requirement === 'conditional' && field.condition) {
        if (evaluateCondition(field.condition, data) && isEmpty(data[field.key])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field.key],
            message: `${field.label} is required`,
          });
        }
      }
      if (field.type === 'repeater') {
        for (const issue of repeaterConditionIssues(field, data[field.key], data)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: issue.path.split('.'),
            message: issue.message,
          });
        }
      }
    }
  });
}

export interface TypeDataIssue {
  path: string;
  message: string;
}

/** Validates and normalises a `type_data` payload; throws `AppError` with issues. */
export function validateTypeData(
  providerType: ProviderType,
  input: unknown,
  options: TypeDataOptions = {},
): Record<string, unknown> {
  const result = buildTypeDataSchema(providerType, options).safeParse(input ?? {});
  if (result.success) return result.data as Record<string, unknown>;

  const issues: TypeDataIssue[] = result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  throw new AppError('VALIDATION_ERROR', 'The provider details are invalid', { issues });
}

/** Non-throwing variant used by the form summary. */
export function collectTypeDataIssues(
  providerType: ProviderType,
  input: unknown,
  options: TypeDataOptions = {},
): TypeDataIssue[] {
  const result = buildTypeDataSchema(providerType, options).safeParse(input ?? {});
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/** Schema version stored alongside `type_data` on each organization. */
export function typeDataSchemaVersionFor(providerType: ProviderType): number {
  return schemaVersionFor(providerType);
}

/** Sanity guard so a new provider type cannot ship without a registry. */
export function assertRegistryCoverage(): void {
  for (const providerType of providerTypes) {
    if (!schemaVersionFor(providerType)) {
      throw new Error(`No field registry schema version for ${providerType}`);
    }
  }
}

/**
 * Field types the generated schema validates. Anything else means the registry
 * and the schema builder have drifted apart.
 */
export const supportedFieldTypes = [
  'text',
  'textarea',
  'secret',
  'email',
  'phone',
  'url',
  'number',
  'money',
  'date',
  'time',
  'select',
  'multiselect',
  'boolean',
  'file',
  'address',
  'pin',
  'pinlist',
  'geo',
  'repeater',
] as const;

/** Sections that hold a doctor's own identity: stored in `type_data` for now. */
const profileSectionTables = new Set(['doctor_profiles', 'doctor_locations']);

/**
 * Validates the type-data fields of one form section in `draft` mode: provided
 * values are checked for type and allowed options, but missing fields are not
 * errors (autosave is partial and never changes status). Values for fields kept
 * in a licence/contact/location row are rejected — those go through their
 * sub-resource endpoint.
 */
export function validateTypeDataSection(
  providerType: ProviderType,
  sectionKey: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const section = sectionsForProvider(providerType).find((entry) => entry.key === sectionKey);
  if (!section) {
    throw new AppError('NOT_FOUND', `Unknown provider section: ${sectionKey}`, { sectionKey });
  }

  const fields = section.fields.filter(
    (field) =>
      !field.adminOnly &&
      (field.storage.kind === 'type_data' ||
        (field.storage.kind === 'related' && profileSectionTables.has(field.storage.table))),
  );

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    shape[field.key] = fieldSchema(field, field.validation ?? {}, false, {
      mode: 'draft',
      moneyFormat: 'rupees',
    });
  }

  const result = z
    .object(shape)
    .strict()
    .safeParse(input ?? {});
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', `The ${section.title} section is invalid`, {
      sectionKey,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data as Record<string, unknown>;
}

/**
 * Validates administrator-only fields of one section: the keys must be admin
 * fields kept in `type_data` (field-spec 7.5, 8.2), and everything else is
 * refused so an admin request cannot quietly write a provider field.
 */
export function validateAdminTypeDataSection(
  providerType: ProviderType,
  sectionKey: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const section = sectionsForProvider(providerType).find((entry) => entry.key === sectionKey);
  if (!section) {
    throw new AppError('NOT_FOUND', `Unknown provider section: ${sectionKey}`, { sectionKey });
  }
  const fields = section.fields.filter(
    (field) => field.adminOnly && field.storage.kind === 'type_data',
  );
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const issues: TypeDataIssue[] = [];
  for (const key of Object.keys(input)) {
    if (!byKey.has(key)) {
      issues.push({ path: key, message: `${key} is not an admin-controlled field` });
    }
  }
  if (issues.length > 0) {
    throw new AppError('VALIDATION_ERROR', `The ${section.title} section is invalid`, {
      sectionKey,
      issues,
    });
  }
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    shape[field.key] = fieldSchema(field, field.validation ?? {}, false, {
      mode: 'draft',
      moneyFormat: 'rupees',
    });
  }
  const result = z
    .object(shape)
    .strict()
    .safeParse(input ?? {});
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', `The ${section.title} section is invalid`, {
      sectionKey,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data as Record<string, unknown>;
}

export interface ProviderSectionValues {
  /** Values that belong in `type_data`. */
  typeData: Record<string, unknown>;
  /** Values keyed by their registry column path (`profile_data.display_name`). */
  columns: Record<string, unknown>;
}

/**
 * Validates one form section's input and splits it into `type_data` values and
 * column values. Related rows (locations, contacts, licences, insurance,
 * service PINs, documents) are refused here: they are written through their own
 * sub-resource endpoints so the rows stay normalized.
 */
export function validateProviderSection(
  providerType: ProviderType,
  sectionKey: string,
  input: Record<string, unknown>,
): ProviderSectionValues {
  const section = sectionsForProvider(providerType).find((entry) => entry.key === sectionKey);
  if (!section) {
    throw new AppError('NOT_FOUND', `Unknown provider section: ${sectionKey}`, { sectionKey });
  }

  const fields = section.fields.filter((field) => !field.adminOnly);
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const issues: TypeDataIssue[] = [];

  for (const key of Object.keys(input)) {
    const field = byKey.get(key);
    if (!field) {
      issues.push({ path: key, message: `${key} is not a field of this section` });
    } else if (field.storage.kind === 'related') {
      issues.push({
        path: key,
        message: `${field.label} is saved through its own sub-resource endpoint`,
      });
    }
  }
  if (issues.length > 0) {
    throw new AppError('VALIDATION_ERROR', `The ${section.title} section is invalid`, {
      sectionKey,
      issues,
    });
  }

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    if (field.storage.kind === 'related') continue;
    shape[field.key] = fieldSchema(field, field.validation ?? {}, false, {
      mode: 'draft',
      moneyFormat: 'rupees',
    });
  }

  const result = z
    .object(shape)
    .strict()
    .safeParse(input ?? {});
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', `The ${section.title} section is invalid`, {
      sectionKey,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const values: ProviderSectionValues = { typeData: {}, columns: {} };
  for (const field of fields) {
    const parsed = (result.data as Record<string, unknown>)[field.key];
    if (parsed === undefined) continue;
    if (field.storage.kind === 'type_data') {
      values.typeData[field.key] = parsed;
    } else if (field.storage.kind === 'column') {
      values.columns[field.storage.column] = parsed;
    }
  }
  return values;
}
