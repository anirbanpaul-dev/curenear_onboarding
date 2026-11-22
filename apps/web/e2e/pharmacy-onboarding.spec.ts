import { expect, test } from '@playwright/test';
import { createDraft, seedCompleteProvider, signIn, submitProvider } from './seed';

test.describe('pharmacy onboarding', () => {
  // First hits in `next dev` compile the route; the seeded sections need room.
  test.setTimeout(240_000);

  test('staff fills the pharmacy sections and submits the pharmacy', async ({ page }) => {
    const unique = Date.now().toString().slice(-7);
    const legalName = `E2E Pharmacy ${unique}`;
    const mobile = `9${unique}${unique.slice(0, 2)}`.slice(0, 10);
    const pin = `7${unique}`.slice(0, 6);

    await signIn(page);
    const id = await createDraft(page, /^Pharmacy/, legalName, mobile, pin);
    await seedCompleteProvider(page, 'pharmacy', id, unique, legalName);

    // Drug licences: the registry repeater is editable in the UI and saving it
    // keeps the certificate that the API attached.
    await page.reload();
    await page.getByRole('button', { name: /^Licences and premises/ }).click();
    await page.getByRole('button', { name: 'Edit' }).first().click();
    await page.locator('#ph_licences-0-form_type').fill('20B / 21B');
    await page.getByRole('button', { name: 'Save licences' }).click();
    // The first save compiles the licence route in dev, which can take ~11s.
    await expect(page.getByText('Licences saved')).toBeVisible({ timeout: 60_000 });

    // Delivery coverage lives in provider_service_pins, keyed by the field role.
    await page.getByRole('button', { name: /^Products, ordering and fulfilment/ }).click();
    await expect(page.getByText('Delivery PIN codes')).toBeVisible({ timeout: 30_000 });
    await page
      .getByPlaceholder('Paste 6-digit PIN codes, separated by spaces or commas')
      .fill('700092');
    await page.getByRole('button', { name: 'Add PINs' }).click();
    await expect(page.getByText('700092')).toBeVisible({ timeout: 30_000 });

    await submitProvider(page);

    await page.goto('/staff/providers');
    await expect(page.getByText(legalName)).toBeVisible();
    await expect(page.getByText('SUBMITTED').first()).toBeVisible();
  });
});
