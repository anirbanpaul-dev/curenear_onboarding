import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  csvChunks,
  expiringDocumentsExportFiltersSchema,
  exportColumnMaps,
  exportTypeLabels,
  organizationStatusLabels,
  organizationStatuses,
  pinSummaryExportFiltersSchema,
  providerExportFiltersSchema,
  providerTypeLabels,
  providerTypes,
  staffPerformanceExportFiltersSchema,
  staffProviderExportFiltersSchema,
  type AdminProviderFilters,
  type AnalyticsFilters,
  type ExportJobRecord,
  type ExportRow,
  type ExportType,
  type OrganizationStatus,
  type ProviderType,
} from '@curenear/shared';
import type { AppContext } from '../context';
import { createS3ExportStorage, type ExportStorage } from '../storage';

const DAY_MS = 86_400_000;
const PAGE_SIZE = 500;
const MAX_DOCUMENT_SCAN_PAGES = 200;

interface ProviderFilterSource {
  providerType?: ProviderType[];
  status?: OrganizationStatus[];
  pin?: string[];
  state?: string;
  district?: string;
  onboardedBy?: string;
  createdFrom?: string;
  createdTo?: string;
  submittedFrom?: string;
  submittedTo?: string;
  licenceExpiringDays?: number;
  missingDocuments?: boolean;
  q?: string;
}

export interface ExportJobSummary extends Record<string, unknown> {
  processed: number;
  succeeded: number;
  failed: number;
}

export interface ExportCleanupSummary extends Record<string, unknown> {
  expired: number;
  deleted: number;
}

