import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createPrismaClient,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
} from '@curenear/db';
import { GET, POST } from '@/app/api/v1/admin/system/webhooks/route';
import { DELETE } from '@/app/api/v1/admin/system/webhooks/[id]/route';

/**
 * Minimal subscriber registry: an administrator can register an https endpoint,
 * see it in the list, and remove it. Event types are validated against the
 * catalogue and only administrators may manage endpoints.
 */
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

const URL_PREFIX = 'https://hooks.system-test.local/';

describeDb('admin webhook endpoints (real PostgreSQL)', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let adminToken: string;
  let staffToken: string;
  let cookieName: string;

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

    const admin = await account('system-admin@test.local', 'System Admin', 'ADMIN');
    const staff = await account('system-staff@test.local', 'System Staff', 'STAFF');

    adminToken = generateSessionToken();
    staffToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.session.createMany({
      data: [
        { id: randomUUID(), userId: admin.id, tokenHash: hashSessionToken(adminToken), expiresAt },
        { id: randomUUID(), userId: staff.id, tokenHash: hashSessionToken(staffToken), expiresAt },
      ],
    });

    cookieName = process.env.SESSION_COOKIE_NAME ?? 'curenear_session';
  });

  afterAll(async () => {
    await prisma.webhookEndpoint.deleteMany({ where: { url: { startsWith: URL_PREFIX } } });
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

  const params = <T extends Record<string, string>>(values: T) => ({
    params: Promise.resolve(values),
  });

  it('registers, lists and removes an endpoint', async () => {
    const url = `${URL_PREFIX}${randomUUID()}`;

    const created = await POST(
      request('/api/v1/admin/system/webhooks', adminToken, {
        method: 'POST',
        body: { url, event_types: ['provider.approved'] },
      }),
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      data: { id: string; url: string; eventTypes: string[]; active: boolean };
    };
    expect(createdBody.data.url).toBe(url);
    expect(createdBody.data.eventTypes).toEqual(['provider.approved']);
    expect(createdBody.data.active).toBe(true);

    const list = await GET(request('/api/v1/admin/system/webhooks', adminToken));
    const listBody = (await list.json()) as { data: Array<{ id: string; url: string }> };
    expect(listBody.data.some((row) => row.id === createdBody.data.id)).toBe(true);

    // The same URL cannot be registered twice.
    const duplicate = await POST(
      request('/api/v1/admin/system/webhooks', adminToken, {
        method: 'POST',
        body: { url },
      }),
    );
    expect(duplicate.status).toBe(409);

    const removed = await DELETE(
      request(`/api/v1/admin/system/webhooks/${createdBody.data.id}`, adminToken, {
        method: 'DELETE',
      }),
      params({ id: createdBody.data.id }),
    );
    expect(removed.status).toBe(200);

    const after = (await (
      await GET(request('/api/v1/admin/system/webhooks', adminToken))
    ).json()) as {
      data: Array<{ id: string }>;
    };
    expect(after.data.some((row) => row.id === createdBody.data.id)).toBe(false);
  });

  it('rejects unknown event types', async () => {
    const response = await POST(
      request('/api/v1/admin/system/webhooks', adminToken, {
        method: 'POST',
        body: { url: `${URL_PREFIX}${randomUUID()}`, event_types: ['provider.nope'] },
      }),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { details?: { unknown?: string[] } } };
    expect(body.error.details?.unknown).toEqual(['provider.nope']);
  });

  it('refuses staff callers', async () => {
    const response = await POST(
      request('/api/v1/admin/system/webhooks', staffToken, {
        method: 'POST',
        body: { url: `${URL_PREFIX}${randomUUID()}` },
      }),
    );
    expect(response.status).toBe(403);
  });
});
