import { z } from 'zod';
import { organizationStatuses, type OrganizationStatus } from './provider-lifecycle';
import { providerTypes, type ProviderType } from './enums';

/**
 * The admin provider directory (`/admin/providers`).
 *
 * Filters are deliberately flat and repeatable so a directory view is a plain
 * URL: `?providerType=pharmacy&providerType=clinic&pin=7000&status=SUBMITTED`.
 * The repository turns them into one indexed SQL query; the client never sees
 * a Prisma query.
 */

export const adminProviderSortFields = [
  'created_at',
  'updated_at',
  'submitted_at',
  'legal_name',
  'status',
  'provider_type',
  'code',
  'primary_pin_code',
] as const;
export type AdminProviderSortField = (typeof adminProviderSortFields)[number];

/** Accepts `a,b` as well as repeated `?key=a&key=b`. */
function listOf<Output>(item: z.ZodType<Output>) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined;
    const entries = Array.isArray(value) ? value : [value];
    return entries
      .flatMap((entry) => String(entry).split(','))
      .map((entry) => entry.trim())
      .filter(Boolean);
  }, z.array(item).optional());
}

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD form');

const pinEntry = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{0,5}$/, 'A PIN filter is 1–6 digits and cannot start with 0');

const booleanFlag = z.preprocess((value) => {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return undefined;
}, z.boolean().optional());

export const adminProviderListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    sort: z.enum(adminProviderSortFields).default('created_at'),
    order: z.enum(['asc', 'desc']).default('desc'),
    providerType: listOf(z.enum(providerTypes)),
    status: listOf(z.enum(organizationStatuses)),
    /** Exact (6-digit) PINs and/or prefixes (`7000`). */
    pin: listOf(pinEntry),
    state: z.string().uuid().optional(),
    district: z.string().uuid().optional(),
    onboardedBy: z.string().uuid().optional(),
    createdFrom: isoDate.optional(),
    createdTo: isoDate.optional(),
    submittedFrom: isoDate.optional(),
    submittedTo: isoDate.optional(),
    licenceExpiringDays: z.coerce.number().int().min(0).max(365).optional(),
    missingDocuments: booleanFlag,
    q: z.string().trim().max(120).optional(),
  })
  .strict();
export type AdminProviderListQuery = z.infer<typeof adminProviderListQuerySchema>;

/** Filters after the API has normalised them; the repository works in these. */
export interface AdminProviderFilters {
  providerTypes: ProviderType[];
  statuses: OrganizationStatus[];
  pins: string[];
  stateId: string | null;
  districtId: string | null;
  onboardedByUserId: string | null;
  createdFrom: Date | null;
  /** Inclusive day end, already advanced by one day by the service. */
  createdBefore: Date | null;
  submittedFrom: Date | null;
  submittedBefore: Date | null;
  licenceExpiringDays: number | null;
  missingDocuments: boolean | null;
  search: string | null;
}

export interface AdminProviderDirectoryRow {
  id: string;
  code: string;
  providerType: ProviderType;
  status: OrganizationStatus;
  legalName: string | null;
  tradeName: string | null;
  mobile: string | null;
  registrationNumber: string | null;
  primaryPinCode: string | null;
  stateName: string | null;
  districtName: string | null;
  createdByUserId: string;
  createdByName: string | null;
  createdByEmail: string | null;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  documentCount: number;
  /** Earliest `valid_to` among the provider's licences; null when none. */
  earliestLicenceExpiry: Date | null;
}

export interface AdminProviderFacet {
  value: string;
  count: number;
}

/** Counts under the current filters, so they describe the result set the chips show. */
export interface AdminProviderFacets {
  byType: Array<{ providerType: ProviderType; count: number }>;
  byStatus: Array<{ status: OrganizationStatus; count: number }>;
}

/** A saved filter preset. `query` is the URL query string, without `?`. */
export interface ProviderDirectoryViewRecord {
  id: string;
  userId: string;
  name: string;
  query: string;
  createdAt: Date;
  updatedAt: Date;
}

export const providerDirectoryViewInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the view a name').max(80),
    query: z
      .string()
      .trim()
      .max(2000)
      .refine((value) => !value.startsWith('?'), 'Send the query string without the leading ?'),
  })
  .strict();
export type ProviderDirectoryViewInput = z.infer<typeof providerDirectoryViewInputSchema>;

export const providerDirectoryViewIdSchema = z.object({ id: z.string().uuid() });
