import { describe, expect, it, vi } from 'vitest';
import type { Actor, ExportJobRecord, Repositories, UnitOfWork } from '@curenear/shared';
import { createExportService } from './export-service';
import type { RequestContext } from './service-deps';

const admin: Actor = { userId: '11111111-1111-4111-8111-111111111111', role: 'ADMIN' };
const staff: Actor = { userId: '22222222-2222-4222-8222-222222222222', role: 'STAFF' };
const ctx: RequestContext = {
  requestId: 'req-export',
  ipAddress: '203.0.113.5',
  userAgent: 'vitest',
};

const NOW = new Date('2026-11-22T10:00:00.000Z');

function job(patch: Partial<ExportJobRecord> = {}): ExportJobRecord {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    type: 'providers',
    status: 'QUEUED',
    requestedByUserId: staff.userId,
    filters: {},
    rowCount: null,
    fileName: null,
    fileDocumentId: null,
    error: null,
    expiresAt: new Date(NOW.getTime() + 24 * 3_600_000),
    createdAt: NOW,
    startedAt: null,
    finishedAt: null,
    ...patch,
  } as ExportJobRecord;
}

function setup(overrides: Partial<Repositories['exports']> = {}) {
  const audits: Array<Record<string, unknown>> = [];
  const repositories = {
    exports: {
      countActive: vi.fn(async () => 0),
      createJob: vi.fn(async (input: Parameters<Repositories['exports']['createJob']>[0]) =>
        job(input),
      ),
      listForUser: vi.fn(async () => ({ rows: [job()], total: 1 })),
      findJob: vi.fn(async () => job({ status: 'SUCCEEDED', fileDocumentId: 'file-1' })),
      findFile: vi.fn(async () => ({
        id: 'file-1',
        storageKey: 'exports/file.csv',
        fileName: 'providers.csv',
        mimeType: 'text/csv',
        sizeBytes: 123,
      })),
      ...overrides,
    },
    audits: {
      append: vi.fn(async (row: Record<string, unknown>) => {
        audits.push(row);
      }),
    },
  } as unknown as Repositories;

  const unitOfWork: UnitOfWork = {
    transaction: (work) => work(repositories),
  };

  const storage = {
    createUploadUrl: vi.fn(async () => 'https://upload.test'),
    createDownloadUrl: vi.fn(async () => 'https://download.test/file.csv'),
    read: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
  };

  const service = createExportService({
    repositories,
    unitOfWork,
    now: () => NOW,
    newId: () => '44444444-4444-4444-8444-444444444444',
    storage,
    appUrl: 'http://localhost:3000',
    retentionHours: 24,
  });

  return { service, repositories, audits, storage };
}

describe('export service', () => {
  it('queues an administrator export and audits the request', async () => {
    const { service, repositories, audits } = setup();
    const result = await service.create(
      admin,
      { type: 'providers', filters: { status: ['SUBMITTED'] } },
      ctx,
    );

    expect(result.status).toBe('QUEUED');
    expect(result.downloadable).toBe(false);
    expect(repositories.exports.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedByUserId: admin.userId,
        type: 'providers',
        filters: { status: ['SUBMITTED'] },
        createdAt: NOW,
        expiresAt: new Date(NOW.getTime() + 24 * 3_600_000),
      }),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'export.requested',
      entityType: 'export_job',
      actorUserId: admin.userId,
      requestId: ctx.requestId,
    });
  });

  it('pins a staff export to the staff owner and refuses admin-only types', async () => {
    const { service, repositories } = setup();
    await service.create(staff, { type: 'providers', filters: {} }, ctx);

    expect(repositories.exports.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ onboardedBy: staff.userId }),
      }),
    );

    await expect(
      service.create(
        staff,
        {
          type: 'pin_summary',
          filters: { order: 'desc', sort: 'total', groupBy: 'pin', measure: 'primary' },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows only one active export per account', async () => {
    const { service } = setup({ countActive: vi.fn(async () => 1) });
    await expect(
      service.create(admin, { type: 'providers', filters: {} }, ctx),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects staff filters that could widen their scope', async () => {
    const { service } = setup();
    await expect(
      service.create(
        staff,
        { type: 'providers', filters: { onboardedBy: admin.userId } as never },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('lists a page of exports with downloadability computed at request time', async () => {
    const { service } = setup({
      listForUser: vi.fn(async () => ({
        rows: [
          job({ status: 'SUCCEEDED', fileName: 'providers.csv', rowCount: 12 }),
          job({ status: 'FAILED', error: 'boom' }),
          job({ status: 'SUCCEEDED', expiresAt: new Date(NOW.getTime() - 1) }),
        ],
        total: 42,
      })),
    });

    const result = await service.list(staff, { page: 3, pageSize: 20 });
    expect(result.meta).toEqual({ page: 3, pageSize: 20, total: 42, totalPages: 3 });
    expect(result.rows.map((row) => row.downloadable)).toEqual([true, false, false]);
  });

  it('hides another account’s export and expired or unfinished jobs', async () => {
    const { service, repositories } = setup();
    repositories.exports.findJob = vi.fn(async () => null);
    await expect(service.download(staff, 'missing', ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    repositories.exports.findJob = vi.fn(async () => job({ requestedByUserId: admin.userId }));
    await expect(service.download(staff, job().id, ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    repositories.exports.findJob = vi.fn(async () =>
      job({ status: 'EXPIRED', requestedByUserId: staff.userId }),
    );
    await expect(service.download(staff, job().id, ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    repositories.exports.findJob = vi.fn(async () =>
      job({ status: 'RUNNING', requestedByUserId: staff.userId }),
    );
    await expect(service.download(staff, job().id, ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('not ready'),
    });

    repositories.exports.findJob = vi.fn(async () =>
      job({ status: 'FAILED', requestedByUserId: staff.userId }),
    );
    await expect(service.download(staff, job().id, ctx)).rejects.toMatchObject({
      message: 'This export failed',
    });
  });

  it('signs a download URL for a finished file and audits the download', async () => {
    const { service, audits, storage } = setup();
    const result = await service.download(staff, job().id, ctx);

    expect(result.file_name).toBe('providers.csv');
    expect(result.url).toBe('https://download.test/file.csv');
    expect(result.expires_at.getTime()).toBe(NOW.getTime() + 300_000);
    expect(storage.createDownloadUrl).toHaveBeenCalledWith({
      key: 'exports/file.csv',
      expiresInSeconds: 300,
    });
    expect(audits.at(-1)).toMatchObject({ action: 'export.downloaded', actorUserId: staff.userId });
  });

  it('reports a missing file row instead of signing nothing', async () => {
    const { service } = setup({ findFile: vi.fn(async () => null) });
    await expect(service.download(staff, job().id, ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Export file not found',
    });
  });

  it('exposes the human label for a type', () => {
    const { service } = setup();
    expect(service.typeLabel('providers')).toBeTruthy();
  });
});
