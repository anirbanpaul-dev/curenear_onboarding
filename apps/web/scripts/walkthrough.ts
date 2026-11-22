/**
 * End-to-end API walkthrough against a running dev server.
 *
 *   pnpm --filter @curenear/web exec tsx scripts/walkthrough.ts
 *
 * It exercises the same HTTP surface the UI uses: login, create a doctor draft,
 * save the full onboarding form, submit for verification, admin review, plus the
 * staff-isolation rules and the server-rendered pages. Exits non-zero on failure.
 */
import { createPrismaClient, hashPassword } from '@curenear/db';
import { validDoctorData } from '../src/test/fixtures';

try {
  // Touching the database below needs DATABASE_URL; `tsx` does not read .env files.
  process.loadEnvFile('.env.local');
} catch {
  // CI passes the environment directly.
}

const baseUrl = process.env.WALKTHROUGH_BASE_URL ?? 'http://127.0.0.1:3457';
// A dedicated admin, so the run neither depends on nor clears the seeded admin's
// forced password change.
const adminEmail = process.env.WALKTHROUGH_ADMIN_EMAIL ?? 'walkthrough-admin@curenear.in';
const adminPassword = process.env.WALKTHROUGH_ADMIN_PASSWORD ?? 'walkthrough-admin-password-123';

interface Envelope<T> {
  data: T;
  meta?: Record<string, unknown>;
  requestId: string;
}

type Provider = {
  id: string;
  status: string;
  version: number;
  displayName: string | null;
  primaryPinCode: string | null;
  decisionReason: string | null;
  data: Record<string, unknown>;
};

const results: string[] = [];
let failures = 0;

function record(step: string, detail = ''): void {
  results.push(`ok   ${step}${detail ? ` — ${detail}` : ''}`);
}

function fail(step: string, detail: string): void {
  results.push(`FAIL ${step} — ${detail}`);
  failures += 1;
}

function cookieFrom(response: Response): string {
  const raw = response.headers.getSetCookie?.() ?? [];
  const session = raw.find((entry) => entry.startsWith('curenear_session='));
  if (!session) throw new Error('login did not set a session cookie');
  return session.split(';')[0] as string;
}

async function call<T>(
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: T; requestId: string }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.headers ?? {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    redirect: 'manual',
  });

  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as Envelope<T> | { error: { message: string } }) : null;
  return {
    status: response.status,
    body: (parsed as Envelope<T>)?.data ?? (parsed as T),
    requestId: (parsed as Envelope<T>)?.requestId ?? '',
  };
}

