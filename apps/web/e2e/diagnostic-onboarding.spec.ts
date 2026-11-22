import { expect, test } from '@playwright/test';
import { testCatalogueTemplateCsv } from '@curenear/shared';
import { createDraft, seedCompleteProvider, signIn, submitProvider } from './seed';

test.describe('diagnostic centre onboarding', () => {
  test.setTimeout(240_000);

  test('staff imports a test catalogue, sees the row report and submits', async ({ page }) => {
    const unique = Date.now().toString().slice(-7);
    const legalName = `E2E Diagnostics ${unique}`;
    const mobile = `9${unique}${unique.slice(0, 2)}`.slice(0, 10);
    const pin = `7${unique}`.slice(0, 6);

    await signIn(page);
    const id = await createDraft(page, /^Diagnostic centre/, legalName, mobile, pin);
    await seedCompleteProvider(page, 'diagnostic_centre', id, unique, legalName);

    await page.reload();
    await page.getByRole('button', { name: /^Services, workflow approvals and pricing/ }).click();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download CSV template' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('test-catalogue.csv');

    const header = testCatalogueTemplateCsv().split('\n')[0];
    const csv = [
      header,
      'E2E Vitamin D,VD-1,pathology,900,blood,No fasting required,48 hours,yes,on site,,yes',
      'E2E Sex determination scan,SD-1,ultrasound,900,imaging,None,1 hour,yes,on site,,no',
      'E2E Prenatal anomaly scan,PN-1,prenatal,2500,imaging,None,2 days,yes,on site,,no',
    ].join('\n');

    await page.getByLabel('Import test catalogue CSV').setInputFiles({
      name: 'catalogue.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    });

    await expect(page.getByText('Imported 2 of 3 rows')).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByRole('row').filter({ hasText: 'E2E Sex determination scan' }),
    ).toContainText('blocked');
    await expect(
      page.getByRole('row').filter({ hasText: 'E2E Prenatal anomaly scan' }),
    ).toContainText('flagged');
    await expect(page.getByRole('row').filter({ hasText: 'E2E Vitamin D' })).toContainText(
      'imported',
    );

    await submitProvider(page);

    await page.goto('/staff/providers');
    await expect(page.getByText(legalName)).toBeVisible();
  });
});
