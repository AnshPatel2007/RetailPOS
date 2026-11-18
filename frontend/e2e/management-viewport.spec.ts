import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

// Reduced CSS viewports exercise the space available at enlarged laptop display scales.
for (const viewport of [{ width: 1366, height: 650 }, { width: 1093, height: 525 }, { width: 911, height: 433 }]) {
  for (const role of [
    { name: 'owner', email: 'owner@example.test', paths: ['/dashboard', '/inventory', '/financial', '/insights/reports/overview'] },
    { name: 'platform', email: 'platform@example.test', paths: ['/admin', '/admin/stores', '/admin/users'] },
  ]) {
    test(`${role.name} pages use the full laptop viewport at ${viewport.width}px`, async ({ page }, info) => {
      await page.setViewportSize(viewport);
      await login(page, role.email);
      for (const path of role.paths) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        const main = page.getByRole('main');
        await expect(main.locator('.page-header h1')).toBeVisible();
        const bounds = await main.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.y + bounds!.height, path + ' ends at the window bottom').toBeCloseTo(viewport.height, 0);
        expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        for (const value of await main.locator('.metric-value').all()) {
          expect(await value.evaluate(element => {
            const card = element.closest('.metric-grid > *')!.getBoundingClientRect();
            const bounds = element.getBoundingClientRect();
            return element.scrollWidth <= element.clientWidth + 1 && bounds.right <= card.right && bounds.left >= card.left;
          }), path + ' metric fits its card').toBe(true);
        }
        await page.screenshot({ path: info.outputPath(path.replaceAll('/', '-') + '-top.png'), animations: 'disabled' });
        await main.evaluate(element => { element.scrollTop = element.scrollHeight; });
        if (path === '/inventory' || path === '/admin/stores') {
          const lastRow = main.locator('tbody tr').last();
          await expect(lastRow).toBeInViewport();
          const row = await lastRow.boundingBox();
          const launcher = await page.getByRole('button', { name: 'Open POS assistant', exact: true }).boundingBox();
          expect(row!.y + row!.height, 'Last record can scroll clear of the assistant').toBeLessThanOrEqual(launcher!.y - 8);
          await page.screenshot({ path: info.outputPath(path.replaceAll('/', '-') + '-bottom.png'), animations: 'disabled' });
        }
      }
    });
  }
}
