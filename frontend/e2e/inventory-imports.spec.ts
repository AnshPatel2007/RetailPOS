import { test, expect } from '@playwright/test';
import { login, TEST_USER } from './utils/auth-helper';
import { clickHeaderAction } from './utils/header-helper';

test('CSV preview applies once after a lost response and browser reload', async ({ page }) => {
  await login(page, TEST_USER.email); await page.goto('/inventory');
  await clickHeaderAction(page, 'Import CSV');
  const modal = page.getByRole('dialog', { name: 'Import Products from CSV', exact: true });
  await modal.getByLabel('CSV file', { exact: true }).setInputFiles({ name: 'review.csv', mimeType: 'text/csv', buffer: Buffer.from('sku,name,price,cost,stock\nBROWSER-IMPORT,"Coffee, quoted",2.75,1.25,8') });
  await modal.getByRole('button', { name: 'Review import', exact: true }).click();
  await expect(modal.getByText('1 rows: 1 new products, 0 existing products.', { exact: true })).toBeVisible();
  await expect(modal.getByText('Coffee, quoted', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/inventory-import-preview.png', fullPage: true });
  await page.route('**/api/products/imports/*/apply', async route => {
    const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed');
  }, { times: 1 });
  await modal.getByRole('button', { name: 'Apply reviewed import', exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText('Result unconfirmed');
  await page.reload(); await clickHeaderAction(page, 'Import CSV');
  const saved = page.waitForResponse(r => r.url().includes('/imports/') && r.url().endsWith('/apply'));
  await modal.getByRole('button', { name: 'Retry saved import', exact: true }).click();
  expect((await (await saved).json()).data.replayed).toBe(true);
  await expect(modal.getByRole('status')).toContainText('Import complete: 1 created, 0 updated.');
  await modal.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByPlaceholder('Search by name, SKU, or barcode...').fill('BROWSER-IMPORT');
  const row = page.getByRole('row').filter({ hasText: 'BROWSER-IMPORT' });
  await expect(row).toHaveCount(1); await expect(row.getByText('8', { exact: true })).toBeVisible();
});

test('invalid CSV rows remain a review error without an apply control', async ({ page }) => {
  await login(page, TEST_USER.email); await page.goto('/inventory');
  await clickHeaderAction(page, 'Import CSV');
  const modal = page.getByRole('dialog', { name: 'Import Products from CSV', exact: true });
  await modal.getByLabel('CSV file', { exact: true }).setInputFiles({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('sku,name,price,stock\nINVALID-ROW,Invalid,abc,-1') });
  await modal.getByRole('button', { name: 'Review import', exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText('Row 2:');
  await expect(modal.getByRole('button', { name: 'Apply reviewed import', exact: true })).toHaveCount(0);
});

// Invoice photos are read and received through Purchasing > Receive Delivery (delivery-invoices.spec.ts).
