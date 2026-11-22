import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createPrismaClient,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
} from '@curenear/db';

/**
 * Provider onboarding API against real PostgreSQL: ownership (404, not 403),
 * optimistic locking, duplicate detection, idempotency, primary-PIN sync and the
 * review lifecycle with its history/audit/outbox rows.
 */
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

interface Seed {
  adminToken: string;
  staffAToken: string;
  staffBToken: string;
  staffAId: string;
  staffBId: string;
  adminId: string;
  cookieName: string;
}

const body = <T>(value: T) => JSON.stringify(value);

describeDb('provider onboarding API (real PostgreSQL)', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let seed: Seed;
  let clinicId = '';
  let otherClinicId = '';
  // Rows are removed afterwards: the dev database is shared with other suites
  // that count organizations per PIN.
  const createdByIds: string[] = [];

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

    const admin = await account('onboarding-admin@test.local', 'Onboarding Admin', 'ADMIN');
    const staffA = await account('onboarding-a@test.local', 'Onboarding A', 'STAFF');
    const staffB = await account('onboarding-b@test.local', 'Onboarding B', 'STAFF');
    const userIds = [admin.id, staffA.id, staffB.id];
    createdByIds.push(...userIds);

    await prisma.providerOrganization.deleteMany({
      where: { createdByUserId: { in: userIds } },
    });
    await prisma.idempotencyKey.deleteMany({
      where: {
        OR: userIds.map((id) => ({ scope: { startsWith: `${id}:` } })),
      },
    });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });

    const adminToken = generateSessionToken();
    const staffAToken = generateSessionToken();
    const staffBToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.session.createMany({
      data: [
        { id: randomUUID(), userId: admin.id, tokenHash: hashSessionToken(adminToken), expiresAt },
        {
          id: randomUUID(),
          userId: staffA.id,
          tokenHash: hashSessionToken(staffAToken),
          expiresAt,
        },
        {
          id: randomUUID(),
          userId: staffB.id,
          tokenHash: hashSessionToken(staffBToken),
          expiresAt,
        },
      ],
    });

    seed = {
      adminId: admin.id,
      staffAId: staffA.id,
      staffBId: staffB.id,
      adminToken,
      staffAToken,
      staffBToken,
      cookieName: process.env.SESSION_COOKIE_NAME ?? 'curenear_session',
    };
  });

  afterAll(async () => {
    await prisma.providerOrganization.deleteMany({
      where: { createdByUserId: { in: createdByIds } },
    });
    await prisma.idempotencyKey.deleteMany({
      where: { OR: createdByIds.map((id) => ({ scope: { startsWith: `${id}:` } })) },
    });
    await prisma.$disconnect();
  });

  function request(
    path: string,
    token: string,
    init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
      method: init.method ?? 'GET',
      headers: {
        cookie: `${seed.cookieName}=${token}`,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: body(init.body) }),
    });
  }

  const params = <T extends Record<string, string>>(values: T) => ({
    params: Promise.resolve(values),
  });

  it('creates a draft and replays the response for the same Idempotency-Key', async () => {
    const { POST } = await import('@/app/api/v1/providers/route');
    const payload = {
      provider_type: 'clinic',
      legal_name: 'Onboarding Idem Clinic',
      registration_number: 'ONB-REG-001',
      mobile: '9830012345',
    };

    const first = await POST(
      request('/api/v1/providers', seed.staffAToken, {
        method: 'POST',
        body: payload,
        headers: { 'idempotency-key': 'onboarding-create-0001' },
      }),
    );
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as {
      data: { provider: { id: string; code: string; status: string } };
    };
    clinicId = firstBody.data.provider.id;
    expect(firstBody.data.provider.status).toBe('DRAFT');
    expect(firstBody.data.provider.code).toMatch(/^CN-/);

    const replay = await POST(
      request('/api/v1/providers', seed.staffAToken, {
        method: 'POST',
        body: payload,
        headers: { 'idempotency-key': 'onboarding-create-0001' },
      }),
    );
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as {
      data: { provider: { id: string } };
      meta: { idempotentReplay: boolean };
    };
    expect(replayBody.data.provider.id).toBe(clinicId);
    expect(replayBody.meta.idempotentReplay).toBe(true);

    const mismatch = await POST(
      request('/api/v1/providers', seed.staffAToken, {
        method: 'POST',
        body: { ...payload, legal_name: 'Different name' },
        headers: { 'idempotency-key': 'onboarding-create-0001' },
      }),
    );
    expect(mismatch.status).toBe(409);
    expect((await mismatch.json()).error.code).toBe('IDEMPOTENCY_MISMATCH');
  });

  it('warns about a duplicate registration number instead of blocking', async () => {
    const { POST } = await import('@/app/api/v1/providers/route');
    const response = await POST(
      request('/api/v1/providers', seed.staffBToken, {
        method: 'POST',
        body: {
          provider_type: 'clinic',
          legal_name: 'Another Clinic',
          registration_number: 'onb-reg-001',
        },
      }),
    );
    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      data: { provider: { id: string }; duplicateWarnings: Array<{ kind: string }> };
    };
    otherClinicId = payload.data.provider.id;
    expect(payload.data.duplicateWarnings.map((row) => row.kind)).toContain('registration_number');
  });

  it('returns 404 when staff read a provider they do not own', async () => {
    const { GET } = await import('@/app/api/v1/providers/[id]/route');

    const own = await GET(
      request(`/api/v1/providers/${clinicId}`, seed.staffAToken),
      params({ id: clinicId }),
    );
    expect(own.status).toBe(200);

    const foreign = await GET(
      request(`/api/v1/providers/${clinicId}`, seed.staffBToken),
      params({ id: clinicId }),
    );
    expect(foreign.status).toBe(404);
    expect((await foreign.json()).error.code).toBe('NOT_FOUND');

    const admin = await GET(
      request(`/api/v1/providers/${clinicId}`, seed.adminToken),
      params({ id: clinicId }),
    );
    expect(admin.status).toBe(200);
  });

  it('saves one section and rejects a stale version', async () => {
    const { PATCH } = await import('@/app/api/v1/providers/[id]/sections/[sectionKey]/route');

    const saved = await PATCH(
      request(`/api/v1/providers/${clinicId}/sections/clinic_establishment`, seed.staffAToken, {
        method: 'PATCH',
        body: { version: 1, data: { clinic_owner: 'Dr Onboarding' } },
      }),
      params({ id: clinicId, sectionKey: 'clinic_establishment' }),
    );
    expect(saved.status).toBe(200);
    const savedBody = (await saved.json()) as {
      data: { provider: { version: number }; completeness: { sections: unknown[] } };
    };
    expect(savedBody.data.provider.version).toBe(2);
    expect(savedBody.data.completeness.sections.length).toBeGreaterThan(0);

    const stale = await PATCH(
      request(`/api/v1/providers/${clinicId}/sections/clinic_establishment`, seed.staffAToken, {
        method: 'PATCH',
        body: { version: 1, data: { clinic_owner: 'Dr Stale' } },
      }),
      params({ id: clinicId, sectionKey: 'clinic_establishment' }),
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe('VERSION_CONFLICT');
  });

  it('returns field-level issues for an invalid section value', async () => {
    const { PATCH } = await import('@/app/api/v1/providers/[id]/sections/[sectionKey]/route');
    const { GET } = await import('@/app/api/v1/providers/[id]/route');
    const current = (await (
      await GET(
        request(`/api/v1/providers/${clinicId}`, seed.staffAToken),
        params({ id: clinicId }),
      )
    ).json()) as { data: { organization: { version: number } } };

    const response = await PATCH(
      request(`/api/v1/providers/${clinicId}/sections/registered_office`, seed.staffAToken, {
        method: 'PATCH',
        body: { version: current.data.organization.version, data: { locations: [] } },
      }),
      params({ id: clinicId, sectionKey: 'registered_office' }),
    );
    expect(response.status).toBe(422);
    const payload = (await response.json()) as {
      error: { code: string; details: { issues: Array<{ path: string }> } };
    };
    expect(payload.error.code).toBe('VALIDATION_ERROR');
    expect(payload.error.details.issues[0]?.path).toBe('locations');
  });

  it('blocks an exact duplicate licence number and keeps a warning on mobile + PIN', async () => {
    const { POST: createLicence } = await import('@/app/api/v1/providers/[id]/licences/route');
    const first = await createLicence(
      request(`/api/v1/providers/${clinicId}/licences`, seed.staffAToken, {
        method: 'POST',
        body: { number: 'WB-CE-778899', role: 'clinical_establishment' },
      }),
      params({ id: clinicId }),
    );
    expect(first.status).toBe(201);

    const duplicate = await createLicence(
      request(`/api/v1/providers/${otherClinicId}/licences`, seed.staffBToken, {
        method: 'POST',
        body: { number: 'wb-ce-778899' },
      }),
      params({ id: otherClinicId }),
    );
    expect(duplicate.status).toBe(409);
    const payload = (await duplicate.json()) as {
      error: { code: string; details: { duplicates: Array<{ kind: string; hardBlock: boolean }> } };
    };
    expect(payload.error.code).toBe('CONFLICT');
    expect(payload.error.details.duplicates[0]).toMatchObject({
      kind: 'licence_number',
      hardBlock: true,
    });
  });

  it('copies the primary location PIN onto the organization', async () => {
    const { POST } = await import('@/app/api/v1/providers/[id]/locations/route');
    const response = await POST(
      request(`/api/v1/providers/${clinicId}/locations`, seed.staffAToken, {
        method: 'POST',
        body: {
          name: 'Salt Lake clinic',
          location_type: 'clinic',
          address_line1: '1 Sector V',
          city: 'Kolkata',
          pin_code: '700091',
          is_primary: true,
        },
      }),
      params({ id: clinicId }),
    );
    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      data: { location: { isPrimary: boolean }; provider: { primaryPinCode: string } };
    };
    expect(payload.data.location.isPrimary).toBe(true);
    expect(payload.data.provider.primaryPinCode).toBe('700091');
  });

  it('warns about the same mobile number at the same PIN when a location is saved', async () => {
    const { POST: createProvider } = await import('@/app/api/v1/providers/route');
    const createdResponse = await createProvider(
      request('/api/v1/providers', seed.staffBToken, {
        method: 'POST',
        body: {
          provider_type: 'pharmacy',
          legal_name: 'Mobile Duplicate Pharmacy',
          mobile: '9830012345',
        },
      }),
    );
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { data: { provider: { id: string } } };
    const pharmacyId = created.data.provider.id;

    const { POST: createLocation } = await import('@/app/api/v1/providers/[id]/locations/route');
    const response = await createLocation(
      request(`/api/v1/providers/${pharmacyId}/locations`, seed.staffBToken, {
        method: 'POST',
        body: {
          name: 'Mobile duplicate branch',
          location_type: 'pharmacy',
          address_line1: '2 Sector V',
          city: 'Kolkata',
          pin_code: '700091',
          is_primary: true,
        },
      }),
      params({ id: pharmacyId }),
    );
    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      data: { warnings: Array<{ kind: string; providerId: string }> };
    };
    expect(payload.data.warnings.map((row) => row.kind)).toContain('mobile_pin');
    // Another staff member's provider is warned about, but never identified.
    expect(payload.data.warnings[0]?.providerId).toBe('');
  });

  it('blocks submission while sections are incomplete', async () => {
    const { POST } = await import('@/app/api/v1/providers/[id]/submit/route');
    const response = await POST(
      request(`/api/v1/providers/${clinicId}/submit`, seed.staffAToken, {
        method: 'POST',
        body: {},
      }),
      params({ id: clinicId }),
    );
    expect(response.status).toBe(422);
    const payload = (await response.json()) as {
      error: {
        code: string;
        details: { completeness: { complete: boolean; missingRequiredFields: string[] } };
      };
    };
    expect(payload.error.code).toBe('VALIDATION_ERROR');
    expect(payload.error.details.completeness.complete).toBe(false);
    expect(payload.error.details.completeness.missingRequiredFields.length).toBeGreaterThan(0);
  });

  it('moves through review with history, audit and outbox rows', async () => {
    const { POST } = await import('@/app/api/v1/providers/[id]/transitions/route');

    // Simulate a completed submission: the review transitions start at SUBMITTED.
    await prisma.providerOrganization.update({
      where: { id: clinicId },
      data: { status: 'SUBMITTED', submittedAt: new Date(), version: { increment: 1 } },
    });

    const review = await POST(
      request(`/api/v1/providers/${clinicId}/transitions`, seed.adminToken, {
        method: 'POST',
        body: { to: 'UNDER_REVIEW' },
      }),
      params({ id: clinicId }),
    );
    expect(review.status).toBe(200);
    expect((await review.json()).data.status as string).toBe('UNDER_REVIEW');

    const withoutReason = await POST(
      request(`/api/v1/providers/${clinicId}/transitions`, seed.adminToken, {
        method: 'POST',
        body: { to: 'REJECTED' },
      }),
      params({ id: clinicId }),
    );
    expect(withoutReason.status).toBe(422);

    const approved = await POST(
      request(`/api/v1/providers/${clinicId}/transitions`, seed.adminToken, {
        method: 'POST',
        body: { to: 'APPROVED' },
      }),
      params({ id: clinicId }),
    );
    expect(approved.status).toBe(200);
    const approvedPayload = (await approved.json()) as {
      data: { status: string; approvedByUserId: string; version: number };
    };
    expect(approvedPayload.data.status).toBe('APPROVED');
    expect(approvedPayload.data.approvedByUserId).toBe(seed.adminId);

    const invalid = await POST(
      request(`/api/v1/providers/${clinicId}/transitions`, seed.adminToken, {
        method: 'POST',
        body: { to: 'SUBMITTED' },
      }),
      params({ id: clinicId }),
    );
    expect(invalid.status).toBe(409);
    expect((await invalid.json()).error.code).toBe('INVALID_TRANSITION');

    const history = await prisma.providerStatusHistory.findMany({
      where: { organizationId: clinicId },
      orderBy: { at: 'asc' },
    });
    expect(history.map((row) => row.toStatus)).toEqual(
      expect.arrayContaining(['UNDER_REVIEW', 'APPROVED']),
    );

    const audit = await prisma.auditLog.findFirst({
      where: {
        entityType: 'provider_organization',
        entityId: clinicId,
        action: 'provider.approved',
      },
    });
    expect(audit).not.toBeNull();

    const event = await prisma.outboxEvent.findFirst({
      where: { aggregateId: clinicId, eventType: 'provider.approved' },
    });
    expect(event).not.toBeNull();
    expect(event?.payload).toMatchObject({ status: 'APPROVED' });

    // Approved providers are no longer visible to the owning staff member.
    const { GET } = await import('@/app/api/v1/providers/[id]/route');
    const staffRead = await GET(
      request(`/api/v1/providers/${clinicId}`, seed.staffAToken),
      params({ id: clinicId }),
    );
    expect(staffRead.status).toBe(404);
  });

  it('reports per-section completeness', async () => {
    const { GET } = await import('@/app/api/v1/providers/[id]/completeness/route');
    const response = await GET(
      request(`/api/v1/providers/${otherClinicId}/completeness`, seed.adminToken),
      params({ id: otherClinicId }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: {
        complete: boolean;
        sections: Array<{ key: string; status: string }>;
        missingDocuments: string[];
      };
    };
    expect(payload.data.complete).toBe(false);
    const legal = payload.data.sections.find((section) => section.key === 'legal_entity');
    expect(legal?.status).toBe('in_progress');
  });
});