async function login(email: string, password: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(`login failed for ${email}: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { data?: { mustChangePassword?: boolean } };
  if (!body.data?.mustChangePassword) return cookieFrom(response);

  // Temporary passwords must be replaced before anything else answers.
  const changed = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: cookieFrom(response),
    },
    body: JSON.stringify({ currentPassword: password, newPassword: `${password}-changed` }),
  });
  if (!changed.ok) {
    throw new Error(`forced password change failed: ${changed.status} ${await changed.text()}`);
  }
  return cookieFrom(changed);
}

/** Makes the walkthrough admin deterministic (active, no pending rotation). */
async function ensureWalkthroughAdmin(): Promise<void> {
  const prisma = createPrismaClient();
  try {
    const passwordHash = await hashPassword(adminPassword);
    await prisma.user.upsert({
      where: { email: adminEmail },
      update: {
        passwordHash,
        role: 'ADMIN',
        status: 'ACTIVE',
        mustChangePassword: false,
        deletedAt: null,
      },
      create: { email: adminEmail, name: 'Walkthrough Admin', passwordHash, role: 'ADMIN' },
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  await ensureWalkthroughAdmin();
  const health = await fetch(`${baseUrl}/api/v1/health`);
  record(
    'health',
    `${health.status} ${health.headers.get('x-request-id') ? 'with requestId' : ''}`,
  );

  const adminCookie = await login(adminEmail, adminPassword);
  record('admin login', adminEmail);

  const me = await call<{ user: { email: string; role: string } }>('GET', '/api/v1/auth/me', {
    cookie: adminCookie,
  });
  if (me.status !== 200 || me.body.user.role !== 'ADMIN') {
    fail('auth/me', `status ${me.status} role ${me.body?.user?.role}`);
  } else {
    record('auth/me', `${me.body.user.email} (${me.body.user.role})`);
  }

  const idempotencyKey = `walkthrough-${Date.now()}`;
  const created = await call<Provider>('POST', '/api/v1/providers', {
    cookie: adminCookie,
    headers: { 'idempotency-key': idempotencyKey },
    body: { providerType: 'doctor' },
  });
  if (created.status !== 201) {
    fail('create provider', `status ${created.status} ${JSON.stringify(created.body)}`);
    return;
  }
  const providerId = created.body.id;
  record('create doctor draft', `v${created.body.version} ${created.body.status}`);

  const replay = await call<Provider>('POST', '/api/v1/providers', {
    cookie: adminCookie,
    headers: { 'idempotency-key': idempotencyKey },
    body: { providerType: 'doctor' },
  });
  if (replay.status !== 200 || replay.body.id !== providerId) {
    fail('idempotent replay', `status ${replay.status}`);
  } else {
    record('idempotent replay', 'same provider id returned');
  }

  const saved = await call<Provider>('PATCH', `/api/v1/providers/${providerId}`, {
    cookie: adminCookie,
    body: { version: created.body.version, data: validDoctorData() },
  });
  if (saved.status !== 200) {
    fail('save full form', `status ${saved.status} ${JSON.stringify(saved.body).slice(0, 600)}`);
    return;
  }
  const storedFee = (
    saved.body.data.practice_locations as Array<{ prac_fee: number }> | undefined
  )?.[0]?.prac_fee;
  if (storedFee !== 50_000) {
    fail('money stored as integer paise', `expected 50000 for ₹500, got ${String(storedFee)}`);
  } else {
    record('money stored as integer paise', `₹500 -> ${storedFee} paise`);
  }

  const stale = await call<{ error?: { code: string } }>(
    'PATCH',
    `/api/v1/providers/${providerId}`,
    {
      cookie: adminCookie,
      body: { version: created.body.version, data: { reg_city: 'Kolkata' } },
    },
  );
  if (stale.status !== 409) {
    fail('optimistic locking', `expected 409, got ${stale.status}`);
  } else {
    record('optimistic locking', 'stale version rejected with 409');
  }

  const listed = await call<Provider[]>('GET', '/api/v1/providers?pin=700016&pageSize=10', {
    cookie: adminCookie,
  });
  const found = Array.isArray(listed.body) && listed.body.some((row) => row.id === providerId);
  if (listed.status !== 200 || !found) {
    fail('list by PIN', `status ${listed.status} found ${found}`);
  } else {
    record('list filtered by PIN 700016', `${listed.body.length} row(s)`);
  }

  const submitted = await call<Provider>('POST', `/api/v1/providers/${providerId}/submit`, {
    cookie: adminCookie,
    body: { declarationsAccepted: true },
  });
  if (submitted.status !== 200) {
    fail(
      'submit for verification',
      `status ${submitted.status} ${JSON.stringify(submitted.body).slice(0, 1200)}`,
    );
    return;
  }
  record('submit for verification', submitted.body.status);

  const detail = await call<{ provider: Provider; revisions: unknown[]; verifications: unknown[] }>(
    'GET',
    `/api/v1/providers/${providerId}`,
    { cookie: adminCookie },
  );
  record('detail with history', `${detail.body.revisions.length} revision(s)`);

  const verification = await call<{ status: string }>(
    'POST',
    `/api/v1/providers/${providerId}/verifications`,
    {
      cookie: adminCookie,
      body: {
        item: 'medical_registration',
        status: 'verified',
        source: 'West Bengal Medical Council',
      },
    },
  );
  if (verification.status !== 200) {
    fail('verification checklist', `status ${verification.status}`);
  } else {
    record('verification checklist', verification.body.status);
  }

  const approved = await call<Provider>('POST', `/api/v1/providers/${providerId}/review`, {
    cookie: adminCookie,
    body: { decision: 'approve', note: 'Documents match the council register.' },
  });
  if (approved.status !== 200 || approved.body.status !== 'approved_not_live') {
    fail('admin approve', `status ${approved.status} state ${approved.body?.status}`);
  } else {
    record('admin approve', approved.body.status);
  }

  const staffEmail = `staff.${Date.now()}@curenear.test`;
  const staffPassword = 'LocalDev-Staff-Pass-2026';
  const staffCreated = await call<{ id: string; role: string }>('POST', '/api/v1/admin/users', {
    cookie: adminCookie,
    body: {
      name: 'Walkthrough Staff',
      email: staffEmail,
      role: 'STAFF',
      temporaryPassword: staffPassword,
    },
  });
  if (staffCreated.status !== 201) {
    fail('create staff', `status ${staffCreated.status} ${JSON.stringify(staffCreated.body)}`);
  } else {
    record('admin creates staff account', staffEmail);
  }

  const staffCookie = await login(staffEmail, staffPassword);
  record('staff login', staffEmail);

  const staffRead = await call<unknown>('GET', `/api/v1/providers/${providerId}`, {
    cookie: staffCookie,
  });
  if (staffRead.status !== 403) {
    fail('staff isolation', `staff read returned ${staffRead.status}, expected 403`);
  } else {
    record('staff cannot read another user provider', '403');
  }

  const staffList = await call<Provider[]>('GET', '/api/v1/providers', { cookie: staffCookie });
  if (staffList.status !== 200 || (Array.isArray(staffList.body) && staffList.body.length !== 0)) {
    fail(
      'staff list scope',
      `status ${staffList.status} rows ${Array.isArray(staffList.body) ? staffList.body.length : '?'}`,
    );
  } else {
    record('staff list scoped to own providers', '0 rows');
  }

  const staffReview = await call<unknown>('POST', `/api/v1/providers/${providerId}/review`, {
    cookie: staffCookie,
    body: { decision: 'reject', reason: 'not allowed' },
  });
  if (staffReview.status !== 403) {
    fail('staff cannot review', `expected 403, got ${staffReview.status}`);
  } else {
    record('staff cannot review', '403');
  }

  const directory = await call<unknown[]>('GET', '/api/v1/admin/providers?page=1&pageSize=10', {
    cookie: adminCookie,
  });
  if (directory.status !== 200) {
    fail('provider directory', `status ${directory.status}`);
  } else {
    record('provider directory', '200');
  }

  const pages = [
    { path: '/', expected: 'Overview' },
    { path: '/admin/providers', expected: 'Provider directory' },
    { path: `/admin/providers/${providerId}`, expected: 'Dr A. Sen' },
    { path: '/admin/users', expected: 'Staff' },
  ];
  for (const page of pages) {
    const response = await fetch(`${baseUrl}${page.path}`, { headers: { cookie: adminCookie } });
    const html = await response.text();
    if (response.status !== 200 || !html.includes(page.expected)) {
      fail(`page ${page.path}`, `status ${response.status} missing "${page.expected}"`);
    } else {
      record(`page ${page.path}`, `renders "${page.expected}"`);
    }
  }

  const signedOut = await fetch(`${baseUrl}/`, { redirect: 'manual' });
  if (signedOut.status !== 307) {
    fail('signed-out redirect', `status ${signedOut.status}`);
  } else {
    record('signed-out visitor redirected to /login', '307');
  }
}

main()
  .catch((error: unknown) => {
    fail('walkthrough crashed', error instanceof Error ? error.message : String(error));
  })
  .finally(() => {
    process.stdout.write(`\n${results.join('\n')}\n`);
    process.stdout.write(
      `\n${failures === 0 ? 'WALKTHROUGH PASSED' : `WALKTHROUGH FAILED (${failures})`}\n`,
    );
    process.exitCode = failures === 0 ? 0 : 1;
  });
