import { expect, test } from '@playwright/test';
import {
  FORCED_ADMIN_EMAIL,
  FORCED_ADMIN_PASSWORD,
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
} from './global-setup';

test.describe('authentication', () => {
  test('admin signs in, is forced to change the password and lands on /admin', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#email').fill(FORCED_ADMIN_EMAIL);
    await page.locator('#password').fill(FORCED_ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/change-password/);
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();

    await page.locator('#currentPassword').fill(FORCED_ADMIN_PASSWORD);
    await page.locator('#newPassword').fill('e2e-changed-password-456');
    await page.locator('#confirmPassword').fill('e2e-changed-password-456');
    await page.getByRole('button', { name: 'Change password' }).click();

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  });

  test('anonymous visitors are redirected to /login', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/login/);
  });

  test('operator signs in and reaches the admin overview without a forced change', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.locator('#email').fill(OPERATOR_EMAIL);
    await page.locator('#password').fill(OPERATOR_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  });
});
