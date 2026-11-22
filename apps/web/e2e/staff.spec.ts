import { expect, test } from '@playwright/test';
import { OPERATOR_EMAIL, OPERATOR_PASSWORD } from './global-setup';

test('admin creates staff, staff signs in, changes the password and sees an empty dashboard', async ({
  page,
}) => {
  const stamp = Date.now();
  const staffEmail = `e2e.staff.${stamp}@curenear.in`;
  const staffName = `E2E Starter ${stamp}`;
  const changedPassword = 'e2e-staff-password-456';

  // 1. Admin signs in and creates the account.
  await page.goto('/login');
  await page.locator('#email').fill(OPERATOR_EMAIL);
  await page.locator('#password').fill(OPERATOR_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.getByRole('link', { name: 'Staff' }).click();
  await expect(page).toHaveURL(/\/admin\/staff$/);

  await page.getByTestId('add-staff').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('#staff-name').fill(staffName);
  await page.locator('#staff-email').fill(staffEmail);
  await page.locator('#staff-mobile').fill('9876543210');
  await page.locator('#staff-employee-code').fill(`E2E${stamp}`);
  // Territory PINs come from the master directory picker; a code the directory
  // does not know can still be added, so this works before an import too.
  await page.locator('#staff-pins').fill('700016');
  await page.locator('#staff-pins').press('Enter');
  await page.locator('#staff-pins').fill('700091');
  await page.locator('#staff-pins').press('Enter');
  await expect(page.getByRole('list', { name: 'Selected PIN codes' })).toContainText('700016');
  await page.getByRole('button', { name: 'Create staff member' }).click();

  // 2. The temporary password is shown exactly once.
  const passwordField = page.getByTestId('temporary-password');
  await expect(passwordField).toBeVisible();
  const temporaryPassword = (await passwordField.textContent())?.trim() ?? '';
  expect(temporaryPassword).toHaveLength(19);

  // The new person appears in the directory with their territory.
  await expect(page.getByRole('cell', { name: staffEmail })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: staffEmail });
  await expect(row).toContainText(staffName);
  await expect(row).toContainText('700016, 700091');

  // The detail page shows the profile, territory, provider count and audit trail.
  await page.getByRole('link', { name: staffName }).click();
  await expect(page.getByRole('heading', { name: staffName })).toBeVisible();
  await expect(page.getByText('Providers onboarded')).toBeVisible();
  await expect(page.getByText('staff.created')).toBeVisible();
  await page.goto('/admin/staff');

  // 3. The staff member signs in and is forced to replace the password.
  await page.context().clearCookies();
  await page.goto('/login');
  await page.locator('#email').fill(staffEmail);
  await page.locator('#password').fill(temporaryPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/change-password/);
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await page.locator('#currentPassword').fill(temporaryPassword);
  await page.locator('#newPassword').fill(changedPassword);
  await page.locator('#confirmPassword').fill(changedPassword);
  await page.getByRole('button', { name: 'Change password' }).click();

  // 4. They land on their own empty dashboard.
  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText('No providers match these filters.')).toBeVisible();
});
