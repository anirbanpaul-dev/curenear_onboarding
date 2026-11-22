import {
  AppError,
  exportDownloadUrlTtlSeconds,
  exportStatusLabels,
  exportTypeLabels,
  staffProviderExportFiltersSchema,
  type Actor,
  type ExportJobDto,
  type ExportJobRecord,
  type ExportJobListResult,
  type ExportRequest,
  type ExportType,
  type ExportsQuery,
} from '@curenear/shared';
import type { ObjectStorage } from '@/server/documents/object-storage';
import type { RequestContext, ServiceDeps } from './service-deps';

export interface ExportServiceDeps extends ServiceDeps {
  storage: ObjectStorage;
  appUrl: string;
  retentionHours: number;
}

function toDto(job: ExportJobRecord, at: Date): ExportJobDto {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    rowCount: job.rowCount,
    fileName: job.fileName,
    error: job.error,
    expiresAt: job.expiresAt.toISOString(),
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    downloadable: job.status === 'SUCCEEDED' && job.expiresAt.getTime() > at.getTime(),
  };
}

function staffFilters(request: ExportRequest): Record<string, unknown> {
  if (request.type !== 'providers') {
    throw new AppError('FORBIDDEN', 'Staff can export only their own providers');
  }
  const parsed = staffProviderExportFiltersSchema.safeParse(request.filters);
  if (!parsed.success) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Those filters are not available for a staff export',
      parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    );
  }
  return { ...parsed.data };
}

/**
 * Asynchronous CSV exports.
 *
 * The request only writes a queued row; the worker streams the file into
 * private storage. Authorization is decided here and repeated in the worker:
 * administrators may export anything, staff may export only the providers they
 * onboarded and only the `providers` type. Every request and download is
 * audited, and one account may have only one queued/running export at a time.
 */
export function createExportService(deps: ExportServiceDeps) {
  const { repositories, unitOfWork, now, newId, storage, retentionHours } = deps;

  async function audit(
    repos: { audits: ServiceDeps['repositories']['audits'] },
    input: {
      actor: Actor;
      action: 'export.requested' | 'export.downloaded';
      exportId: string;
      changedFieldKeys: string[];
      ctx: RequestContext;
    },
  ): Promise<void> {
    await repos.audits.append({
      id: newId(),
      actorUserId: input.actor.userId,
      actorRole: input.actor.role,
      action: input.action,
      entityType: 'export_job',
      entityId: input.exportId,
      requestId: input.ctx.requestId,
      changedFieldKeys: input.changedFieldKeys,
      fromStatus: null,
      toStatus: null,
      reason: null,
      ipAddress: input.ctx.ipAddress,
      userAgent: input.ctx.userAgent,
      createdAt: now(),
    });
  }

  return {
    async create(actor: Actor, request: ExportRequest, ctx: RequestContext): Promise<ExportJobDto> {
      if (actor.role !== 'ADMIN' && actor.role !== 'STAFF') {
        throw new AppError('FORBIDDEN', 'Only portal accounts can request an export');
      }
      if (actor.role === 'STAFF' && request.type !== 'providers') {
        throw new AppError('FORBIDDEN', 'Staff can export only their own providers');
      }

      // Staff scope is written into the stored filter; nothing in a later
      // request can widen it, and the worker re-applies it before querying.
      const filters =
        actor.role === 'STAFF'
          ? { ...staffFilters(request), onboardedBy: actor.userId }
          : { ...request.filters };

      if ((await repositories.exports.countActive(actor.userId)) > 0) {
        throw new AppError(
          'CONFLICT',
          'You already have an export in progress. Wait for it to finish before starting another.',
        );
      }

      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + retentionHours * 60 * 60 * 1000);

      const job = await unitOfWork.transaction(async (tx) => {
        const created = await tx.exports.createJob({
          id: newId(),
          type: request.type,
          requestedByUserId: actor.userId,
          filters,
          expiresAt,
          createdAt,
        });
        await audit(tx, {
          actor,
          action: 'export.requested',
          exportId: created.id,
          changedFieldKeys: ['type', 'filters'],
          ctx,
        });
        return created;
      });

      return toDto(job, now());
    },

    async list(actor: Actor, query: ExportsQuery): Promise<ExportJobListResult> {
      const { rows, total } = await repositories.exports.listForUser(actor.userId, {
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      const at = now();
      return {
        rows: rows.map((row) => toDto(row, at)),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
        },
      };
    },

    /** Signs a five-minute URL; requires a finished, unexpired export. */
    async download(
      actor: Actor,
      id: string,
      ctx: RequestContext,
    ): Promise<{ url: string; expires_at: Date; file_name: string }> {
      const job = await repositories.exports.findJob(id);
      // A missing row and somebody else's row are indistinguishable.
      if (!job || job.requestedByUserId !== actor.userId) {
        throw new AppError('NOT_FOUND', 'Export not found');
      }
      if (job.status === 'EXPIRED' || job.expiresAt.getTime() <= now().getTime()) {
        throw new AppError('CONFLICT', 'This export has expired');
      }
      if (job.status !== 'SUCCEEDED' || !job.fileDocumentId) {
        throw new AppError(
          'CONFLICT',
          job.status === 'FAILED'
            ? 'This export failed'
            : `This export is not ready yet (${exportStatusLabels[job.status].toLowerCase()})`,
        );
      }

      const file = await repositories.exports.findFile(job.fileDocumentId);
      if (!file) throw new AppError('NOT_FOUND', 'Export file not found');

      const url = await storage.createDownloadUrl({
        key: file.storageKey,
        expiresInSeconds: exportDownloadUrlTtlSeconds,
      });
      await audit(repositories, {
        actor,
        action: 'export.downloaded',
        exportId: job.id,
        changedFieldKeys: [],
        ctx,
      });

      return {
        url,
        expires_at: new Date(now().getTime() + exportDownloadUrlTtlSeconds * 1000),
        file_name: file.fileName,
      };
    },

    typeLabel(type: ExportType): string {
      return exportTypeLabels[type];
    },
  };
}

export type ExportService = ReturnType<typeof createExportService>;
