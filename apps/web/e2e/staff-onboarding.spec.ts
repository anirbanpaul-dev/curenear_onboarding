import { expect, test } from '@playwright/test';

const email = process.env.E2E_ADMIN_EMAIL ?? 'e2e-operator@curenear.in';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'e2e-operator-password-123';

test.describe('staff onboarding wizard', () => {
  test('creates a draft, saves a section, reloads and keeps the data', async ({ page }) => {
    const unique = Date.now().toString().slice(-6);
    const legalName = `E2E Clinic ${unique}`;
    const mobile = `9${unique}${unique.slice(0, 3)}`.slice(0, 10);
    const pin = `7${unique}`.slice(0, 6);

    await page.goto('/login');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

    await page.goto('/staff/providers/new');
    await page.getByRole('button', { name: /^Clinic/ }).click();
    await page.getByLabel('Legal name').fill(legalName);
    await page.getByLabel('Mobile number').fill(mobile);
    await page.getByLabel('Primary PIN code').fill(pin);
    await page.getByRole('button', { name: 'Create draft' }).click();

    await expect(page).toHaveURL(/\/staff\/providers\/[0-9a-f-]+\/edit/);
    const tradeName = page.getByLabel(/Trade \/ display name/);
    await tradeName.fill('E2E Trade Name');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('status')).toContainText('Draft saved');

    await page.reload();
    await expect(page.getByLabel(/Trade \/ display name/)).toHaveValue('E2E Trade Name');
    await expect(page.getByRole('heading', { name: legalName })).toBeVisible();
  });
});
