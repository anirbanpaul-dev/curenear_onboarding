import { Prisma } from '@prisma/client';
import type {
  ExportFileRecord,
  ExportJobRecord,
  ExportRepository,
  ExportStatus,
  ExportType,
} from '@curenear/shared';
import type { DbClient } from '../client';
import { toJsonObject } from '../mappers';

/** Queued jobs left RUNNING longer than this are assumed crashed and reclaimed. */
const STALE_RUNNING_MS = 15 * 60 * 1000;

type JobRow = Prisma.ExportJobGetPayload<{ include: { fileDocument: true } }>;

function mapJob(row: JobRow): ExportJobRecord {
  return {
    id: row.id,
    type: row.type as ExportType,
    status: row.status as ExportStatus,
    requestedByUserId: row.requestedByUserId,
    filters: toJsonObject(row.filters),
    rowCount: row.rowCount,
    fileDocumentId: row.fileDocumentId,
    fileName: row.fileDocument?.fileName ?? null,
    sizeBytes: row.fileDocument?.sizeBytes ?? null,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    error: row.error,
  };
}

function mapFile(row: {
  id: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}): ExportFileRecord {
  return {
    id: row.id,
    storageKey: row.storageKey,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt,
  };
}

interface ClaimedRow {
  id: string;
  type: string;
  status: string;
  requested_by_user_id: string;
  filters: Prisma.JsonValue;
  row_count: number | null;
  file_document_id: string | null;
  expires_at: Date;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  error: string | null;
}

/**
 * Export jobs: the queue the worker drains and the history on /exports.
 *
 * `claimNext` is the only way a job starts. The claim is atomic and skips rows
 * another worker holds, so several workers can run side by side.
 */
export function createExportRepository(db: DbClient): ExportRepository {
  return {
    async createJob(input) {
      const row = await db.exportJob.create({
        data: {
          id: input.id,
          type: input.type,
          requestedByUserId: input.requestedByUserId,
          filters: input.filters as Prisma.InputJsonValue,
          expiresAt: input.expiresAt,
          createdAt: input.createdAt,
        },
        include: { fileDocument: true },
      });
      return mapJob(row);
    },

    async findJob(id) {
      const row = await db.exportJob.findUnique({
        where: { id },
        include: { fileDocument: true },
      });
      return row ? mapJob(row) : null;
    },

    async claimNext(now) {
      const staleBefore = new Date(now.getTime() - STALE_RUNNING_MS);
      // The columns are `timestamp(3)` without a zone, so the bound dates are
      // pinned to UTC explicitly. Letting PostgreSQL cast the parameter would
      // store local wall-clock time and shift every history timestamp.
      const startedAt = now.toISOString();
      const staleAt = staleBefore.toISOString();
      const rows = await db.$queryRaw<ClaimedRow[]>(Prisma.sql`
        UPDATE "export_jobs"
           SET "status" = 'RUNNING'::"ExportStatus",
               "started_at" = ${startedAt}::timestamptz AT TIME ZONE 'UTC',
               "finished_at" = NULL,
               "error" = NULL,
               "updated_at" = ${startedAt}::timestamptz AT TIME ZONE 'UTC'
         WHERE "id" = (
           SELECT "id"
             FROM "export_jobs"
            WHERE "status" = 'QUEUED'::"ExportStatus"
               OR (
                 "status" = 'RUNNING'::"ExportStatus"
                 AND "started_at" < ${staleAt}::timestamptz AT TIME ZONE 'UTC'
               )
            ORDER BY "created_at" ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
         )
        RETURNING "id",
                  "type"::text AS "type",
                  "status"::text AS "status",
                  "requested_by_user_id",
                  "filters",
                  "row_count",
                  "file_document_id",
                  "expires_at",
                  "created_at",
                  "started_at",
                  "finished_at",
                  "error"
      `);

      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        type: row.type as ExportType,
        status: row.status as ExportStatus,
        requestedByUserId: row.requested_by_user_id,
        filters: toJsonObject(row.filters),
        rowCount: row.row_count,
        fileDocumentId: row.file_document_id,
        fileName: null,
        sizeBytes: null,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        error: row.error,
      };
    },

    async completeJob(input) {
      await db.exportFile.create({
        data: {
          id: input.file.id,
          storageKey: input.file.storageKey,
          fileName: input.file.fileName,
          mimeType: input.file.mimeType,
          sizeBytes: input.file.sizeBytes,
        },
      });
      await db.exportJob.update({
        where: { id: input.id },
        data: {
          status: 'SUCCEEDED',
          fileDocumentId: input.file.id,
          rowCount: input.rowCount,
          finishedAt: input.finishedAt,
          error: null,
          updatedAt: input.finishedAt,
        },
      });
    },

    async failJob(input) {
      await db.exportJob.update({
        where: { id: input.id },
        data: {
          status: 'FAILED',
          finishedAt: input.finishedAt,
          error: input.error.slice(0, 2000),
          updatedAt: input.finishedAt,
        },
      });
    },

    async listForUser(userId, page) {
      const [rows, total] = await Promise.all([
        db.exportJob.findMany({
          where: { requestedByUserId: userId },
          orderBy: { createdAt: 'desc' },
          skip: page.skip,
          take: page.take,
          include: { fileDocument: true },
        }),
        db.exportJob.count({ where: { requestedByUserId: userId } }),
      ]);
      return { rows: rows.map(mapJob), total };
    },

    async countActive(userId) {
      return db.exportJob.count({
        where: { requestedByUserId: userId, status: { in: ['QUEUED', 'RUNNING'] } },
      });
    },

    async findFile(id) {
      const row = await db.exportFile.findUnique({ where: { id } });
      return row ? mapFile(row) : null;
    },

    async expireDue(now) {
      const rows = await db.exportJob.findMany({
        where: { status: 'SUCCEEDED', expiresAt: { lte: now } },
        select: { id: true, fileDocument: { select: { storageKey: true } } },
        take: 500,
      });
      if (rows.length === 0) return [];

      await db.exportJob.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
        data: { status: 'EXPIRED', error: null, updatedAt: now },
      });

      return rows.flatMap((row) => (row.fileDocument ? [row.fileDocument.storageKey] : []));
    },
  };
}
