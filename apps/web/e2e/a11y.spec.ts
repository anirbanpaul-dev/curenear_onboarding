import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signIn } from './seed';

/**
 * Accessibility gate: WCAG 2.1 A/AA rules, failing only on serious or critical
 * violations so the suite stays actionable. The JSON report is attached to the
 * Playwright report for triage.
 */
const pages = [
  { path: '/admin', name: 'admin overview' },
  { path: '/admin/providers', name: 'provider directory' },
  { path: '/admin/analytics', name: 'PIN analytics' },
  { path: '/notifications', name: 'notifications' },
  { path: '/exports', name: 'export history' },
  { path: '/staff/providers', name: 'staff providers' },
  { path: '/staff/providers/new', name: 'new provider' },
];

test.describe('accessibility', () => {
  test('login page has no serious or critical violations', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('#email')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    await test.info().attach('axe-login.json', {
      body: JSON.stringify(results, null, 2),
      contentType: 'application/json',
    });

    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(
      blocking.map(
        (violation) =>
          `${violation.id}: ${violation.help} :: ${violation.nodes
            .slice(0, 5)
            .map((node) => `${node.target.join(' ')} <${node.html}>`)
            .join(' | ')}`,
      ),
    ).toEqual([]);
  });

  test('main portal pages have no serious or critical violations', async ({ page }) => {
    await signIn(page);

    for (const target of pages) {
      await page.goto(target.path);
      await page.waitForLoadState('networkidle');

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      await test.info().attach(`axe-${target.name.replace(/\s+/g, '-')}.json`, {
        body: JSON.stringify(results, null, 2),
        contentType: 'application/json',
      });

      const blocking = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );
      expect(
        blocking.map(
          (violation) =>
            `${target.path} → ${violation.id}: ${violation.help} :: ${violation.nodes
              .slice(0, 5)
              .map((node) => `${node.target.join(' ')} <${node.html}>`)
              .join(' | ')}`,
        ),
        `${target.name} must be accessible`,
      ).toEqual([]);
    }
  });
});
