import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createPrismaClient,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
} from '@curenear/db';
import { GET as searchPincodes } from '@/app/api/v1/master/pincodes/search/route';
import { GET as getPincode } from '@/app/api/v1/master/pincodes/[pin]/route';
import { GET as listStates } from '@/app/api/v1/master/states/route';
import { GET as listSpecialties } from '@/app/api/v1/master/specialties/route';
import { GET as listDocumentTypes } from '@/app/api/v1/master/document-types/route';
import { POST as importPincodesRoute } from '@/app/api/v1/admin/master/pincodes/import/route';
import { POST as createSpecialty } from '@/app/api/v1/admin/master/specialties/route';
import {
  DELETE as deleteSpecialty,
  PATCH as patchSpecialty,
} from '@/app/api/v1/admin/master/specialties/[id]/route';

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

const COOKIE = process.env.SESSION_COOKIE_NAME ?? 'curenear_session';
const ADMIN_EMAIL = 'master-admin@test.local';
const STAFF_EMAIL = 'master-staff@test.local';
const PASSWORD = 'integration-password-123';

function request(path: string, token?: string, init: { method?: string; body?: unknown } = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(token ? { cookie: `${COOKIE}=${token}` } : {}),
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describeDb('master data API (real PostgreSQL)', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let adminId: string;
  let staffId: string;
  let adminToken: string;
  let staffToken: string;
  let stateId: string;
  let districtId: string;
  const stateCode = `ZZ-MASTER-${randomUUID().slice(0, 8)}`;
  const stateName = `Master State ${randomUUID().slice(0, 6)}`;
  const specialtyCodes: string[] = [];

  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl as string);
    const passwordHash = await hashPassword(PASSWORD);

    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: { passwordHash, role: 'ADMIN', status: 'ACTIVE', mustChangePassword: false },
      create: {
        id: randomUUID(),
        email: ADMIN_EMAIL,
        name: 'Master Admin',
        passwordHash,
        role: 'ADMIN',
      },
    });
    const staff = await prisma.user.upsert({
      where: { email: STAFF_EMAIL },
      update: { passwordHash, role: 'STAFF', status: 'ACTIVE', mustChangePassword: false },
      create: {
        id: randomUUID(),
        email: STAFF_EMAIL,
        name: 'Master Staff',
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

    const state = await prisma.state.create({
      data: { id: randomUUID(), code: stateCode, name: stateName },
      select: { id: true },
    });
    stateId = state.id;
    const district = await prisma.district.create({
      data: { id: randomUUID(), stateId, name: 'Search District' },
      select: { id: true },
    });
    districtId = district.id;

    await prisma.pinCode.createMany({
      data: [
        {
          pinCode: '998001',
          officeName: 'Search Alpha S.O',
          stateId,
          districtId,
          latitude: 22.5,
          longitude: 88.3,
        },
        { pinCode: '998002', officeName: 'Search Beta B.O', stateId, districtId },
        { pinCode: '998010', officeName: 'Unrelated Office', stateId, districtId },
      ],
    });
  });

  afterAll(async () => {
    await prisma.pinCode.deleteMany({ where: { stateId } });
    await prisma.district.deleteMany({ where: { stateId } });
    await prisma.state.deleteMany({ where: { id: stateId } });
    if (specialtyCodes.length > 0) {
      await prisma.specialty.deleteMany({ where: { code: { in: specialtyCodes } } });
    }
    await prisma.session.deleteMany({ where: { userId: { in: [adminId, staffId] } } });
    await prisma.$disconnect();
  });

  it('searches the PIN directory by PIN prefix and office name', async () => {
    const byPin = await searchPincodes(
      request('/api/v1/master/pincodes/search?q=9980', adminToken),
    );
    expect(byPin.status).toBe(200);
    const pinBody = (await byPin.json()) as {
      data: Array<{ pinCode: string; districtName: string | null; stateName: string | null }>;
    };
    expect(pinBody.data.map((row) => row.pinCode).sort()).toEqual(['998001', '998002', '998010']);
    expect(pinBody.data[0]?.stateName).toBe(stateName);
    expect(pinBody.data[0]?.districtName).toBe('Search District');
    expect(byPin.headers.get('cache-control')).toContain('max-age=60');

    const byOffice = await searchPincodes(
      request('/api/v1/master/pincodes/search?q=search%20al', adminToken),
    );
    const officeBody = (await byOffice.json()) as { data: Array<{ pinCode: string }> };
    expect(officeBody.data.map((row) => row.pinCode)).toEqual(['998001']);

    const tooShort = await searchPincodes(
      request('/api/v1/master/pincodes/search?q=9', adminToken),
    );
    expect(tooShort.status).toBe(422);

    const anonymous = await searchPincodes(request('/api/v1/master/pincodes/search?q=9980'));
    expect(anonymous.status).toBe(401);

    // Staff need the directory to fill in addresses, so reads are open to them.
    const asStaff = await searchPincodes(
      request('/api/v1/master/pincodes/search?q=9980', staffToken),
    );
    expect(asStaff.status).toBe(200);
  });

  it('returns a PIN with its district and state, and 404 for an unknown PIN', async () => {
    const found = await getPincode(request('/api/v1/master/pincodes/998001', adminToken), {
      params: Promise.resolve({ pin: '998001' }),
    });
    expect(found.status).toBe(200);
    const body = (await found.json()) as {
      data: { pinCode: string; districtName: string; stateName: string; latitude: number };
    };
    expect(body.data.districtName).toBe('Search District');
    expect(body.data.stateName).toBe(stateName);
    expect(body.data.latitude).toBeCloseTo(22.5);
    expect(found.headers.get('cache-control')).toContain('max-age=86400');

    const missing = await getPincode(request('/api/v1/master/pincodes/999999', adminToken), {
      params: Promise.resolve({ pin: '999999' }),
    });
    expect(missing.status).toBe(404);

    const malformed = await getPincode(request('/api/v1/master/pincodes/12345', adminToken), {
      params: Promise.resolve({ pin: '12345' }),
    });
    expect(malformed.status).toBe(422);
  });

  it('serves the reference lists to any signed-in account', async () => {
    const states = await listStates(request('/api/v1/master/states', staffToken));
    expect(states.status).toBe(200);
    const stateBody = (await states.json()) as { data: Array<{ id: string; name: string }> };
    expect(stateBody.data.some((state) => state.id === stateId)).toBe(true);

    const specialties = await listSpecialties(
      request('/api/v1/master/specialties?includeInactive=true', staffToken),
    );
    expect(specialties.status).toBe(200);

    const documents = await listDocumentTypes(
      request('/api/v1/master/document-types?providerType=doctor', staffToken),
    );
    expect(documents.status).toBe(200);
    const documentBody = (await documents.json()) as {
      data: Array<{ providerTypes: string[] }>;
    };
    // The filter is only meaningful if something matches; the seed provides them.
    expect(documentBody.data.every((row) => row.providerTypes.includes('doctor'))).toBe(true);
  });

  it('lets only an admin create, edit and retire a master data row', async () => {
    const code = `test-specialty-${randomUUID().slice(0, 8)}`;
    specialtyCodes.push(code);

    const staffAttempt = await createSpecialty(
      request('/api/v1/admin/master/specialties', staffToken, {
        method: 'POST',
        body: { code, name: 'Blocked Specialty', systemOfMedicine: 'allopathy' },
      }),
    );
    expect(staffAttempt.status).toBe(403);

    const created = await createSpecialty(
      request('/api/v1/admin/master/specialties', adminToken, {
        method: 'POST',
        body: { code, name: 'Test Specialty', systemOfMedicine: 'allopathy' },
      }),
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      data: { id: string; code: string; isActive: boolean };
    };
    expect(createdBody.data.isActive).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: createdBody.data.id, action: 'master_data.created' },
    });
    expect(audit?.entityType).toBe('master_data');
    expect(audit?.actorUserId).toBe(adminId);

    const duplicate = await createSpecialty(
      request('/api/v1/admin/master/specialties', adminToken, {
        method: 'POST',
        body: { code, name: 'Duplicate', systemOfMedicine: 'allopathy' },
      }),
    );
    expect(duplicate.status).toBe(409);

    const invalid = await createSpecialty(
      request('/api/v1/admin/master/specialties', adminToken, {
        method: 'POST',
        body: { code: `${code}-x`, name: 'Bad System', systemOfMedicine: 'astrology' },
      }),
    );
    expect(invalid.status).toBe(422);

    const patched = await patchSpecialty(
      request(`/api/v1/admin/master/specialties/${createdBody.data.id}`, adminToken, {
        method: 'PATCH',
        body: { name: 'Renamed Specialty' },
      }),
      params(createdBody.data.id),
    );
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as { data: { name: string } };
    expect(patchedBody.data.name).toBe('Renamed Specialty');

    const retired = await deleteSpecialty(
      request(`/api/v1/admin/master/specialties/${createdBody.data.id}`, adminToken, {
        method: 'DELETE',
      }),
      params(createdBody.data.id),
    );
    expect(retired.status).toBe(200);
    const retiredBody = (await retired.json()) as { data: { isActive: boolean } };
    expect(retiredBody.data.isActive).toBe(false);

    const row = await prisma.specialty.findUnique({ where: { id: createdBody.data.id } });
    expect(row?.isActive).toBe(false);

    const deleteAudit = await prisma.auditLog.findFirst({
      where: { entityId: createdBody.data.id, action: 'master_data.deleted' },
    });
    expect(deleteAudit).not.toBeNull();

    const activeOnly = await listSpecialties(
      request(`/api/v1/master/specialties?q=${code}`, adminToken),
    );
    const activeBody = (await activeOnly.json()) as { data: unknown[] };
    expect(activeBody.data).toHaveLength(0);
  });

  function uploadRequest(
    token: string | undefined,
    csv: string,
    options: { fileName?: string; dryRun?: boolean } = {},
  ) {
    const form = new FormData();
    form.append('file', new File([csv], options.fileName ?? 'pincodes.csv', { type: 'text/csv' }));
    form.append('dryRun', options.dryRun ? 'true' : 'false');
    return new NextRequest('http://localhost/api/v1/admin/master/pincodes/import', {
      method: 'POST',
      headers: token ? { cookie: `${COOKIE}=${token}` } : {},
      body: form,
    });
  }

  function uploadCsv(pins: Array<[string, string]>, state: string): string {
    return [
      'officename,pincode,Deliverystatus,Districtname,statename',
      ...pins.map(([pin, office]) => `"${office}",${pin},Delivery,Search District,${state}`),
    ].join('\r\n');
  }

  it('imports a PIN code CSV uploaded from the browser, idempotently', async () => {
    const csv = uploadCsv(
      [
        ['997001', 'Upload Alpha S.O'],
        ['997002', 'Upload Beta B.O'],
      ],
      stateName,
    );

    const staffAttempt = await importPincodesRoute(uploadRequest(staffToken, csv));
    expect(staffAttempt.status).toBe(403);

    const first = await importPincodesRoute(uploadRequest(adminToken, csv));
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      data: { added: number; skipped: number; fileName: string; stats: { totalPins: number } };
    };
    expect(firstBody.data.added).toBe(2);
    expect(firstBody.data.skipped).toBe(0);
    expect(firstBody.data.fileName).toBe('pincodes.csv');
    expect(firstBody.data.stats.totalPins).toBeGreaterThanOrEqual(5);

    const imported = await prisma.pinCode.findUnique({ where: { pinCode: '997001' } });
    expect(imported?.officeName).toBe('Upload Alpha S.O');
    expect(imported?.stateId).toBe(stateId);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'master_data.imported', entityId: 'pin_codes' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.actorUserId).toBe(adminId);
    // The uploaded file name is part of the trail.
    expect(audit?.reason).toContain('pincodes.csv');
    expect(audit?.reason).toContain('2 added');

    // Same file again: recognised as unchanged, nothing duplicated.
    const second = await importPincodesRoute(uploadRequest(adminToken, csv));
    const secondBody = (await second.json()) as {
      data: { added: number; updated: number; unchanged: number };
    };
    expect(secondBody.data.added).toBe(0);
    expect(secondBody.data.updated).toBe(0);
    expect(secondBody.data.unchanged).toBe(2);
    expect(await prisma.pinCode.count({ where: { pinCode: { startsWith: '99700' } } })).toBe(2);
  });

  it('validates an upload before writing anything', async () => {
    const csv = uploadCsv([['997010', 'Upload Dry S.O']], stateName);

    const dryRun = await importPincodesRoute(uploadRequest(adminToken, csv, { dryRun: true }));
    expect(dryRun.status).toBe(200);
    const dryBody = (await dryRun.json()) as { data: { added: number; dryRun: boolean } };
    expect(dryBody.data.added).toBe(1);
    expect(dryBody.data.dryRun).toBe(true);
    expect(await prisma.pinCode.findUnique({ where: { pinCode: '997010' } })).toBeNull();

    const wrongType = await importPincodesRoute(
      uploadRequest(adminToken, csv, { fileName: 'pincodes.xlsx' }),
    );
    expect(wrongType.status).toBe(422);

    const noPinColumn = await importPincodesRoute(
      uploadRequest(adminToken, 'office,code\nAlpha,997020'),
    );
    expect(noPinColumn.status).toBe(422);
    const noPinBody = (await noPinColumn.json()) as { error: { message: string } };
    expect(noPinBody.error.message).toContain('pincode');
  });
});