function startOfDay(value: string | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function dayAfter(value: string | undefined): Date | null {
  const start = startOfDay(value);
  return start ? new Date(start.getTime() + DAY_MS) : null;
}

function toProviderFilters(source: ProviderFilterSource): AdminProviderFilters {
  return {
    providerTypes: source.providerType ?? [],
    statuses: source.status ?? [],
    pins: source.pin ?? [],
    stateId: source.state ?? null,
    districtId: source.district ?? null,
    onboardedByUserId: source.onboardedBy ?? null,
    createdFrom: startOfDay(source.createdFrom),
    createdBefore: dayAfter(source.createdTo),
    submittedFrom: startOfDay(source.submittedFrom),
    submittedBefore: dayAfter(source.submittedTo),
    licenceExpiringDays: source.licenceExpiringDays ?? null,
    missingDocuments: source.missingDocuments ?? null,
    search: source.q && source.q.length > 0 ? source.q : null,
  };
}

function analyticsFilters(source: AnalyticsFilters): AnalyticsFilters {
  return {
    providerType: source.providerType,
    status: source.status,
    state: source.state,
    district: source.district,
    onboardedBy: source.onboardedBy,
    createdFrom: source.createdFrom,
    createdTo: source.createdTo,
  };
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function isoDateTime(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function calendarDaysUntil(target: Date, now: Date): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const day = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  return Math.round((day - today) / DAY_MS);
}

/** Providers by the same filters as the directory, paged so memory stays flat. */
async function* providerRows(
  ctx: AppContext,
  filters: AdminProviderFilters,
): AsyncIterable<ExportRow> {
  let skip = 0;
  for (;;) {
    const page = await ctx.repositories.directory.search(
      filters,
      { skip, take: PAGE_SIZE },
      { field: 'created_at', order: 'asc' },
    );
    for (const row of page.rows) {
      yield {
        code: row.code,
        provider_type: providerTypeLabels[row.providerType],
        status: organizationStatusLabels[row.status],
        legal_name: row.legalName,
        trade_name: row.tradeName,
        mobile: row.mobile,
        registration_number: row.registrationNumber,
        primary_pin_code: row.primaryPinCode,
        state: row.stateName,
        district: row.districtName,
        onboarded_by_name: row.createdByName,
        onboarded_by_email: row.createdByEmail,
        document_count: row.documentCount,
        licence_expires_on: row.earliestLicenceExpiry ? isoDate(row.earliestLicenceExpiry) : null,
        submitted_at: isoDateTime(row.submittedAt),
        created_at: isoDateTime(row.createdAt),
      };
    }
    if (page.rows.length < PAGE_SIZE) return;
    skip += PAGE_SIZE;
  }
}

/** The PIN table, one row per group, read page by page from the live query. */
async function* pinSummaryRows(
  ctx: AppContext,
  filters: AnalyticsFilters,
  options: {
    groupBy: 'pin' | 'district' | 'state';
    measure: 'primary' | 'doctor_practice' | 'service';
    sort: 'pin_code' | 'total' | 'approved';
    order: 'asc' | 'desc';
    q: string | null;
  },
): AsyncIterable<ExportRow> {
  for (let page = 1; ; page += 1) {
    const summary = await ctx.repositories.analytics.pinSummary(filters, {
      groupBy: options.groupBy,
      page,
      pageSize: PAGE_SIZE,
      sort: options.sort,
      order: options.order,
      q: options.q,
      gapsOnly: false,
      useStats: false,
      measure: options.measure,
    });

    for (const row of summary.rows) {
      yield {
        pin_code: row.pinCode ?? row.label,
        measure: options.measure,
        state: row.stateName,
        district: row.districtName,
        total: row.total,
        approved: row.approved,
        ...Object.fromEntries(providerTypes.map((type) => [`type_${type}`, row.byType[type] ?? 0])),
        ...Object.fromEntries(
          organizationStatuses.map((status) => [`status_${status}`, row.byStatus[status] ?? 0]),
        ),
      };
    }

    if (page * PAGE_SIZE >= summary.totals.groups) return;
  }
}

async function* staffPerformanceRows(
  ctx: AppContext,
  filters: AnalyticsFilters,
): AsyncIterable<ExportRow> {
  for (let page = 1; ; page += 1) {
    const result = await ctx.repositories.analytics.staffPerformance(filters, page, PAGE_SIZE);
    for (const row of result.rows) {
      yield {
        name: row.name,
        email: row.email,
        created: row.created,
        submitted: row.submitted,
        approved: row.approved,
        rejected: row.rejected,
        average_completion_days: row.averageCompletionDays,
      };
    }
    if (page * PAGE_SIZE >= result.meta.total) return;
  }
}

/**
 * Provider documents with an expiry date inside the window (or already past).
 * Documents whose provider no longer exists, or does not match the provider
 * type/name filters, are skipped page by page.
 */
async function* expiringDocumentRows(
  ctx: AppContext,
  filters: { days: number; providerType?: ProviderType[]; documentType?: string; q?: string },
  now: Date,
): AsyncIterable<ExportRow> {
  const horizon = new Date(now.getTime() + filters.days * DAY_MS);
  const search = filters.q?.toLowerCase() ?? null;
  const types = filters.providerType ?? [];

  for (let page = 0; page < MAX_DOCUMENT_SCAN_PAGES; page += 1) {
    const documents = await ctx.prisma.document.findMany({
      where: {
        ownerType: 'provider_organization',
        deletedAt: null,
        expiresOn: { not: null, lte: horizon },
        ...(filters.documentType ? { documentTypeId: filters.documentType } : {}),
      },
      orderBy: [{ expiresOn: 'asc' }, { id: 'asc' }],
      skip: page * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        ownerId: true,
        status: true,
        expiresOn: true,
        documentType: { select: { name: true } },
      },
    });
    if (documents.length === 0) return;

    const organizations = await ctx.prisma.providerOrganization.findMany({
      where: { id: { in: documents.map((row) => row.ownerId) }, deletedAt: null },
      select: { id: true, code: true, legalName: true, providerType: true },
    });
    const byId = new Map(organizations.map((row) => [row.id, row]));

    for (const document of documents) {
      const organization = byId.get(document.ownerId);
      if (!organization) continue;
      if (types.length > 0 && !types.includes(organization.providerType as ProviderType)) continue;
      if (
        search &&
        !`${organization.code} ${organization.legalName ?? ''}`.toLowerCase().includes(search)
      ) {
        continue;
      }
      if (!document.expiresOn) continue;
      yield {
        provider_code: organization.code,
        legal_name: organization.legalName,
        provider_type: providerTypeLabels[organization.providerType as ProviderType],
        document_type: document.documentType.name,
        document_status: document.status,
        expires_on: isoDate(document.expiresOn),
        days_left: calendarDaysUntil(document.expiresOn, now),
      };
    }

    if (documents.length < PAGE_SIZE) return;
  }
}

function parseFilters(job: ExportJobRecord, role: 'ADMIN' | 'STAFF'): ExportRowSource {
  if (role === 'STAFF' && job.type !== 'providers') {
    throw new Error('Staff may only export their own providers');
  }

  switch (job.type) {
    case 'providers': {
      if (role === 'STAFF') {
        return { type: job.type, filters: staffProviderExportFiltersSchema.parse(job.filters) };
      }
      return { type: job.type, filters: providerExportFiltersSchema.parse(job.filters) };
    }
    case 'pin_summary':
      return { type: job.type, filters: pinSummaryExportFiltersSchema.parse(job.filters) };
    case 'staff_performance':
      return { type: job.type, filters: staffPerformanceExportFiltersSchema.parse(job.filters) };
    case 'expiring_documents':
      return { type: job.type, filters: expiringDocumentsExportFiltersSchema.parse(job.filters) };
  }
}

type ExportRowSource =
  | { type: 'providers'; filters: ProviderFilterSource }
  | {
      type: 'pin_summary';
      filters: {
        groupBy: 'pin' | 'district' | 'state';
        measure: 'primary' | 'doctor_practice' | 'service';
        sort: 'pin_code' | 'total' | 'approved';
        order: 'asc' | 'desc';
        gapsOnly?: boolean;
        q?: string;
      } & AnalyticsFilters;
    }
  | { type: 'staff_performance'; filters: AnalyticsFilters }
  | {
      type: 'expiring_documents';
      filters: { days: number; providerType?: ProviderType[]; documentType?: string; q?: string };
    };

function rowsFor(ctx: AppContext, source: ExportRowSource, now: Date): AsyncIterable<ExportRow> {
  switch (source.type) {
    case 'providers':
      return providerRows(ctx, toProviderFilters(source.filters));
    case 'pin_summary':
      return pinSummaryRows(ctx, analyticsFilters(source.filters), {
        groupBy: source.filters.groupBy,
        measure: source.filters.measure,
        sort: source.filters.sort,
        order: source.filters.order,
        q: source.filters.q && source.filters.q.length > 0 ? source.filters.q : null,
      });
    case 'staff_performance':
      return staffPerformanceRows(ctx, analyticsFilters(source.filters));
    case 'expiring_documents':
      return expiringDocumentRows(ctx, source.filters, now);
  }
}

class ExportTooLargeError extends Error {}

/** Writes the CSV to a temp file through a stream; the file is never in memory. */
async function writeCsvFile(
  path: string,
  type: ExportType,
  rows: AsyncIterable<ExportRow>,
  maxRows: number,
): Promise<number> {
  let count = 0;

  async function* counted(): AsyncIterable<ExportRow> {
    for await (const row of rows) {
      count += 1;
      if (count > maxRows) {
        throw new ExportTooLargeError(
          `This export has more than ${maxRows.toLocaleString('en-IN')} rows. Narrow the filters and try again.`,
        );
      }
      yield row;
    }
  }

  await pipeline(
    Readable.from(csvChunks(exportColumnMaps[type], counted())),
    createWriteStream(path, { encoding: 'utf8' }),
  );
  return count;
}

async function processJob(
  ctx: AppContext,
  job: ExportJobRecord,
  storage: ExportStorage,
  now: Date,
): Promise<void> {
  const requester = await ctx.prisma.user.findUnique({
    where: { id: job.requestedByUserId },
    select: { role: true, deletedAt: true },
  });
  if (!requester || requester.deletedAt) {
    throw new Error('The requester no longer has an account');
  }

  const source = parseFilters(job, requester.role === 'ADMIN' ? 'ADMIN' : 'STAFF');
  if (source.type === 'providers' && requester.role === 'STAFF') {
    // Owner scope is enforced on the stored filter, not on the caller's UI.
    source.filters = { ...source.filters, onboardedBy: job.requestedByUserId };
  }

  // A staff request is owner-scoped here as well as in the API: the stored JSON
  // can never widen it, even if it was tampered with in the database.
  const fileId = randomUUID();
  const fileName = `${job.type}-${isoDate(now)}-${fileId.slice(0, 8)}.csv`;
  const directory = await mkdtemp(join(tmpdir(), 'curenear-export-'));
  const filePath = join(directory, 'export.csv');

  try {
    const rowCount = await writeCsvFile(
      filePath,
      job.type,
      rowsFor(ctx, source, now),
      ctx.env.EXPORT_MAX_ROWS,
    );
    const file = await stat(filePath);
    const storageKey = `exports/${job.id}/${fileId}.csv`;

    await storage.putFile({
      key: storageKey,
      filePath,
      sizeBytes: file.size,
      contentType: 'text/csv; charset=utf-8',
    });

    await ctx.repositories.exports.completeJob({
      id: job.id,
      file: {
        id: fileId,
        storageKey,
        fileName,
        mimeType: 'text/csv',
        sizeBytes: file.size,
      },
      rowCount,
      finishedAt: ctx.now(),
    });

    const base = ctx.env.APP_URL.replace(/\/$/, '');
    await ctx.repositories.notifications.create({
      id: randomUUID(),
      userId: job.requestedByUserId,
      type: 'export.ready',
      title: `${exportTypeLabels[job.type]} export ready`,
      body: [
        `${rowCount.toLocaleString('en-IN')} rows.`,
        `Download: ${base}/api/v1/exports/${job.id}/download`,
        `The link works until ${isoDate(job.expiresAt)}.`,
      ].join(' '),
      entityType: 'export_job',
      entityId: job.id,
      eventId: null,
      createdAt: ctx.now(),
    });

    ctx.logger.info({ exportId: job.id, type: job.type, rowCount }, 'export_ready');
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Drains the export queue. Jobs are claimed with `SKIP LOCKED`, so several
 * workers (and several worker processes) can drain it at the same time. A
 * failure is recorded on the row for /exports instead of being retried: the
 * same filters will fail the same way until somebody narrows them.
 */
export async function runExportJobs(
  ctx: AppContext,
  options: { storage?: ExportStorage; now?: Date } = {},
): Promise<ExportJobSummary> {
  const storage = options.storage ?? createS3ExportStorage(ctx.env);
  const now = options.now ?? ctx.now();
  const summary: ExportJobSummary = { processed: 0, succeeded: 0, failed: 0 };

  for (let index = 0; index < ctx.env.EXPORT_JOBS_PER_RUN; index += 1) {
    const job = await ctx.repositories.exports.claimNext(now);
    if (!job) break;

    summary.processed += 1;
    try {
      await processJob(ctx, job, storage, now);
      summary.succeeded += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      await ctx.repositories.exports.failJob({
        id: job.id,
        error: message,
        finishedAt: ctx.now(),
      });
      summary.failed += 1;
      ctx.logger.warn({ exportId: job.id, type: job.type, err: message }, 'export_failed');
    }
  }

  return summary;
}

/** Marks exports past their TTL as EXPIRED and removes the stored objects. */
export async function runExportCleanup(
  ctx: AppContext,
  options: { storage?: ExportStorage; now?: Date } = {},
): Promise<ExportCleanupSummary> {
  const storage = options.storage ?? createS3ExportStorage(ctx.env);
  const keys = await ctx.repositories.exports.expireDue(options.now ?? ctx.now());
  let deleted = 0;

  for (const key of keys) {
    try {
      await storage.delete(key);
      deleted += 1;
    } catch (error) {
      ctx.logger.warn(
        { key, err: error instanceof Error ? error.message : 'unknown' },
        'export_object_delete_failed',
      );
    }
  }

  return { expired: keys.length, deleted };
}
