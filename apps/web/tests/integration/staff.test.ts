import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createPrismaClient,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
} from '@curenear/db';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { GET as listStaff, POST as createStaff } from '@/app/api/v1/admin/staff/route';
import {
  DELETE as deleteStaff,
  GET as getStaff,
  PATCH as updateStaff,
} from '@/app/api/v1/admin/staff/[id]/route';
import { POST as deactivateStaff } from '@/app/api/v1/admin/staff/[id]/deactivate/route';
import { POST as reactivateStaff } from '@/app/api/v1/admin/staff/[id]/reactivate/route';
import { POST as resetStaffPassword } from '@/app/api/v1/admin/staff/[id]/reset-password/route';
import { GET as providersRoute } from '@/app/api/v1/providers/route';

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

const COOKIE = process.env.SESSION_COOKIE_NAME ?? 'curenear_session';
const ADMIN_EMAIL = 'staff-admin@test.local';
const STAFF_EMAIL = 'staff-member@test.local';
const PASSWORD = 'integration-password-123';

let ipSeed = 0;
function nextIp(): string {
  ipSeed += 1;
  return `10.30.${Math.floor(ipSeed / 250)}.${(ipSeed % 250) + 1}`;
}

function jsonRequest(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function authed(path: string, token: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      cookie: `${COOKIE}=${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function sessionCookie(response: Response): string {
  const header = response.headers.get('set-cookie') ?? '';
  const match = new RegExp(`${COOKIE}=([^;]+)`).exec(header);
  if (!match?.[1]) throw new Error(`no session cookie in: ${header}`);
  return match[1];
}

describeDb('staff management (real PostgreSQL)', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let adminId: string;
  let staffId: string;
  let adminToken: string;
  let staffToken: string;
  const createdEmails: string[] = [];

  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl as string);
    const passwordHash = await hashPassword(PASSWORD);

    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {
        passwordHash,
        role: 'ADMIN',
        status: 'ACTIVE',
        mustChangePassword: false,
        failedLoginCount: 0,
        lockedUntil: null,
        deletedAt: null,
      },
      create: {
        id: randomUUID(),
        email: ADMIN_EMAIL,
        name: 'Staff Admin',
        passwordHash,
        role: 'ADMIN',
      },
    });
    const staff = await prisma.user.upsert({
      where: { email: STAFF_EMAIL },
      update: {
        passwordHash,
        role: 'STAFF',
        status: 'ACTIVE',
        mustChangePassword: false,
        failedLoginCount: 0,
        lockedUntil: null,
        deletedAt: null,
      },
      create: {
        id: randomUUID(),
        email: STAFF_EMAIL,
        name: 'Staff Member',
        passwordHash,
        role: 'STAFF',
      },
    });
    adminId = admin.id;
    staffId = staff.id;

    await prisma.session.deleteMany({ where: { userId: { in: [adminId, staffId] } } });
    adminToken = generateSessionToken();
    staffToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.session.createMany({
      data: [
        { id: randomUUID(), userId: adminId, tokenHash: hashSessionToken(adminToken), expiresAt },
        { id: randomUUID(), userId: staffId, tokenHash: hashSessionToken(staffToken), expiresAt },
      ],
    });
  });

  afterAll(async () => {
    // Users stay (audit rows reference them); soft delete keeps them out of the UI.
    await prisma.user.updateMany({
      where: { email: { in: createdEmails } },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });
    await prisma.session.deleteMany({ where: { userId: { in: [adminId, staffId] } } });
    await prisma.$disconnect();
  });

  function staffBody(overrides: Record<string, unknown> = {}) {
    const email = `staff-e2e-${randomUUID()}@curenear.test`;
    createdEmails.push(email);
    return {
      name: 'New Staffer',
      email,
      mobile: '9876543210',
      employeeCode: `E2E${randomUUID().slice(0, 8)}`,
      pinCodes: ['700016', '700091'],
      ...overrides,
    };
  }

  async function createAsAdmin(body: Record<string, unknown>) {
    const response = await createStaff(
      jsonRequest('/api/v1/admin/staff', body, {
        cookie: `${COOKIE}=${adminToken}`,
      }),
    );
    const payload = (await response.json()) as {
      data: { staff: { id: string; email: string }; temporaryPassword: string };
    };
    return { response, payload };
  }

  it('creates a staff account with a one-time temporary password, PINs, audit and event', async () => {
    const body = staffBody();
    const { response, payload } = await createAsAdmin(body);

    expect(response.status).toBe(201);
    expect(payload.data.temporaryPassword).toHaveLength(19);
    expect(payload.data.staff.email).toBe(body.email);

    const row = await prisma.user.findUnique({
      where: { email: body.email },
      include: { pinAssignments: true },
    });
    expect(row?.role).toBe('STAFF');
    expect(row?.mustChangePassword).toBe(true);
    expect(row?.employeeCode).toBe(body.employeeCode);
    expect(row?.mobile).toBe(body.mobile);
    expect(row?.pinAssignments.map((pin) => pin.pinCode).sort()).toEqual(['700016', '700091']);

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: row?.id ?? '', action: 'staff.created' },
    });
    expect(audit?.actorUserId).toBe(adminId);

    const event = await prisma.outboxEvent.findFirst({
      where: { aggregateId: row?.id ?? '', eventType: 'staff.created' },
    });
    expect(event).not.toBeNull();
    expect(event?.payload).toMatchObject({ staffUserId: row?.id, role: 'STAFF' });
    expect(JSON.stringify(event?.payload)).not.toContain(body.email);
  });

  it('lets the new staff member sign in, forcing a password change first', async () => {
    const body = staffBody();
    const { payload } = await createAsAdmin(body);

    const login = await loginRoute(
      jsonRequest(
        '/api/auth/login',
        { email: body.email, password: payload.data.temporaryPassword },
        {
          'x-forwarded-for': nextIp(),
        },
      ),
    );
    expect(login.status).toBe(200);
    const loginBody = (await login.json()) as {
      data: { mustChangePassword: boolean; redirectTo: string };
    };
    expect(loginBody.data.mustChangePassword).toBe(true);
    expect(loginBody.data.redirectTo).toBe('/change-password');

    const blocked = await providersRoute(
      new NextRequest('http://localhost/api/v1/providers', {
        headers: { cookie: `${COOKIE}=${sessionCookie(login)}` },
      }),
    );
    expect(blocked.status).toBe(403);
    const blockedBody = (await blocked.json()) as { error: { code: string } };
    expect(blockedBody.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('forbids a STAFF account from every admin staff endpoint', async () => {
    const body = staffBody();
    const { payload } = await createAsAdmin(body);
    const targetId = payload.data.staff.id;

    const attempts: Array<[string, Promise<Response>]> = [
      ['list', listStaff(authed('/api/v1/admin/staff', staffToken))],
      ['create', createStaff(authed('/api/v1/admin/staff', staffToken, 'POST', staffBody()))],
      ['get', getStaff(authed(`/api/v1/admin/staff/${targetId}`, staffToken), params(targetId))],
      [
        'update',
        updateStaff(
          authed(`/api/v1/admin/staff/${targetId}`, staffToken, 'PATCH', { name: 'Hacked' }),
          params(targetId),
        ),
      ],
      [
        'delete',
        deleteStaff(
          authed(`/api/v1/admin/staff/${targetId}`, staffToken, 'DELETE', {
            reason: 'not allowed',
          }),
          params(targetId),
        ),
      ],
      [
        'deactivate',
        deactivateStaff(
          authed(`/api/v1/admin/staff/${targetId}/deactivate`, staffToken, 'POST', {
            reason: 'not allowed',
          }),
          params(targetId),
        ),
      ],
      [
        'reactivate',
        reactivateStaff(
          authed(`/api/v1/admin/staff/${targetId}/reactivate`, staffToken, 'POST'),
          params(targetId),
        ),
      ],
      [
        'reset-password',
        resetStaffPassword(
          authed(`/api/v1/admin/staff/${targetId}/reset-password`, staffToken, 'POST'),
          params(targetId),
        ),
      ],
    ];

    for (const [label, promise] of attempts) {
      const response = await promise;
      expect(response.status, `${label} should be forbidden`).toBe(403);
      const payloadBody = (await response.json()) as { error: { code: string } };
      expect(payloadBody.error.code, label).toBe('FORBIDDEN');
    }

    // Nothing changed behind the 403s.
    const untouched = await prisma.user.findUnique({ where: { id: targetId } });
    expect(untouched?.name).toBe(body.name);
    expect(untouched?.deletedAt).toBeNull();
  });

  it('validates email uniqueness, employee codes and the mobile format', async () => {
    const body = staffBody();
    await createAsAdmin(body);

    const duplicateEmail = await createAsAdmin(staffBody({ email: body.email }));
    expect(duplicateEmail.response.status).toBe(409);

    const duplicateCode = await createAsAdmin(staffBody({ employeeCode: body.employeeCode }));
    expect(duplicateCode.response.status).toBe(409);

    const badMobile = await createAsAdmin(staffBody({ mobile: '12345' }));
    expect(badMobile.response.status).toBe(422);

    const badPin = await createAsAdmin(staffBody({ pinCodes: ['0123'] }));
    expect(badPin.response.status).toBe(422);
  });

  it('ends every session immediately when an account is deactivated', async () => {
    const body = staffBody();
    const { payload } = await createAsAdmin(body);

    const login = await loginRoute(
      jsonRequest(
        '/api/auth/login',
        { email: body.email, password: payload.data.temporaryPassword },
        {
          'x-forwarded-for': nextIp(),
        },
      ),
    );
    const token = sessionCookie(login);

    const { GET: meRoute } = await import('@/app/api/auth/me/route');
    const before = await meRoute(
      new NextRequest('http://localhost/api/auth/me', {
        headers: { cookie: `${COOKIE}=${token}` },
      }),
    );
    expect(before.status).toBe(200);

    const deactivated = await deactivateStaff(
      authed(`/api/v1/admin/staff/${payload.data.staff.id}/deactivate`, adminToken, 'POST', {
        reason: 'Left the organisation',
      }),
      params(payload.data.staff.id),
    );
    expect(deactivated.status).toBe(200);

    const after = await meRoute(
      new NextRequest('http://localhost/api/auth/me', {
        headers: { cookie: `${COOKIE}=${token}` },
      }),
    );
    expect(after.status).toBe(401);

    const row = await prisma.user.findUnique({ where: { id: payload.data.staff.id } });
    expect(row?.status).toBe('INACTIVE');
  });

  it('resets a password: the old one stops working and the new one forces a change', async () => {
    const body = staffBody();
    const { payload } = await createAsAdmin(body);

    const reset = await resetStaffPassword(
      authed(`/api/v1/admin/staff/${payload.data.staff.id}/reset-password`, adminToken, 'POST'),
      params(payload.data.staff.id),
    );
    expect(reset.status).toBe(200);
    const resetBody = (await reset.json()) as { data: { temporaryPassword: string } };
    expect(resetBody.data.temporaryPassword).toHaveLength(19);

    const oldLogin = await loginRoute(
      jsonRequest(
        '/api/auth/login',
        { email: body.email, password: payload.data.temporaryPassword },
        {
          'x-forwarded-for': nextIp(),
        },
      ),
    );
    expect(oldLogin.status).toBe(401);

    const newLogin = await loginRoute(
      jsonRequest(
        '/api/auth/login',
        {
          email: body.email,
          password: resetBody.data.temporaryPassword,
        },
        { 'x-forwarded-for': nextIp() },
      ),
    );
    expect(newLogin.status).toBe(200);
    const newBody = (await newLogin.json()) as { data: { mustChangePassword: boolean } };
    expect(newBody.data.mustChangePassword).toBe(true);
  });

  it('lists and filters the directory for an admin', async () => {
    const body = staffBody({ name: 'Filterable Person' });
    await createAsAdmin(body);

    const search = await listStaff(
      authed(`/api/v1/admin/staff?q=Filterable&status=ACTIVE&page=1&pageSize=20`, adminToken),
    );
    expect(search.status).toBe(200);
    const listBody = (await search.json()) as {
      data: Array<{ email: string; status: string }>;
      meta: { total: number };
    };
    expect(listBody.data.some((row) => row.email === body.email)).toBe(true);
    expect(listBody.data.every((row) => row.status === 'ACTIVE')).toBe(true);
    expect(listBody.meta.total).toBeGreaterThanOrEqual(1);
  });
});
