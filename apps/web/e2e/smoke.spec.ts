import { expect, test } from '@playwright/test';

test.describe('service probes', () => {
  test('liveness answers with the API envelope', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    expect(response.headers()['x-request-id']).toBeTruthy();

    const body = (await response.json()) as {
      data: { status: string };
      requestId: string;
    };
    expect(body.data.status).toBe('ok');
    expect(body.requestId).toBeTruthy();
  });

  test('readiness reports database and storage', async ({ request }) => {
    const response = await request.get('/api/ready');
    // 200 when PostgreSQL and MinIO are up; 503 otherwise, but always structured.
    expect([200, 503]).toContain(response.status());

    const body = (await response.json()) as {
      data: { status: string; checks: { database: string; storage: string } };
    };
    expect(['ready', 'not_ready']).toContain(body.data.status);
    expect(body.data.checks).toEqual({
      database: expect.stringMatching(/^(ok|unavailable)$/),
      storage: expect.stringMatching(/^(ok|unavailable)$/),
    });

    if (process.env.E2E_EXPECT_READY === '1') {
      expect(response.status()).toBe(200);
      expect(body.data.checks).toEqual({ database: 'ok', storage: 'ok' });
    }
  });
});
