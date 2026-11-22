import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, describe, expect, it } from 'vitest';
import pino from 'pino';
import { createPersistence, createPrismaClient, type PrismaClient } from '@curenear/db';
import { getServerEnv, type ExportType } from '@curenear/shared';
import type { AppContext } from '../../src/context';
import { createMemoryEmailService } from '../../src/email';
import { runExportCleanup, runExportJobs } from '../../src/jobs/exports';
import type { ExportStorage } from '../../src/storage';

/**
 * Export jobs against a real database, with storage faked in memory.
 *
 * The fake keeps what `putFile` read from the streamed temp file, so the
 * assertions cover the actual CSV bytes (BOM, escaping, owner scope) without an
 * S3 server. `FOR UPDATE SKIP LOCKED` is exercised by the real `claimNext`.
 */

const prisma: PrismaClient = createPrismaClient();
const persistence = createPersistence(prisma);

const ctx: AppContext = {
  env: getServerEnv(),
  prisma,
  repositories: persistence.repositories,
  unitOfWork: persistence.unitOfWork,
  logger: pino({ level: 'silent' }),
  email: createMemoryEmailService(),
  now: () => new Date(),
  fetchImpl: (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
};

function createFakeStorage() {
  const files = new Map<string, string>();
  const deleted: string[] = [];
  const storage: ExportStorage = {
    async putFile({ key, filePath }) {
      files.set(key, await readFile(filePath, 'utf8'));
    },
    async delete(key) {
      deleted.push(key);
      files.delete(key);
    },
  };
  return { storage, files, deleted };
}

const createdUsers: string[] = [];
const createdOrganizations: string[] = [];

async function createUser(role: 'ADMIN' | 'STAFF') {
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      email: `exports-${id}@example.test`,
      name: `Exports ${role}`,
      passwordHash: 'not-a-real-hash',
      role,
    },
  });
  createdUsers.push(id);
  return id;
}

async function createOrganization(input: {
  createdByUserId: string;
  code: string;
  legalName?: string | null;
}) {
  const id = randomUUID();
  await prisma.providerOrganization.create({
    data: {
      id,
      code: input.code,
      providerType: 'clinic',
      status: 'APPROVED',
      legalName: input.legalName ?? `Clinic ${input.code}`,
      primaryPinCode: '700001',
      createdByUserId: input.createdByUserId,
    },
  });
  createdOrganizations.push(id);
  return id;
}

async function createJob(input: {
  type: ExportType;
  requestedByUserId: string;
  filters?: Record<string, unknown>;
}) {
  return persistence.repositories.exports.createJob({
    id: randomUUID(),
    type: input.type,
    requestedByUserId: input.requestedByUserId,
    filters: input.filters ?? {},
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    createdAt: new Date(Date.now() - 60 * 60 * 1000),
  });
}

function lineCount(csv: string): number {
  return csv.split('\r\n').filter(Boolean).length;
}

