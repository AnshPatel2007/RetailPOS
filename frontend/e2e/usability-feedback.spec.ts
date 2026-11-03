import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

for (const width of [1093, 390]) test(`product save preserves drafts and prevents duplicate submissions at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 525 });
  await login(page, 'owner@example.test');
  await page.goto('/inventory');
  if (width === 390) await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.getByRole('button', { name: 'Edit Fixture Coffee', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Product', exact: true });
  await dialog.getByLabel('Description', { exact: true }).fill('Draft preserved after a failed save');
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let attempts = 0;
  await page.route('**/api/products/*', async route => {
    if (!['PUT', 'PATCH'].includes(route.request().method())) return route.continue();
    attempts++;
    if (attempts === 1) {
      await held;
      return route.fulfill({ status: 503, json: { error: 'Save unavailable. Please try again.' } });
    }
    return route.continue();
  });
  const save = dialog.getByRole('button', { name: 'Update Product', exact: true });
  await expect(save).toBeInViewport();
  await save.click();
  await expect.poll(() => attempts).toBe(1);
  await expect(dialog.getByRole('button', { name: 'Saving...', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('Product Name', { exact: true })).toBeDisabled();
  // A second programmatic submission must also be ignored, not just a second click.
  await dialog.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  expect(attempts).toBe(1);
  release();
  await expect(dialog.getByRole('alert')).toHaveText('Save unavailable. Please try again.');
  await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue('Draft preserved after a failed save');
  await expect(save).toBeEnabled();
  await page.screenshot({ path: info.outputPath('product-save-retry.png'), animations: 'disabled' });
  await save.click();
  await expect(dialog).toHaveCount(0);
  expect(attempts).toBe(2);
});

test('product rows keep price, stock and actions visible on phones', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'owner@example.test');
  await page.goto('/inventory');
  const row = page.getByRole('row').filter({ hasText: 'Fixture Coffee' });
  await expect(row).toBeVisible();
  await expect(page.getByRole('region', { name: 'Scrollable table', exact: true })).toHaveCount(0);
  for (const selector of ['.product-name', '.product-price-cell', '.product-stock-cell', '.product-row-actions']) {
    expect(await row.locator(selector).evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= window.innerWidth;
    })).toBe(true);
  }
  await expect(row.getByRole('button', { name: 'Edit Fixture Coffee', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.getByRole('region', { name: 'Scrollable table', exact: true })).toHaveCount(0);
});
