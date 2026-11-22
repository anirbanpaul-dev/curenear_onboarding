import { z } from 'zod';
import type { ProviderType } from './enums';
import type { ProviderData, ProviderPin } from './domain';
import { AppError } from './errors';
import { allFieldsFor, type FieldDef } from './field-registry';
import {
  isoDateSchema,
  mobileSchema,
  pinCodeRegex,
  pinCodeSchema,
  rupeesToPaise,
  splitList,
} from './utils';

/**
 * Registry-driven validation for provider form data.
 *
 * - `draft` allows partial data (the portal supports save-as-draft).
 * - `submit` enforces every field the spec marks `Y` plus the cross-field rules
 *   the spec states in prose.
 */

export type ProviderDataMode = 'draft' | 'submit';

/**
 * Money arrives in rupees from the API/form, but stored data is already integer
 * paise. Re-validating stored data must not multiply it by 100 again.
 */
export type MoneyFormat = 'rupees' | 'paise';

export interface ProviderDataOptions {
  moneyFormat?: MoneyFormat;
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const allowedUploadMimeTypes = ['application/pdf', 'image/jpeg', 'image/png'] as const;

const optionalize = (value: unknown): unknown =>
  value === null || (typeof value === 'string' && value.trim() === '') ? undefined : value;

const optionsTuple = (options: readonly string[]): [string, ...string[]] =>
  options as unknown as [string, ...string[]];

function requiredForType(
  field: FieldDef,
  providerType: ProviderType,
  mode: ProviderDataMode,
): boolean {
  if (mode === 'draft') return false;
  if (field.required !== 'Y') return false;
  return !(field.notRequiredFor ?? []).includes(providerType);
}

function textSchema(field: FieldDef, required: boolean): z.ZodTypeAny {
  const max = field.maxLength ?? 300;
  const base = z
    .string({
      required_error: `${field.label} is required`,
      invalid_type_error: `${field.label} must be text`,
    })
    .trim()
    .max(max, `${field.label} must be ${max} characters or fewer`);
  return z.preprocess(
    optionalize,
    required ? base.min(1, `${field.label} is required`) : base.optional(),
  );
}

function dateSchema(required: boolean): z.ZodTypeAny {
  return z.preprocess(optionalize, required ? isoDateSchema : isoDateSchema.optional());
}

function pinSchemaFor(field: FieldDef, required: boolean): z.ZodTypeAny {
  return z.preprocess(optionalize, required ? pinCodeSchema : pinCodeSchema.optional());
}

function fileSchema(field: FieldDef, required: boolean): z.ZodTypeAny {
  const object = z.object({
    fileName: z.string().trim().min(1).max(200),
    mimeType: z.enum(allowedUploadMimeTypes, {
      errorMap: () => ({ message: `${field.label} must be a PDF, JPG or PNG` }),
    }),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(MAX_UPLOAD_BYTES, `${field.label} must be 10 MB or smaller`),
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

function moneySchema(field: FieldDef, required: boolean, format: MoneyFormat): z.ZodTypeAny {
  const inner =
    format === 'paise'
      ? z
          .number({ invalid_type_error: `${field.label} must be stored as integer paise` })
          .int(`${field.label} must be stored as integer paise`)
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

function numberSchema(field: FieldDef, required: boolean): z.ZodTypeAny {
  const inner = z.coerce
    .number({ invalid_type_error: `${field.label} must be a number` })
    .int(`${field.label} must be a whole number`)
    .min(0, `${field.label} cannot be negative`);
  return z.preprocess(optionalize, required ? inner : inner.optional());
}

function booleanSchema(field: FieldDef, required: boolean): z.ZodTypeAny {
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

function pinListSchema(field: FieldDef, required: boolean): z.ZodTypeAny {
  const base = z
    .array(z.string().trim().regex(pinCodeRegex, `${field.label}: enter valid 6-digit PIN codes`), {
      invalid_type_error: `${field.label} must be a list of PIN codes`,
    })
    .max(500, `${field.label} supports up to 500 PIN codes`);

  const sized = required ? base.min(1, `${field.label} needs at least one PIN code`) : base;
  const inner = sized.transform((values) => Array.from(new Set(values)));

  return z.preprocess(
    (value) => splitList(optionalize(value)),
    required ? inner : inner.optional(),
  );
}

function buildShape(
  fields: readonly FieldDef[],
  providerType: ProviderType,
  mode: ProviderDataMode,
  options: ProviderDataOptions,
): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    const required = requiredForType(field, providerType, mode);
    shape[field.key] = fieldSchema(field, required, providerType, mode, options);
  }
  return shape;
}

function fieldSchema(
  field: FieldDef,
  required: boolean,
  providerType: ProviderType,
  mode: ProviderDataMode,
  options: ProviderDataOptions,
): z.ZodTypeAny {
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'phone':
    case 'url':
    case 'select':
    case 'multiselect':
      if (field.type === 'email') {
        const base = z
          .string({ required_error: `${field.label} is required` })
          .trim()
          .email(`Enter a valid email for ${field.label}`)
          .max(200);
        return z.preprocess(optionalize, required ? base : base.optional());
      }
      if (field.type === 'phone') {
        return z.preprocess(optionalize, required ? mobileSchema : mobileSchema.optional());
      }
      if (field.type === 'url') {
        const base = z.string().trim().url(`Enter a valid URL for ${field.label}`).max(300);
        return z.preprocess(optionalize, required ? base : base.optional());
      }
      if (field.type === 'select') {
        if (!field.options || field.options.length === 0) return textSchema(field, required);
        const base = z.enum(optionsTuple(field.options), {
          errorMap: () => ({ message: `Choose a valid option for ${field.label}` }),
        });
        return z.preprocess(optionalize, required ? base : base.optional());
      }
      if (field.type === 'multiselect') {
        if (!field.options || field.options.length === 0) {
          return z.preprocess(
            splitList,
            required ? z.array(z.string()).min(1) : z.array(z.string()).optional(),
          );
        }
        const inner = z.array(
          z.enum(optionsTuple(field.options), {
            errorMap: () => ({ message: `Choose valid options for ${field.label}` }),
          }),
        );
        return z.preprocess(
          splitList,
          required
            ? inner.min(1, `Choose at least one option for ${field.label}`)
            : inner.optional(),
        );
      }
      return textSchema(field, required);

    case 'date':
      return dateSchema(required);
    case 'pin':
      return pinSchemaFor(field, required);
    case 'pinlist':
      return pinListSchema(field, required);
    case 'money':
      return moneySchema(field, required, options.moneyFormat ?? 'rupees');
    case 'number':
      return numberSchema(field, required);
    case 'boolean':
      return booleanSchema(field, required);
    case 'file':
      return fileSchema(field, required);
    case 'address':
      return addressSchema(required);
    case 'geo':
      return geoSchema(required);
    case 'repeater': {
      const items = field.items ?? [];
      const itemSchema = z.object(buildShape(items, providerType, mode, options)).strict();
      // Sex-determination tests are never allowed, on drafts or on submit.
      const guardedItem =
        field.key === 'dc_tests'
          ? itemSchema.superRefine((item, ctx) => {
              const name = (item as Record<string, unknown>).test_name;
              if (typeof name === 'string' && sexDeterminationPattern.test(name)) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: ['test_name'],
                  message: 'Sex-determination tests cannot be listed',
                });
              }
            })
          : itemSchema;
      const base = z.array(guardedItem).max(100, `${field.label} supports up to 100 entries`);
      const inner = required ? base.min(1, `Add at least one entry to ${field.label}`) : base;
      return z.preprocess(optionalize, required ? inner : inner.optional());
    }
    default:
      return z.unknown();
  }
}

