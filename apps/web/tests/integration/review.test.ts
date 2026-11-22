import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createPrismaClient,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
} from '@curenear/db';
import { requiredVerificationItemsFor } from '@curenear/shared';

/**
 * Admin review workflow against real PostgreSQL: the approval gate, the
 * change-request round trip with selective re-verification, and suspension
 * scope. Decisions go through the same state machine as the rest of the app,
 * so history/audit/outbox rows are asserted here too.
 */
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

interface Seed {
  adminToken: string;
  staffToken: string;
  adminId: string;
  staffId: string;
  cookieName: string;
}

describeDb('admin review workflow (real PostgreSQL)', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let seed: Seed;
  const createdOrgIds: string[] = [];
  const createdUserIds: string[] = [];

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

    const admin = await account('review-admin@test.local', 'Review Admin', 'ADMIN');
    const staff = await account('review-staff@test.local', 'Review Staff', 'STAFF');
    createdUserIds.push(admin.id, staff.id);
    await prisma.providerOrganization.deleteMany({
      where: { createdByUserId: { in: createdUserIds } },
    });

    const adminToken = generateSessionToken();
    const staffToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.session.createMany({
      data: [
        { id: randomUUID(), userId: admin.id, tokenHash: hashSessionToken(adminToken), expiresAt },
        { id: randomUUID(), userId: staff.id, tokenHash: hashSessionToken(staffToken), expiresAt },
      ],
    });

    seed = {
      adminId: admin.id,
      staffId: staff.id,
      adminToken,
      staffToken,
      cookieName: process.env.SESSION_COOKIE_NAME ?? 'curenear_session',
    };
  });

  afterAll(async () => {
    await prisma.providerOrganization.deleteMany({
      where: { createdByUserId: { in: createdUserIds } },
    });
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
        cookie: `${seed.cookieName}=${token}`,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  }

  const params = <T extends Record<string, string>>(values: T) => ({
    params: Promise.resolve(values),
  });

  async function createSubmittedClinic(
    label: string,
    providerType: 'clinic' | 'pharmacy' = 'clinic',
  ) {
    const organization = await prisma.providerOrganization.create({
      data: {
        id: randomUUID(),
        code: `CN-RV-${randomUUID().slice(0, 8).toUpperCase()}`,
        providerType,
        status: 'SUBMITTED',
        legalName: label,
        createdByUserId: seed.staffId,
        submittedAt: new Date(),
      },
    });
    createdOrgIds.push(organization.id);
    await prisma.reviewVerification.createMany({
      data: requiredVerificationItemsFor(providerType).map((item) => ({
        organizationId: organization.id,
        item: item.code,
        sectionKey: item.sectionKey,
        required: item.required,
      })),
    });
    return organization;
  }

  async function decide(organizationId: string, body: Record<string, unknown>): Promise<Response> {
    const { POST } = await import('@/app/api/v1/admin/review/[id]/decisions/route');
    return POST(
      request(`/api/v1/admin/review/${organizationId}/decisions`, seed.adminToken, {
        method: 'POST',
        body,
      }),
      params({ id: organizationId }),
    );
  }

  it('blocks approval while a required checklist item is pending', async () => {
    const organization = await createSubmittedClinic('Review Gate Clinic');
    const blocked = await decide(organization.id, { decision: 'approve' });
    expect(blocked.status).toBe(422);
    const payload = (await blocked.json()) as {
      error: { code: string; details: { blocking: Array<{ item: string }> } };
    };
    expect(payload.error.code).toBe('VALIDATION_ERROR');
    expect(payload.error.details.blocking.length).toBeGreaterThan(0);

    // The failed attempt must not have moved the provider out of SUBMITTED.
    const unchanged = await prisma.providerOrganization.findUniqueOrThrow({
      where: { id: organization.id },
    });
    expect(unchanged.status).toBe('SUBMITTED');

    await prisma.reviewVerification.updateMany({
      where: { organizationId: organization.id, required: true },
      data: { status: 'VERIFIED', verifiedAt: new Date(), verifiedByUserId: seed.adminId },
    });

    const approved = await decide(organization.id, { decision: 'approve' });
    expect(approved.status).toBe(200);
    expect(((await approved.json()) as { data: { status: string } }).data.status).toBe('APPROVED');

    const history = await prisma.providerStatusHistory.findMany({
      where: { organizationId: organization.id },
      orderBy: { at: 'asc' },
    });
    expect(history.map((row) => row.toStatus)).toEqual(
      expect.arrayContaining(['UNDER_REVIEW', 'APPROVED']),
    );
    const audit = await prisma.auditLog.findFirst({
      where: {
        entityType: 'provider_organization',
        entityId: organization.id,
        action: 'provider.approved',
      },
    });
    expect(audit).not.toBeNull();
    const event = await prisma.outboxEvent.findFirst({
      where: { aggregateId: organization.id, eventType: 'provider.approved' },
    });
    expect(event).not.toBeNull();
  });

  it('generates the checklist for providers submitted before the review tables existed', async () => {
    const organization = await prisma.providerOrganization.create({
      data: {
        id: randomUUID(),
        code: `CN-RV-${randomUUID().slice(0, 8).toUpperCase()}`,
        providerType: 'pharmacy',
        status: 'SUBMITTED',
        legalName: 'Legacy Submitted Pharmacy',
        createdByUserId: seed.staffId,
        submittedAt: new Date(),
      },
    });
    createdOrgIds.push(organization.id);

    const { GET } = await import('@/app/api/v1/admin/review/[id]/route');
    const response = await GET(
      request(`/api/v1/admin/review/${organization.id}`, seed.adminToken),
      params({ id: organization.id }),
    );
    expect(response.status).toBe(200);
    const detail = (await response.json()) as {
      data: {
        verifications: Array<{ status: string; required: boolean }>;
        checklist: { total: number; blocking: number };
        canApprove: boolean;
      };
    };
    expect(detail.data.verifications.length).toBeGreaterThan(0);
    expect(detail.data.verifications.every((item) => item.status === 'PENDING')).toBe(true);
    expect(detail.data.checklist.blocking).toBeGreaterThan(0);
    expect(detail.data.canApprove).toBe(false);

    const blocked = await decide(organization.id, { decision: 'approve' });
    expect(blocked.status).toBe(422);
  });

  it('round-trips a change request and only resets the affected checks', async () => {
    const organization = await createSubmittedClinic('Review Changes Pharmacy', 'pharmacy');
    // Every required check is settled before the change request, so the
    // registration edit is the only thing that can reset one.
    await prisma.reviewVerification.updateMany({
      where: { organizationId: organization.id, required: true },
      data: { status: 'VERIFIED', verifiedAt: new Date(), verifiedByUserId: seed.adminId },
    });

    const changes = await decide(organization.id, {
      decision: 'request_changes',
      comment: 'Please attach the current establishment licence.',
      sections: ['licences'],
    });
    expect(changes.status).toBe(200);

    const returned = await prisma.providerOrganization.findUniqueOrThrow({
      where: { id: organization.id },
    });
    expect(returned.status).toBe('CHANGES_REQUESTED');
    const comments = await prisma.reviewComment.findMany({
      where: { organizationId: organization.id },
    });
    expect(comments).toHaveLength(1);
    expect(comments[0]?.sectionKey).toBe('licences');
    const history = await prisma.providerStatusHistory.findFirstOrThrow({
      where: { organizationId: organization.id, toStatus: 'CHANGES_REQUESTED' },
    });
    expect(history.flaggedSections).toEqual(['licences']);

    // Staff fixes the legal entity (registration) after the change request.
    const { PATCH } = await import('@/app/api/v1/providers/[id]/sections/[sectionKey]/route');
    const patched = await PATCH(
      request(`/api/v1/providers/${organization.id}/sections/legal_entity`, seed.staffToken, {
        method: 'PATCH',
        body: { version: returned.version, data: { trade_name: 'Changes Pharmacy' } },
      }),
      params({ id: organization.id, sectionKey: 'legal_entity' }),
    );
    expect(patched.status).toBe(200);

    const afterFix = await prisma.reviewVerification.findMany({
      where: { organizationId: organization.id },
    });
    const registration = afterFix.find((row) => row.item === 'registration');
    const consent = afterFix.find((row) => row.item === 'consent');
    expect(registration?.status).toBe('PENDING');
    expect(consent?.status).toBe('VERIFIED');

    // Staff resubmits; the review screen now blocks on the reset item only.
    await prisma.providerOrganization.update({
      where: { id: organization.id },
      data: { status: 'SUBMITTED', submittedAt: new Date(), version: { increment: 1 } },
    });
    const blocked = await decide(organization.id, { decision: 'approve' });
    expect(blocked.status).toBe(422);

    const { PATCH: patchVerification } =
      await import('@/app/api/v1/admin/review/[id]/verifications/[item]/route');
    const verified = await patchVerification(
      request(
        `/api/v1/admin/review/${organization.id}/verifications/registration`,
        seed.adminToken,
        {
          method: 'PATCH',
          body: { status: 'VERIFIED', source: 'WB clinical establishment register' },
        },
      ),
      params({ id: organization.id, item: 'registration' }),
    );
    expect(verified.status).toBe(200);

    const approved = await decide(organization.id, { decision: 'approve' });
    expect(approved.status).toBe(200);
  });

  it('records and validates the suspension scope', async () => {
    const organization = await createSubmittedClinic('Review Suspension Clinic');
    const location = await prisma.providerLocation.create({
      data: {
        id: randomUUID(),
        organizationId: organization.id,
        name: 'Salt Lake branch',
        locationType: 'clinic',
        addressLine1: '1 Sector V',
        city: 'Kolkata',
        pinCode: '700091',
        isPrimary: true,
      },
    });
    await prisma.providerServicePin.create({
      data: { organizationId: organization.id, pinCode: '700091', serviceKind: 'diagnostics' },
    });

    await prisma.reviewVerification.updateMany({
      where: { organizationId: organization.id },
      data: { status: 'VERIFIED', verifiedAt: new Date(), verifiedByUserId: seed.adminId },
    });
    expect((await decide(organization.id, { decision: 'approve' })).status).toBe(200);

    const other = await createSubmittedClinic('Review Other Clinic');
    const foreignLocation = await prisma.providerLocation.create({
      data: {
        id: randomUUID(),
        organizationId: other.id,
        name: 'Other branch',
        locationType: 'clinic',
        addressLine1: '9 Elsewhere',
        city: 'Kolkata',
        pinCode: '700019',
      },
    });

    const wrongLocation = await decide(organization.id, {
      decision: 'suspend',
      reason: 'Premises inspection failed.',
      scope: 'LOCATION',
      scope_ref_id: foreignLocation.id,
    });
    expect(wrongLocation.status).toBe(404);

    const suspended = await decide(organization.id, {
      decision: 'suspend',
      reason: 'Premises inspection failed.',
      scope: 'LOCATION',
      scope_ref_id: location.id,
    });
    expect(suspended.status).toBe(200);
    const suspension = await prisma.providerStatusHistory.findFirstOrThrow({
      where: { organizationId: organization.id, toStatus: 'SUSPENDED' },
    });
    expect(suspension.scope).toBe('LOCATION');
    expect(suspension.scopeRefId).toBe(location.id);
    expect(suspension.scopeLabel).toBe('Salt Lake branch');

    const reinstated = await decide(organization.id, {
      decision: 'reinstate',
      reason: 'Re-inspection passed.',
    });
    expect(reinstated.status).toBe(200);
    expect(
      (await prisma.providerOrganization.findUniqueOrThrow({ where: { id: organization.id } }))
        .status,
    ).toBe('APPROVED');
  });
});
