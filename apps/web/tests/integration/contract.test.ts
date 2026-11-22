import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import Ajv2020 from 'ajv/dist/2020';
import type { ValidateFunction } from 'ajv';
import {
  createPrismaClient,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
} from '@curenear/db';

import { GET as getHealth } from '@/app/api/v1/health/route';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { GET as getMe } from '@/app/api/auth/me/route';
import { GET as listAdminProviders } from '@/app/api/v1/admin/providers/route';
import { GET as listNotifications } from '@/app/api/v1/notifications/route';
import { GET as listExports } from '@/app/api/v1/exports/route';

/**
 * Contract tests are driven by `docs/openapi.json`: every operation in the
 * document must be exercised here, and its real response body is validated
 * against the declared JSON Schema (OpenAPI 3.1 / draft 2020-12).
 */
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

type Operation = { path: string; method: 'get' | 'post'; operationId: string };
type OpenApiDocument = {
  paths: Record<string, Record<string, { operationId?: string }>>;
  components: { schemas: Record<string, unknown> };
};

const document = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../docs/openapi.json', import.meta.url)), 'utf8'),
) as OpenApiDocument;

const operations: Operation[] = Object.entries(document.paths).flatMap(([path, item]) =>
  Object.entries(item).map(([method, operation]) => ({
    path,
    method: method as 'get' | 'post',
    operationId: operation.operationId ?? '',
  })),
);

const ajvOptions = { strict: false, allErrors: true, logger: false } as const;
const ajv = new Ajv2020(ajvOptions);

/** Inline every internal component ref so each response is validated in isolation. */
function inlineSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(inlineSchema);
  if (!node || typeof node !== 'object') return node;
  const record = node as Record<string, unknown>;
  if (typeof record.$ref === 'string') {
    const name = record.$ref.replace('#/components/schemas/', '');
    const target = document.components.schemas[name];
    if (!target) throw new Error(`Unknown contract schema ${record.$ref}`);
    return inlineSchema(target);
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, inlineSchema(value)]),
  );
}

function compileRef(schema: object): ValidateFunction {
  // A fresh compiler per response keeps Ajv's schema cache from reusing a
  // validator compiled for an earlier inlined component.
  return new Ajv2020(ajvOptions).compile(inlineSchema(schema) as object);
}

function validatorFor(operationId: string, status: string): ValidateFunction {
  const operation = operations.find((entry) => entry.operationId === operationId);
  expect(operation, `operation ${operationId} is documented`).toBeDefined();
  const pathItem = document.paths[operation!.path]!;
  const response = (
    pathItem[operation!.method] as unknown as {
      responses: Record<string, { content: Record<string, { schema: object }> }>;
    }
  ).responses[status];
  expect(response, `${operationId} documents a ${status} response`).toBeDefined();
  return compileRef(response!.content['application/json']!.schema);
}

function expectContract(operationId: string, status: number, body: unknown): void {
  const validate = validatorFor(operationId, String(status));
  const valid = validate(body);
  expect(valid, `${ajv.errorsText(validate.errors)} :: ${JSON.stringify(body)}`).toBe(true);
}

describeDb('OpenAPI contract (real handlers)', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let adminCookie: string;
  let staffCookie: string;

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
          deletedAt: null,
        },
        create: { id: randomUUID(), email, name, passwordHash, role },
      });
    }

    const admin = await account('contract-admin@test.local', 'Contract Admin', 'ADMIN');
    const staff = await account('contract-staff@test.local', 'Contract Staff', 'STAFF');

    const adminToken = generateSessionToken();
    const staffToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.session.createMany({
      data: [
        { id: randomUUID(), userId: admin.id, tokenHash: hashSessionToken(adminToken), expiresAt },
        { id: randomUUID(), userId: staff.id, tokenHash: hashSessionToken(staffToken), expiresAt },
      ],
    });

    const cookieName = process.env.SESSION_COOKIE_NAME ?? 'curenear_session';
    adminCookie = `${cookieName}=${adminToken}`;
    staffCookie = `${cookieName}=${staffToken}`;
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => undefined);
  });

  const get = (path: string, cookie?: string) =>
    new NextRequest(`http://localhost:3000${path}`, {
      headers: cookie ? { cookie } : {},
    });

  it('documents every operation it exercises and vice versa', () => {
    const documented = operations.map((operation) => operation.operationId).sort();
    expect(documented).toEqual(
      [
        'getHealth',
        'login',
        'getCurrentUser',
        'listAdminProviders',
        'listNotifications',
        'listExports',
      ].sort(),
    );
    for (const operation of operations) {
      expect(operation.operationId, `${operation.method} ${operation.path}`).toBeTruthy();
    }
  });

  it('GET /api/v1/health matches the contract', async () => {
    const response = await getHealth(get('/api/v1/health'));
    expect(response.status).toBe(200);
    expectContract('getHealth', 200, await response.json());
  });

  it('POST /api/v1/auth/login returns the documented error envelope', async () => {
    const response = await login(
      new NextRequest('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3000',
          host: 'localhost:3000',
        },
        body: JSON.stringify({ email: 'nobody@test.local', password: 'wrong-password' }),
      }),
    );
    expect(response.status).toBe(401);
    expectContract('login', 401, await response.json());
  });

  it('GET /api/auth/me matches the contract', async () => {
    const response = await getMe(get('/api/auth/me', adminCookie));
    expect(response.status).toBe(200);
    expectContract('getCurrentUser', 200, await response.json());
  });

  it('GET /api/v1/admin/providers matches the contract', async () => {
    const response = await listAdminProviders(
      get('/api/v1/admin/providers?page=1&pageSize=5&pin=700091', adminCookie),
    );
    expect(response.status).toBe(200);
    expectContract('listAdminProviders', 200, await response.json());
  });

  it('GET /api/v1/notifications matches the contract', async () => {
    const response = await listNotifications(
      get('/api/v1/notifications?page=1&pageSize=5', staffCookie),
    );
    expect(response.status).toBe(200);
    expectContract('listNotifications', 200, await response.json());
  });

  it('GET /api/v1/exports matches the contract', async () => {
    const response = await listExports(get('/api/v1/exports', staffCookie));
    expect(response.status).toBe(200);
    expectContract('listExports', 200, await response.json());
  });

  it('keeps unauthenticated requests inside the documented error shape', async () => {
    const response = await getMe(get('/api/auth/me'));
    expect(response.status).toBe(401);
    expectContract('getCurrentUser', 401, await response.json());
  });
});