export const sexDeterminationPattern = /sex[\s-]?determin/i;

type IssueSink = z.RefinementCtx;

function requireWhen(
  data: Record<string, unknown>,
  ctx: IssueSink,
  condition: boolean,
  key: string,
  message: string,
): void {
  if (!condition) return;
  const value = data[key];
  const empty =
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0);
  if (empty) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message });
}

function applyCrossFieldRules(
  providerType: ProviderType,
  data: Record<string, unknown>,
  ctx: IssueSink,
): void {
  // Field-spec 4.5: restriction details are mandatory when a restriction is disclosed.
  requireWhen(
    data,
    ctx,
    data.doc_restriction_flag === true,
    'doc_restriction_details',
    'Describe the restriction on your registration',
  );

  // Field-spec 6.1: exemption reason or registration number, depending on the answer.
  requireWhen(
    data,
    ctx,
    data.clinic_ce_applicable === 'exempt',
    'clinic_ce_exempt_reason',
    'Give the reason clinical establishment registration is not applicable',
  );
  requireWhen(
    data,
    ctx,
    data.clinic_ce_applicable === 'yes',
    'clinic_ce_reg_no',
    'Enter the clinical establishment registration number',
  );

  // Field-spec 7.3: delivery PIN codes and terms are needed when delivery is offered.
  requireWhen(data, ctx, data.ph_delivery === true, 'ph_delivery_pins', 'Add delivery PIN codes');
  requireWhen(data, ctx, data.ph_delivery === true, 'ph_delivery_hours', 'Add delivery hours');
  requireWhen(data, ctx, data.ph_delivery === true, 'ph_courier', 'Choose a delivery method');

  // Field-spec 3.5a: emergency escalation is mandatory for these types.
  if (['care_provider', 'diagnostic_centre', 'clinic'].includes(providerType)) {
    requireWhen(
      data,
      ctx,
      true,
      'contact_emergency',
      'Emergency escalation contact is required for this provider type',
    );
  }
}

