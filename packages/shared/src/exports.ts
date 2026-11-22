import { z } from 'zod';
import { adminProviderListQuerySchema } from './admin-directory';
import { analyticsFiltersSchema, pinSummaryQuerySchema } from './analytics';
import { organizationStatusLabels, providerTypeLabels, providerTypes } from './enums';
import { organizationStatuses } from './provider-lifecycle';
import { staffProviderListQuerySchema } from './staff-area';

/**
 * Asynchronous CSV exports.
 *
 * The API records a request in `export_jobs`; the worker streams the file into
 * private object storage and the requester gets an in-app notification. Nothing
 * here ever streams a file through the web app, and no export includes document
 * binaries or consent evidence — only the columns in `exportColumnMaps`.
 */

export const exportTypes = [
  'providers',
  'pin_summary',
  'staff_performance',
  'expiring_documents',
] as const;
export type ExportType = (typeof exportTypes)[number];

export const exportTypeLabels: Record<ExportType, string> = {
  providers: 'Providers',
  pin_summary: 'PIN summary',
  staff_performance: 'Staff performance',
  expiring_documents: 'Expiring documents',
};

export const exportStatuses = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'EXPIRED'] as const;
export type ExportStatus = (typeof exportStatuses)[number];

export const exportStatusLabels: Record<ExportStatus, string> = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  SUCCEEDED: 'Ready',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
};

/** Presigned GET lifetime; the job itself stays downloadable until `expires_at`. */
export const exportDownloadUrlTtlSeconds = 300;

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

/** The provider directory filters, without pagination or presentation options. */
export const providerExportFiltersSchema = adminProviderListQuerySchema.omit({
  page: true,
  pageSize: true,
  sort: true,
  order: true,
});
export type ProviderExportFilters = z.infer<typeof providerExportFiltersSchema>;

/** Staff may export only their own providers, and only with the staff filters. */
export const staffProviderExportFiltersSchema = staffProviderListQuerySchema.omit({
  page: true,
  pageSize: true,
  sort: true,
  order: true,
});

/** The PIN table's own filters, including grouping, measure and search. */
export const pinSummaryExportFiltersSchema = pinSummaryQuerySchema.omit({
  page: true,
  pageSize: true,
});

export const staffPerformanceExportFiltersSchema = analyticsFiltersSchema;

/**
 * Expiring provider documents. `days` is the forward window; already-expired
 * rows are always included so the file is a working list, not just a forecast.
 */
export const expiringDocumentsExportFiltersSchema = z
  .object({
    days: z.coerce.number().int().min(0).max(365).default(60),
    providerType: listOf(z.enum(providerTypes)),
    documentType: z.string().uuid().optional(),
    q: z.string().trim().max(120).optional(),
  })
  .strict();
export type ExpiringDocumentsExportFilters = z.infer<typeof expiringDocumentsExportFiltersSchema>;

export const exportRequestSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('providers'),
      filters: providerExportFiltersSchema.default({}),
    })
    .strict(),
  z
    .object({
      type: z.literal('pin_summary'),
      filters: pinSummaryExportFiltersSchema.default({}),
    })
    .strict(),
  z
    .object({
      type: z.literal('staff_performance'),
      filters: staffPerformanceExportFiltersSchema.default({}),
    })
    .strict(),
  z
    .object({
      type: z.literal('expiring_documents'),
      filters: expiringDocumentsExportFiltersSchema.default({}),
    })
    .strict(),
]);
export type ExportRequest = z.infer<typeof exportRequestSchema>;

export const exportsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type ExportsQuery = z.infer<typeof exportsQuerySchema>;

export const exportDownloadParamsSchema = z.object({ id: z.string().uuid() }).strict();

export interface ExportJobDto {
  id: string;
  type: ExportType;
  status: ExportStatus;
  rowCount: number | null;
  fileName: string | null;
  error: string | null;
  expiresAt: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** True only while a finished file can still be downloaded. */
  downloadable: boolean;
}