describe('export jobs', () => {
  it('streams a staff export scoped to the requester and neutralises formulas', async () => {
    const staff = await createUser('STAFF');
    const other = await createUser('STAFF');
    const ownCode = `CN-EX-OWN-${randomUUID().slice(0, 6).toUpperCase()}`;
    const otherCode = `CN-EX-OTHER-${randomUUID().slice(0, 6).toUpperCase()}`;

    await createOrganization({
      createdByUserId: staff,
      code: ownCode,
      legalName: '=HYPERLINK("http://evil.test","click")',
    });
    await createOrganization({ createdByUserId: other, code: otherCode });

    const job = await createJob({ type: 'providers', requestedByUserId: staff });
    const fake = createFakeStorage();

    const summary = await runExportJobs(ctx, { storage: fake.storage, now: new Date() });
    expect(summary.processed).toBeGreaterThanOrEqual(1);

    const saved = await persistence.repositories.exports.findJob(job.id);
    expect(saved?.status).toBe('SUCCEEDED');
    expect(saved?.rowCount).toBe(1);
    expect(saved?.fileName).toMatch(/^providers-\d{4}-\d{2}-\d{2}-.*\.csv$/);

    const [csv] = Array.from(fake.files.values());
    expect(csv).toBeDefined();
    expect(csv?.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('Provider code');
    expect(csv).toContain(ownCode);
    expect(csv).not.toContain(otherCode);
    expect(csv).toContain("'=HYPERLINK");

    const notification = await prisma.notification.findFirst({
      where: { entityType: 'export_job', entityId: job.id },
    });
    expect(notification?.type).toBe('export.ready');
    expect(notification?.userId).toBe(staff);
    expect(notification?.body).toContain(`/api/v1/exports/${job.id}/download`);
  });

  it('streams a large result set one page at a time', async () => {
    const admin = await createUser('ADMIN');
    const prefix = `CN-EX-LARGE-${randomUUID().slice(0, 6).toUpperCase()}`;
    const total = 600;

    await prisma.providerOrganization.createMany({
      data: Array.from({ length: total }, (_, index) => ({
        id: randomUUID(),
        code: `${prefix}-${String(index).padStart(4, '0')}`,
        providerType: 'clinic' as const,
        status: 'APPROVED' as const,
        legalName: `Large dataset clinic ${index}`,
        primaryPinCode: '700002',
        createdByUserId: admin,
      })),
    });
    createdOrganizations.push(
      ...(
        await prisma.providerOrganization.findMany({
          where: { code: { startsWith: prefix } },
          select: { id: true },
        })
      ).map((row) => row.id),
    );

    const job = await createJob({
      type: 'providers',
      requestedByUserId: admin,
      filters: { q: prefix },
    });
    const fake = createFakeStorage();

    await runExportJobs(ctx, { storage: fake.storage, now: new Date() });

    const saved = await persistence.repositories.exports.findJob(job.id);
    expect(saved?.status).toBe('SUCCEEDED');
    expect(saved?.rowCount).toBe(total);

    const [csv] = Array.from(fake.files.values());
    expect(csv).toBeDefined();
    // Header + every provider; the worker never held the whole file as a value.
    expect(lineCount(csv as string)).toBe(total + 1);
  });

  it('fails a job that exceeds the row cap instead of writing it', async () => {
    const admin = await createUser('ADMIN');
    const prefix = `CN-EX-CAP-${randomUUID().slice(0, 6).toUpperCase()}`;

    await prisma.providerOrganization.createMany({
      data: Array.from({ length: 6 }, (_, index) => ({
        id: randomUUID(),
        code: `${prefix}-${index}`,
        providerType: 'clinic' as const,
        status: 'DRAFT' as const,
        legalName: `Cap clinic ${index}`,
        createdByUserId: admin,
      })),
    });
    createdOrganizations.push(
      ...(
        await prisma.providerOrganization.findMany({
          where: { code: { startsWith: prefix } },
          select: { id: true },
        })
      ).map((row) => row.id),
    );

    const job = await createJob({
      type: 'providers',
      requestedByUserId: admin,
      filters: { q: prefix },
    });
    const fake = createFakeStorage();
    const capped: AppContext = { ...ctx, env: { ...ctx.env, EXPORT_MAX_ROWS: 5 } };

    await runExportJobs(capped, { storage: fake.storage, now: new Date() });

    const saved = await persistence.repositories.exports.findJob(job.id);
    expect(saved?.status).toBe('FAILED');
    expect(saved?.error).toMatch(/more than 5 rows/i);
    expect(fake.files.size).toBe(0);
  });

  it('refuses a non-provider export requested by staff', async () => {
    const staff = await createUser('STAFF');
    const job = await createJob({ type: 'pin_summary', requestedByUserId: staff });
    const fake = createFakeStorage();

    await runExportJobs(ctx, { storage: fake.storage, now: new Date() });

    const saved = await persistence.repositories.exports.findJob(job.id);
    expect(saved?.status).toBe('FAILED');
    expect(saved?.error).toMatch(/staff may only export/i);
  });

  it('expires finished exports and deletes their objects', async () => {
    const admin = await createUser('ADMIN');
    const code = `CN-EX-EXPIRE-${randomUUID().slice(0, 6).toUpperCase()}`;
    await createOrganization({ createdByUserId: admin, code });

    const job = await createJob({
      type: 'providers',
      requestedByUserId: admin,
      filters: { q: code },
    });
    const fake = createFakeStorage();

    await runExportJobs(ctx, { storage: fake.storage, now: new Date() });
    const saved = await persistence.repositories.exports.findJob(job.id);
    expect(saved?.status).toBe('SUCCEEDED');
    expect(saved?.fileDocumentId).not.toBeNull();

    const file = await prisma.exportFile.findUniqueOrThrow({
      where: { id: saved!.fileDocumentId as string },
    });

    await prisma.exportJob.update({
      where: { id: job.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const summary = await runExportCleanup(ctx, { storage: fake.storage, now: new Date() });
    expect(summary.expired).toBeGreaterThanOrEqual(1);
    expect(fake.deleted).toContain(file.storageKey);

    const expired = await persistence.repositories.exports.findJob(job.id);
    expect(expired?.status).toBe('EXPIRED');
  });
});

afterAll(async () => {
  const users = await prisma.user.findMany({
    where: { OR: [{ email: { startsWith: 'exports-' } }, { id: { in: createdUsers } }] },
    select: { id: true },
  });
  const userIds = users.map((row) => row.id);

  const jobs = await prisma.exportJob.findMany({
    where: { requestedByUserId: { in: userIds } },
    select: { id: true, fileDocumentId: true },
  });
  const jobIds = jobs.map((row) => row.id);
  const fileIds = jobs.flatMap((row) => (row.fileDocumentId ? [row.fileDocumentId] : []));

  await prisma.notification.deleteMany({
    where: {
      OR: [{ entityId: { in: jobIds } }, { type: 'export.ready', userId: { in: userIds } }],
    },
  });
  await prisma.exportJob.deleteMany({ where: { id: { in: jobIds } } });
  await prisma.exportFile.deleteMany({
    where: {
      OR: [
        { id: { in: fileIds } },
        { storageKey: { startsWith: 'exports/cleanup-' } },
        { storageKey: { startsWith: 'exports/' }, fileName: { startsWith: 'providers-' } },
      ],
    },
  });
  await prisma.providerOrganization.deleteMany({
    where: {
      OR: [{ code: { startsWith: 'CN-EX-' } }, { id: { in: createdOrganizations } }],
    },
  });
  // Soft-delete rather than hard-delete: an audit row's FK would otherwise
  // update history, which the append-only trigger refuses.
  await prisma.user.updateMany({
    where: { id: { in: userIds } },
    data: { deletedAt: new Date(), status: 'INACTIVE' },
  });
  await prisma.$disconnect();
});