interface CrossFieldIssue {
  path: Array<string | number>;
  message: string;
}

/** Cross-field rules are also evaluated standalone so they surface when a form already has errors. */
export function collectCrossFieldIssues(
  providerType: ProviderType,
  data: Record<string, unknown>,
): CrossFieldIssue[] {
  const issues: CrossFieldIssue[] = [];
  const ctx: IssueSink = {
    addIssue: (issue: z.IssueData) => {
      issues.push({
        path: issue.path ? [...issue.path] : [],
        message: issue.message ?? 'Invalid value',
      });
    },
  } as unknown as IssueSink;

  applyCrossFieldRules(providerType, data, ctx);
  return issues;
}

export function buildProviderDataSchema(
  providerType: ProviderType,
  mode: ProviderDataMode = 'submit',
  options: ProviderDataOptions = {},
): z.ZodType<ProviderData> {
  const shape = buildShape(allFieldsFor(providerType), providerType, mode, options);
  const object = z.object(shape).strict();
  if (mode === 'draft') return object as unknown as z.ZodType<ProviderData>;
  return object.superRefine((value, ctx) => {
    applyCrossFieldRules(providerType, value as Record<string, unknown>, ctx);
  }) as unknown as z.ZodType<ProviderData>;
}

/**
 * Removes undefined leaves. `undefined` is valid in a parsed object but is not a
 * legal JSON value for the Prisma `data` column.
 */
export function pruneUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => entry !== undefined)
      .map((entry) => pruneUndefined(entry)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      output[key] = pruneUndefined(entry);
    }
    return output as T;
  }
  return value;
}

export function validateProviderData(
  providerType: ProviderType,
  mode: ProviderDataMode,
  input: unknown,
  options: ProviderDataOptions = {},
): ProviderData {
  const result = buildProviderDataSchema(providerType, mode, options).safeParse(input ?? {});
  const issues = result.success
    ? []
    : result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

  // Refinements do not run when the shape itself failed, so merge the cross-field
  // rules here to give operators the full list of problems in one pass.
  if (mode === 'submit' && input && typeof input === 'object' && !Array.isArray(input)) {
    for (const issue of collectCrossFieldIssues(providerType, input as Record<string, unknown>)) {
      const path = issue.path.join('.');
      if (
        !issues.some((existing) => existing.path === path && existing.message === issue.message)
      ) {
        issues.push({ path, message: issue.message });
      }
    }
  }

  if (issues.length > 0 || !result.success) {
    throw new AppError('VALIDATION_ERROR', 'The provider details are invalid', { issues });
  }
  return pruneUndefined(result.data);
}

/** Collects per-field issues without throwing (used by the form preview). */
export function collectProviderDataIssues(
  providerType: ProviderType,
  mode: ProviderDataMode,
  input: unknown,
  options: ProviderDataOptions = {},
): Array<{ path: string; message: string }> {
  const result = buildProviderDataSchema(providerType, mode, options).safeParse(input ?? {});
  const issues = result.success
    ? []
    : result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

  if (mode === 'submit' && input && typeof input === 'object' && !Array.isArray(input)) {
    for (const issue of collectCrossFieldIssues(providerType, input as Record<string, unknown>)) {
      const path = issue.path.join('.');
      if (
        !issues.some((existing) => existing.path === path && existing.message === issue.message)
      ) {
        issues.push({ path, message: issue.message });
      }
    }
  }
  return issues;
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.map(asRecord).filter((entry): entry is Record<string, unknown> => entry !== null);
}

