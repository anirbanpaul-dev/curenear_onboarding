import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPrismaClient } from '@curenear/db';
import { providerTypes } from '@curenear/shared';
import { seedCompleteProvider } from './seed';
import { OPERATOR_EMAIL, OPERATOR_PASSWORD } from './global-setup';

/**
 * The enterprise critical path, exercised against the running app, the real
 * database and (for exports) the worker. One serialized journey keeps the
 * fixture state coherent; every assertion is on observable API state.
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const cookieName = process.env.SESSION_COOKIE_NAME ?? 'curenear_session';
const run = Date.now().toString(36) + randomUUID().slice(0, 4);

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const path of ['../../packages/db/.env', '.env.local']) {
    try {
      const text = readFileSync(resolve(process.cwd(), path), 'utf8');
      const match = /^DATABASE_URL=(.+)$/m.exec(text);
      if (match?.[1]) return match[1].trim().replace(/^["']|["']$/g, '');
    } catch {
      // try the next location
    }
  }
  throw new Error('E2E needs DATABASE_URL to seed an expiry notification');
}

async function login(api: APIRequestContext, email: string, password: string) {
  const response = await api.post('/api/v1/auth/login', {
    headers: { origin: baseURL, host: new URL(baseURL).host },
    data: { email, password },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response;
}

function sessionCookie(response: Awaited<ReturnType<APIRequestContext['post']>>): string {
  const header = response.headers()['set-cookie'] ?? '';
  const match = new RegExp(`${cookieName}=([^;]+)`).exec(header);
  expect(match, 'login sets a session cookie').not.toBeNull();
  return match![1]!;
}

async function asContext(browser: import('@playwright/test').Browser, token: string) {
  const context = await browser.newContext();
  await context.addCookies([{ name: cookieName, value: token, url: baseURL }]);
  return context;
}

test('admin creates staff, staff onboards all five types, review loop, filters, isolation and export', async ({
  browser,
  request,
}) => {
  await login(request, OPERATOR_EMAIL, OPERATOR_PASSWORD);

  // 1. Administrator creates a staff member; the temporary password is returned once.
  const staffEmail = `e2e-staff-${run}@curenear.in`;
  const created = await request.post('/api/v1/admin/staff', {
    data: {
      name: `E2E Staff ${run}`,
      email: staffEmail,
      mobile: '9830012345',
      employeeCode: `E${run.slice(-8)}`,
      pinCodes: ['700091'],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const staff = (await created.json()).data as {
    staff: { id: string };
    temporaryPassword: string;
  };
  expect(staff.staff.id).toBeTruthy();
  expect(staff.temporaryPassword).toBeTruthy();

  // 2. Staff sign in, are forced to change the password, then use the portal.
  const staffApi = await playwrightRequest.newContext({ baseURL });
  const firstLogin = await login(staffApi, staffEmail, staff.temporaryPassword);
  expect((await firstLogin.json()).data.mustChangePassword).toBe(true);
  const temporaryCookie = sessionCookie(firstLogin);

  const staffContext = await asContext(browser, temporaryCookie);
  const staffPage = await staffContext.newPage();

  const changed = await staffPage.request.post('/api/auth/change-password', {
    data: {
      currentPassword: staff.temporaryPassword,
      newPassword: 'e2e-staff-password-456',
    },
  });
  expect(changed.ok(), await changed.text()).toBe(true);

  const relogin = await login(staffApi, staffEmail, 'e2e-staff-password-456');
  const staffToken = sessionCookie(relogin);
  await staffContext.addCookies([{ name: cookieName, value: staffToken, url: baseURL }]);

  // 3. Staff onboards one provider of each type to SUBMITTED.
  const providerIds: Record<string, string> = {};
  const labels: Record<string, string> = {
    clinic: 'Clinic',
    diagnostic_centre: 'Diagnostic centre',
    doctor: 'Doctor',
    pharmacy: 'Pharmacy',
    care_provider: 'Home care',
  };

  for (const providerType of providerTypes) {
    const legalName = `${labels[providerType] ?? providerType} ${run}`;
    const create = await staffPage.request.post('/api/v1/providers', {
      data: {
        provider_type: providerType,
        legal_name: legalName,
        mobile: '9830012345',
        primary_pin_code: '700091',
      },
    });
    expect(create.status(), `${providerType}: ${await create.text()}`).toBe(201);
    const createdBody = (await create.json()).data as {
      provider?: { id?: string; organization?: { id: string } };
      organization?: { id: string };
      id?: string;
    };
    const id =
      createdBody.provider?.id ??
      createdBody.provider?.organization?.id ??
      createdBody.organization?.id ??
      createdBody.id;
    expect(id, providerType).toBeTruthy();
    providerIds[providerType] = id!;

    await seedCompleteProvider(staffPage, providerType, id!, run, legalName);

    const submit = await staffPage.request.post(`/api/v1/providers/${id}/submit`, { data: {} });
    expect(submit.ok(), `${providerType} submit: ${await submit.text()}`).toBe(true);

    const submitted = (await submit.json()).data as {
      organization?: { status: string };
      status?: string;
    };
    expect((submitted.organization?.status ?? submitted.status)?.toLowerCase()).toBe('submitted');
  }

  // 4. Admin requests changes; staff fixes and resubmits; admin approves.
  const firstId = providerIds.clinic!;
  const requestChanges = await request.post(`/api/v1/admin/review/${firstId}/decisions`, {
    data: {
      decision: 'request_changes',
      comment: 'Please re-upload the establishment licence.',
      sections: ['licences'],
    },
  });
  expect(requestChanges.ok(), await requestChanges.text()).toBe(true);

  const afterChanges = await staffPage.request.get(`/api/v1/providers/${firstId}`);
  const changedBody = (await afterChanges.json()).data;
  expect(changedBody.organization.status.toLowerCase()).toBe('changes_requested');

  const fixed = await staffPage.request.patch(
    `/api/v1/providers/${firstId}/sections/legal_entity`,
    {
      data: {
        version: changedBody.organization.version,
        data: { legal_name: `Clinic ${run}`, trade_name: `Clinic ${run}` },
      },
    },
  );
  expect(fixed.ok(), await fixed.text()).toBe(true);

  const resubmit = await staffPage.request.post(`/api/v1/providers/${firstId}/submit`, {
    data: {},
  });
  expect(resubmit.ok(), await resubmit.text()).toBe(true);

  for (const item of ['consent', 'registration', 'address']) {
    const verified = await request.patch(`/api/v1/admin/review/${firstId}/verifications/${item}`, {
      data: { status: 'VERIFIED', source: 'E2E document review' },
    });
    expect(verified.ok(), `${item}: ${await verified.text()}`).toBe(true);
  }

  const approve = await request.post(`/api/v1/admin/review/${firstId}/decisions`, {
    data: { decision: 'approve' },
  });
  expect(approve.ok(), await approve.text()).toBe(true);

  // 5. The PIN filter returns every provider seeded at 700091, and the approved
  // clinic is live in the administrator directory.
  const filtered = await request.get('/api/v1/admin/providers?pin=700091&pageSize=100');
  expect(filtered.ok()).toBe(true);
  const filteredRows = (await filtered.json()).data as Array<{ id: string; status: string }>;
  const filteredIds = filteredRows.map((row) => row.id);
  expect(filteredRows.find((row) => row.id === firstId)?.status.toLowerCase()).toBe('approved');
  for (const id of Object.values(providerIds)) {
    expect(filteredIds, `PIN filter contains ${id}`).toContain(id);
  }

  // 6. PIN analytics agrees with the directory for the same filter.
  // `createdFrom` forces the live aggregation, which must agree with the
  // directory; the maintained read model is covered separately.
  const analytics = await request.get(
    '/api/v1/admin/analytics/pin-summary?q=700091&groupBy=pin&pageSize=200&createdFrom=2020-01-01',
  );
  expect(analytics.ok(), await analytics.text()).toBe(true);
  const summary = (await analytics.json()).data as {
    rows: Array<{ pinCode: string | null; total: number; approved: number }>;
  };
  const pinRow = summary.rows.find((row) => row.pinCode === '700091');
  expect(pinRow).toBeDefined();
  expect(pinRow!.total).toBeGreaterThanOrEqual(providerTypes.length);
  expect(pinRow!.approved).toBeGreaterThanOrEqual(1);

  // 7. Another staff account cannot read this staff member’s provider.
  const otherEmail = `e2e-other-${run}@curenear.in`;
  const other = await request.post('/api/v1/admin/staff', {
    data: {
      name: `Other Staff ${run}`,
      email: otherEmail,
      mobile: '9830012346',
      employeeCode: `O${run.slice(-8)}`,
      pinCodes: ['700091'],
    },
  });
  expect(other.status(), await other.text()).toBe(201);
  const otherTempPassword = ((await other.json()).data as { temporaryPassword: string })
    .temporaryPassword;
  const otherApi = await playwrightRequest.newContext({ baseURL });
  const otherLogin = await login(otherApi, otherEmail, otherTempPassword);
  const otherContext = await asContext(browser, sessionCookie(otherLogin));
  const hidden = await otherContext.request.get(`/api/v1/providers/${firstId}`);
  expect([403, 404]).toContain(hidden.status());

  // 8. A document-expiry reminder is visible to the owning staff account.
  const me = await staffPage.request.get('/api/auth/me');
  const staffUserId = (await me.json()).data.user.id as string;
  const prisma = createPrismaClient(databaseUrl());
  try {
    await prisma.notification.create({
      data: {
        userId: staffUserId,
        type: 'document.expiring',
        title: `Licence expires soon (${run})`,
        body: 'The establishment licence expires in 7 days.',
        entityType: 'provider_organization',
        entityId: firstId,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
  const notifications = await staffPage.request.get('/api/v1/notifications?unread=true');
  expect(notifications.ok()).toBe(true);
  const titles = ((await notifications.json()).data.rows as Array<{ title: string }>).map(
    (row) => row.title,
  );
  expect(titles).toContain(`Licence expires soon (${run})`);

  // 9. A CSV export runs through the worker and downloads from object storage.
  if (process.env.E2E_EXPORTS === '1') {
    const exportRequest = await staffPage.request.post('/api/v1/exports', {
      data: { type: 'providers', filters: {} },
    });
    expect([201, 202], await exportRequest.text()).toContain(exportRequest.status());
    const exportId = (await exportRequest.json()).data.id as string;

    let exportRow: { id: string; status: string; downloadable: boolean } | undefined;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const history = await staffPage.request.get('/api/v1/exports');
      exportRow = ((await history.json()).data.rows as (typeof exportRow)[]).find(
        (row) => row?.id === exportId,
      );
      if (exportRow?.status === 'SUCCEEDED' || exportRow?.status === 'FAILED') break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    expect(exportRow?.status, JSON.stringify(exportRow)).toBe('SUCCEEDED');

    const download = await staffPage.request.get(`/api/v1/exports/${exportId}/download`, {
      maxRedirects: 0,
    });
    expect([302, 303, 307]).toContain(download.status());
    const location = download.headers()['location'];
    expect(location).toBeTruthy();
    const file = await staffPage.request.get(location!, { maxRedirects: 0 });
    expect(file.status()).toBe(200);
    expect(await file.text()).toContain('provider');
  } else {
    test.info().annotations.push({
      type: 'skip',
      description: 'Export download runs when E2E_EXPORTS=1 and the worker + MinIO are up.',
    });
  }

  await otherApi.dispose();
  await staffApi.dispose();
  await staffContext.close();
  await otherContext.close();
});
