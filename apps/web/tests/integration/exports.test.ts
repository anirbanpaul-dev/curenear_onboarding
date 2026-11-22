import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createPrismaClient,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
} from '@curenear/db';
import { GET, POST } from '@/app/api/v1/exports/route';
import { getServices } from '@/server/services';

/**
 * Export requests through the HTTP handlers.
 *
 * Administrators may export every type; staff may export only their own
 * providers and only the `providers` type. The tests also pin the one-running-job
 * limit, the audit trail and the fact that history is per requester.
 */
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

const CODE_PREFIX = 'CN-EX-';

describeDb('asynchronous exports (real PostgreSQL)', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let adminToken: string;
  let staffToken: string;
  let staff2Token: string;
  let adminId: string;
  let staffId: string;
  let staff2Id: string;
  let cookieName: string;
  let staffJobId: string;

  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl as string);
    const passwordHash = await hashPassword('integration-test-password');

    async function account(email: string, name: string, role: 'ADMIN' | 'STAFF') {
      return prisma.user.upsert({
        where: { email },
        update: {
          passwordHash,
          role,
          status: 'ACTIVE',
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
          deletedAt: null,
        },
        create: { id: randomUUID(), email, name, passwordHash, role },
      });
    }

    const admin = await account('exports-admin@test.local', 'Exports Admin', 'ADMIN');
    const staff = await account('exports-staff@test.local', 'Exports Staff', 'STAFF');
    const staff2 = await account('exports-staff2@test.local', 'Exports Staff Two', 'STAFF');
    adminId = admin.id;
    staffId = staff.id;
    staff2Id = staff2.id;

    // A previous interrupted run may have left rows behind; these accounts are
    // reused, so clear their export state before the tests start.
    await cleanupExports([admin.id, staff.id, staff2.id]);

    adminToken = generateSessionToken();
    staffToken = generateSessionToken();
    staff2Token = generateSessionToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.session.createMany({
      data: [
        { id: randomUUID(), userId: admin.id, tokenHash: hashSessionToken(adminToken), expiresAt },
        { id: randomUUID(), userId: staff.id, tokenHash: hashSessionToken(staffToken), expiresAt },
        {
          id: randomUUID(),
          userId: staff2.id,
          tokenHash: hashSessionToken(staff2Token),
          expiresAt,
        },
      ],
    });

    cookieName = process.env.SESSION_COOKIE_NAME ?? 'curenear_session';

    await prisma.providerOrganization.createMany({
      data: [
        {
          id: randomUUID(),
          code: `${CODE_PREFIX}${randomUUID().slice(0, 6)}-S1A`,
          providerType: 'clinic',
          status: 'APPROVED',
          legalName: 'Staff one clinic A',
          createdByUserId: staff.id,
        },
        {
          id: randomUUID(),
          code: `${CODE_PREFIX}${randomUUID().slice(0, 6)}-S1B`,
          providerType: 'pharmacy',
          status: 'DRAFT',
          legalName: 'Staff one pharmacy',
          createdByUserId: staff.id,
        },
        {
          id: randomUUID(),
          code: `${CODE_PREFIX}${randomUUID().slice(0, 6)}-S2A`,
          providerType: 'clinic',
          status: 'APPROVED',
          legalName: 'Staff two clinic',
          createdByUserId: staff2.id,
        },
      ],
    });
  });

  async function cleanupExports(userIds: string[]): Promise<void> {
    const jobs = await prisma.exportJob.findMany({
      where: { requestedByUserId: { in: userIds } },
      select: { id: true, fileDocumentId: true },
    });
    const jobIds = jobs.map((row) => row.id);
    const fileIds = jobs.flatMap((row) => (row.fileDocumentId ? [row.fileDocumentId] : []));

    // audit_logs is append-only by database trigger, and its actor FK keeps the
    // accounts: leave both, as the rest of the suite does. The accounts are
    // reused through the upsert above.
    await prisma.notification.deleteMany({ where: { entityId: { in: jobIds } } });
    await prisma.exportJob.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.exportFile.deleteMany({ where: { id: { in: fileIds } } });
    await prisma.providerOrganization.deleteMany({
      where: { code: { startsWith: CODE_PREFIX } },
    });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  }

  afterAll(async () => {
    await cleanupExports([adminId, staffId, staff2Id]);
    await prisma.$disconnect();
  });

  function request(
    path: string,
    token: string,
    init: { method?: string; body?: unknown } = {},
  ): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
      method: init.method ?? 'GET',
      headers: {
        cookie: `${cookieName}=${token}`,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  }

  it('queues a staff export scoped to the caller and audits it', async () => {
    const response = await POST(
      request('/api/v1/exports', staffToken, {
        method: 'POST',
        body: { type: 'providers', filters: {} },
      }),
    );
    expect(response.status).toBe(202);

    const body = (await response.json()) as {
      data: { id: string; type: string; status: string; downloads: unknown };
    };
    expect(body.data.type).toBe('providers');
    expect(body.data.status).toBe('QUEUED');

    const job = await prisma.exportJob.findUniqueOrThrow({ where: { id: body.data.id } });
    staffJobId = job.id;
    expect(job.requestedByUserId).toBe(staffId);
    // The owner is written into the stored filter, not trusted from the caller.
    expect(job.filters).toMatchObject({ onboardedBy: staffId });
    expect(job.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'export_job', entityId: job.id, action: 'export.requested' },
    });
    expect(audit?.actorUserId).toBe(staffId);
  });

  it('refuses a second export while one is still queued', async () => {
    const response = await POST(
      request('/api/v1/exports', staffToken, {
        method: 'POST',
        body: { type: 'providers', filters: {} },
      }),
    );
    expect(response.status).toBe(409);
  });

  it('refuses a non-provider export for staff', async () => {
    const response = await POST(
      request('/api/v1/exports', staffToken, {
        method: 'POST',
        body: { type: 'pin_summary', filters: {} },
      }),
    );
    expect(response.status).toBe(403);
  });

  it('refuses admin-only provider filters for staff', async () => {
    const response = await POST(
      request('/api/v1/exports', staffToken, {
        method: 'POST',
        body: { type: 'providers', filters: { state: randomUUID() } },
      }),
    );
    expect(response.status).toBe(422);
  });

  it('lets an administrator export any type', async () => {
    const pin = await POST(
      request('/api/v1/exports', adminToken, {
        method: 'POST',
        body: { type: 'pin_summary', filters: { groupBy: 'state' } },
      }),
    );
    expect(pin.status).toBe(202);
    const pinBody = (await pin.json()) as { data: { id: string } };
    const pinJob = await prisma.exportJob.findUniqueOrThrow({ where: { id: pinBody.data.id } });
    expect(pinJob.requestedByUserId).toBe(adminId);
    expect(pinJob.filters).toMatchObject({ groupBy: 'state', measure: 'primary' });
  });

  it('lists only the requester’s exports', async () => {
    const staffList = await GET(request('/api/v1/exports', staffToken));
    expect(staffList.status).toBe(200);
    const staffBody = (await staffList.json()) as {
      data: { rows: Array<{ id: string }>; meta: { total: number } };
    };
    expect(staffBody.data.rows.map((row) => row.id)).toContain(staffJobId);
    expect(staffBody.data.meta.total).toBeGreaterThanOrEqual(1);

    const otherList = await GET(request('/api/v1/exports', staff2Token));
    const otherBody = (await otherList.json()) as {
      data: { rows: Array<{ id: string }>; meta: { total: number } };
    };
    expect(otherBody.data.rows.map((row) => row.id)).not.toContain(staffJobId);
    expect(otherBody.data.meta.total).toBe(0);
  });

  it('does not sign a download before the file exists', async () => {
    const services = getServices();

    await expect(
      services.exports.download({ userId: staffId, role: 'STAFF' }, staffJobId, {
        requestId: randomUUID(),
        ipAddress: null,
        userAgent: null,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    await expect(
      services.exports.download({ userId: staff2Id, role: 'STAFF' }, staffJobId, {
        requestId: randomUUID(),
        ipAddress: null,
        userAgent: null,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects an unknown export type', async () => {
    const response = await POST(
      request('/api/v1/exports', adminToken, {
        method: 'POST',
        body: { type: 'everything', filters: {} },
      }),
    );
    expect(response.status).toBe(422);
  });
});