const pinPriority: Record<ProviderPin['kind'], number> = {
  registered_office: 3,
  location: 2,
  service_area: 1,
};

/**
 * Derives the filterable columns and the PIN coverage rows from form data.
 * PIN codes stay strings end to end.
 */
export function deriveProviderColumns(data: ProviderData): {
  displayName: string | null;
  legalName: string | null;
  city: string | null;
  primaryPinCode: string | null;
  pins: ProviderPin[];
} {
  const firstLocation = asRecordArray(data.locations)[0] ?? null;
  const locationAddress = firstLocation ? asRecord(firstLocation.loc_address) : null;

  const displayName =
    asString(data.profile_display_name) ??
    asString(data.legal_name) ??
    asString(data.trade_name) ??
    asString(data.doc_full_name) ??
    asString(data.clinic_owner) ??
    null;

  const legalName = asString(data.legal_name) ?? asString(data.doc_full_name);

  const city = asString(data.reg_city) ?? (locationAddress ? asString(locationAddress.city) : null);

  const primaryPinCode =
    asString(data.reg_pin) ?? (firstLocation ? asString(firstLocation.loc_pin) : null);

  const pins = new Map<string, ProviderPin['kind']>();
  const addPin = (value: unknown, kind: ProviderPin['kind']): void => {
    const pin = asString(value);
    if (!pin || !pinCodeRegex.test(pin)) return;
    const current = pins.get(pin);
    if (!current || pinPriority[kind] > pinPriority[current]) pins.set(pin, kind);
  };

  addPin(data.reg_pin, 'registered_office');
  for (const location of asRecordArray(data.locations)) addPin(location.loc_pin, 'location');

  const servicePinLists = [
    data.service_pins,
    data.ph_delivery_pins,
    data.cp_pins,
    data.dc_collection_pins,
  ];
  for (const list of servicePinLists) {
    for (const pin of splitList(list) ?? []) addPin(pin, 'service_area');
  }
  for (const category of asRecordArray(data.cp_service_categories)) {
    for (const pin of splitList(category.cp_pins) ?? []) addPin(pin, 'service_area');
  }

  return {
    displayName,
    legalName,
    city,
    primaryPinCode,
    pins: Array.from(pins.entries()).map(([pinCode, kind]) => ({ pinCode, kind })),
  };
}

export interface ExpiringLicence {
  fieldKey: string;
  date: string;
  daysLeft: number;
}

/**
 * Heuristic expiry scan over the submitted data: every licence/registration/
 * insurance value the spec defines has a `*_to` date. Dates are ISO strings.
 */
export function collectExpiringLicences(
  data: ProviderData,
  from: Date,
  withinDays: number,
): ExpiringLicence[] {
  const found: ExpiringLicence[] = [];

  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    const record = asRecord(value);
    if (!record) return;
    for (const [key, entry] of Object.entries(record)) {
      const keyPath = path ? `${path}.${key}` : key;
      if (entry && typeof entry === 'object') {
        walk(entry, keyPath);
        continue;
      }
      if (!key.endsWith('_to') || typeof entry !== 'string') continue;
      const timestamp = Date.parse(`${entry.slice(0, 10)}T00:00:00Z`);
      if (Number.isNaN(timestamp)) continue;
      const daysLeft = Math.floor((timestamp - from.getTime()) / 86_400_000);
      if (daysLeft <= withinDays) found.push({ fieldKey: keyPath, date: entry, daysLeft });
    }
  };

  walk(data, '');
  return found.sort((a, b) => a.daysLeft - b.daysLeft);
}

/** True when every field the spec marks `Y` is present. Used for list readiness hints. */
export function missingRequiredFields(providerType: ProviderType, data: ProviderData): string[] {
  const schema = buildProviderDataSchema(providerType, 'submit');
  const result = schema.safeParse(data);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join('.'));
}
