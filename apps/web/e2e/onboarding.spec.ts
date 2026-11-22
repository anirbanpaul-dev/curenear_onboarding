import { expect, test } from '@playwright/test';

// The operator has already replaced its password, so these journeys never see the
// forced change screen (see global-setup.ts).
const email = process.env.E2E_ADMIN_EMAIL ?? 'e2e-operator@curenear.in';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'e2e-operator-password-123';

test.describe('provider onboarding', () => {
  test('signs in, creates a doctor draft and saves it', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

    await page.getByRole('link', { name: 'Onboard a provider' }).first().click();
    await page.getByLabel('Provider type').selectOption('doctor');
    await page.getByRole('button', { name: 'Create draft' }).click();

    await expect(page.getByRole('heading', { name: 'Untitled draft' })).toBeVisible({
      timeout: 60_000,
    });

    // Label text carries the required marker, so address the field by accessible name.
    await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Dr E2E Test');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('status')).toContainText('Draft saved');

    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Display name', exact: true })).toHaveValue(
      'Dr E2E Test',
    );
  });

  test('shows validation issues when submitting an incomplete draft', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await page.getByRole('link', { name: 'Providers', exact: true }).click();
    await page.getByRole('link', { name: 'Dr E2E Test' }).first().click();
    await page.getByRole('button', { name: 'Submit for verification' }).click();

    await expect(page.getByRole('alert').first()).toBeVisible();
  });
});