export interface ExportJobListResult {
  rows: ExportJobDto[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

/* --- CSV ---------------------------------------------------------------- */

export interface ExportColumn {
  key: string;
  header: string;
}

/**
 * The configurable column map per export type. Deliberately excludes document
 * file names/binaries, consent declarations and every other sensitive evidence:
 * an export is a working list, not a data dump.
 */
export const exportColumnMaps: Record<ExportType, readonly ExportColumn[]> = {
  providers: [
    { key: 'code', header: 'Provider code' },
    { key: 'provider_type', header: 'Provider type' },
    { key: 'status', header: 'Status' },
    { key: 'legal_name', header: 'Legal name' },
    { key: 'trade_name', header: 'Trade name' },
    { key: 'mobile', header: 'Mobile' },
    { key: 'registration_number', header: 'Registration number' },
    { key: 'primary_pin_code', header: 'Primary PIN' },
    { key: 'state', header: 'State' },
    { key: 'district', header: 'District' },
    { key: 'onboarded_by_name', header: 'Onboarded by' },
    { key: 'onboarded_by_email', header: 'Staff email' },
    { key: 'document_count', header: 'Documents' },
    { key: 'licence_expires_on', header: 'Earliest licence expiry' },
    { key: 'submitted_at', header: 'Submitted' },
    { key: 'created_at', header: 'Created' },
  ],
  pin_summary: [
    { key: 'pin_code', header: 'PIN' },
    { key: 'measure', header: 'Measure' },
    { key: 'state', header: 'State' },
    { key: 'district', header: 'District' },
    { key: 'total', header: 'Total' },
    { key: 'approved', header: 'Approved' },
    ...providerTypes.map((type) => ({ key: `type_${type}`, header: providerTypeLabels[type] })),
    ...organizationStatuses.map((status) => ({
      key: `status_${status}`,
      header: organizationStatusLabels[status],
    })),
  ],
  staff_performance: [
    { key: 'name', header: 'Staff' },
    { key: 'email', header: 'Email' },
    { key: 'created', header: 'Created' },
    { key: 'submitted', header: 'Submitted' },
    { key: 'approved', header: 'Approved' },
    { key: 'rejected', header: 'Rejected' },
    { key: 'average_completion_days', header: 'Average completion (days)' },
  ],
  expiring_documents: [
    { key: 'provider_code', header: 'Provider code' },
    { key: 'legal_name', header: 'Legal name' },
    { key: 'provider_type', header: 'Provider type' },
    { key: 'document_type', header: 'Document type' },
    { key: 'document_status', header: 'Document status' },
    { key: 'expires_on', header: 'Expires on' },
    { key: 'days_left', header: 'Days left' },
  ],
};

export type ExportRow = Record<string, string | number | null>;

export const csvBom = '\uFEFF';

/**
 * CSV formula injection protection: Excel and LibreOffice execute a cell that
 * begins with `=`, `+`, `-` or `@`, so those cells are prefixed with an
 * apostrophe. Leading whitespace is ignored when looking for the trigger. The
 * cell is then quoted when it contains a comma, quote or line break.
 */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  const first = text.trimStart().charAt(0);
  if (first === '=' || first === '+' || first === '-' || first === '@') {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvHeaderLine(columns: readonly ExportColumn[]): string {
  return columns.map((column) => escapeCsvCell(column.header)).join(',');
}

export function csvRowLine(columns: readonly ExportColumn[], row: ExportRow): string {
  return columns.map((column) => escapeCsvCell(row[column.key])).join(',');
}

/**
 * Produces the file a bounded number of rows at a time. A `BOM` opens the file
 * so Excel reads UTF-8 correctly, and each chunk ends with CRLF.
 */
export async function* csvChunks(
  columns: readonly ExportColumn[],
  rows: AsyncIterable<ExportRow> | Iterable<ExportRow>,
  rowsPerChunk = 250,
): AsyncGenerator<string> {
  let buffer: string[] = [csvHeaderLine(columns)];
  let first = true;

  const flush = (): string => {
    const payload = buffer.join('\r\n') + '\r\n';
    buffer = [];
    if (!first) return payload;
    first = false;
    return `${csvBom}${payload}`;
  };

  for await (const row of rows) {
    buffer.push(csvRowLine(columns, row));
    if (buffer.length >= rowsPerChunk) yield flush();
  }
  if (buffer.length > 0) yield flush();
  else if (first) yield `${csvBom}${csvHeaderLine(columns)}\r\n`;
}
