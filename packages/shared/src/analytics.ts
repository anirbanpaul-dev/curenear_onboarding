import { z } from 'zod';
import { providerTypes, type ProviderType } from './enums';
import { organizationStatuses, type OrganizationStatus } from './provider-lifecycle';

/**
 * Admin analytics contracts.
 *
 * A provider counts for a PIN by its **primary location** PIN. Doctors are a
 * separate measure ("doctors practising in PIN"), and service-area PINs are
 * reported as "providers serving PIN". See docs/decisions.md,
 * "2026-11-21 — Provider analytics per PIN".
 */

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

const booleanFlag = z.preprocess((value) => {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return undefined;
}, z.boolean().optional());

/** Filters shared by every analytics endpoint. Dates are Asia/Kolkata days. */
export const analyticsFiltersSchema = z
  .object({
    providerType: listOf(z.enum(providerTypes)),
    status: listOf(z.enum(organizationStatuses)),
    state: z.string().uuid().optional(),
    district: z.string().uuid().optional(),
    onboardedBy: z.string().uuid().optional(),
    createdFrom: isoDate.optional(),
    createdTo: isoDate.optional(),
  })
  .strict();
export type AnalyticsFilters = z.infer<typeof analyticsFiltersSchema>;

/**
 * The three questions a PIN summary can answer. `primary` is the default and
 * the only measure used by coverage gaps.
 */
export const pinStatMeasures = ['primary', 'doctor_practice', 'service'] as const;
export type PinStatMeasure = (typeof pinStatMeasures)[number];

export const pinStatMeasureLabels: Record<PinStatMeasure, string> = {
  primary: 'Providers in PIN',
  doctor_practice: 'Doctors practising in PIN',
  service: 'Providers serving PIN',
};

export const analyticsGroupBy = ['pin', 'district', 'state'] as const;
export type AnalyticsGroupBy = (typeof analyticsGroupBy)[number];

export const pinSummarySortFields = ['pin_code', 'total', 'approved'] as const;

export const pinSummaryQuerySchema = analyticsFiltersSchema
  .extend({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    sort: z.enum(pinSummarySortFields).default('total'),
    order: z.enum(['asc', 'desc']).default('desc'),
    groupBy: z.enum(analyticsGroupBy).default('pin'),
    measure: z.enum(pinStatMeasures).default('primary'),
    /** PIN prefix (1–6 digits) or a district/state name fragment when grouped. */
    q: z.string().trim().max(80).optional(),
    /** Only rows with no approved provider (coverage gaps). */
    gapsOnly: booleanFlag,
  })
  .strict();
export type PinSummaryQuery = z.infer<typeof pinSummaryQuerySchema>;

export const overviewQuerySchema = analyticsFiltersSchema
  .extend({ days: z.coerce.number().int().min(7).max(180).default(30) })
  .strict();
export type OverviewQuery = z.infer<typeof overviewQuerySchema>;

export const staffPerformanceQuerySchema = analyticsFiltersSchema
  .extend({ page: z.coerce.number().int().min(1).default(1) })
  .strict();
export type StaffPerformanceQuery = z.infer<typeof staffPerformanceQuerySchema>;

/** One row of the PIN/state/district summary. */
export interface AnalyticsGroupRow {
  /** `pin`, district id or state id. */
  key: string;
  /** Display text: the PIN, district name or state name. */
  label: string;
  pinCode: string | null;
  stateName: string | null;
  districtName: string | null;
  total: number;
  approved: number;
  byType: Partial<Record<ProviderType, number>>;
  byStatus: Partial<Record<OrganizationStatus, number>>;
}

export interface AnalyticsPinSummary {
  rows: AnalyticsGroupRow[];
  totals: { groups: number; providers: number; approved: number };
  byType: Array<{ providerType: ProviderType; count: number }>;
  byStatus: Array<{ status: OrganizationStatus; count: number }>;
  /** `read_model` for the fast path, `live` when a dimension forces a join. */
  source: 'read_model' | 'live';
  groupedBy: AnalyticsGroupBy;
  measure: PinStatMeasure;
}

export interface AnalyticsOverview {
  totals: {
    providers: number;
    approved: number;
    drafts: number;
    submitted: number;
    underReview: number;
    changesRequested: number;
    rejected: number;
    suspended: number;
    terminated: number;
  };
  funnel: {
    draft: number;
    /** Providers that have ever been submitted (submitted_at is set). */
    submitted: number;
    approved: number;
    rejected: number;
  };
  /** Days from submission to approval, over approved providers. */
  averageReviewDays: number | null;
  byType: Array<{ providerType: ProviderType; count: number }>;
  byStatus: Array<{ status: OrganizationStatus; count: number }>;
  perDay: Array<{ date: string; count: number }>;
}

export interface StaffPerformanceRow {
  staffUserId: string;
  name: string;
  email: string;
  created: number;
  submitted: number;
  approved: number;
  rejected: number;
  /** Days from creation to approval, averaged over approved providers. */
  averageCompletionDays: number | null;
}

export interface StaffPerformanceResult {
  rows: StaffPerformanceRow[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}
