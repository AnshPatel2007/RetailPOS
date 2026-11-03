import { test, expect } from '@playwright/test';
import { login, TEST_USER } from './utils/auth-helper';

test('CSV preview applies once after a lost response and browser reload', async ({ page }) => {
  await login(page, TEST_USER.email); await page.goto('/inventory');
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
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
  await page.reload(); await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
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
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Import Products from CSV', exact: true });
  await modal.getByLabel('CSV file', { exact: true }).setInputFiles({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('sku,name,price,stock\nINVALID-ROW,Invalid,abc,-1') });
  await modal.getByRole('button', { name: 'Review import', exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText('Row 2:');
  await expect(modal.getByRole('button', { name: 'Apply reviewed import', exact: true })).toHaveCount(0);
});

test('receipt suggestions require an explicit SKU and price before a reviewed import', async ({ page }) => {
  await login(page, TEST_USER.email); await page.goto('/inventory');
  await page.setViewportSize({ width: 390, height: 844 });
  const moreActions = page.getByText('More actions', { exact: true });
  await moreActions.click();
  await page.keyboard.press('Escape');
  await expect(moreActions).toBeFocused();
  await moreActions.click();
  // Stub only the external OCR provider response; preview/application use the real API.
  await page.route('**/api/products/scan-receipt', route => route.fulfill({ json: { success: true, data: {
    supplier: 'Browser Receipt Supplier', invoiceNumber: 'BROWSER-1', existingProducts: [],
    items: [{ name: 'Receipt Coffee', quantity: 2, packSize: 3, unitQuantity: 6, unitCost: 1.25, totalCost: 7.5 }],
  } } }));
  await page.getByRole('button', { name: 'Scan Receipt', exact: true }).click();
  await page.getByLabel('Receipt image', { exact: true }).setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD6sAAAAASUVORK5CYII=', 'base64') });
  await page.getByRole('dialog').getByRole('button', { name: 'Scan Receipt', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Review Scanned Items', exact: true });
  await modal.getByRole('button', { name: 'Review import (1 item)', exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText('Row 1:');
  await expect(modal.getByRole('button', { name: 'Apply reviewed import', exact: true })).toHaveCount(0);
  await modal.getByRole('button', { name: 'Back to edit', exact: true }).click();
  await modal.getByLabel('SKU for item 1', { exact: true }).fill('BROWSER-RECEIPT');
  await modal.getByLabel('Retail price for item 1', { exact: true }).fill('3.50');
  await modal.getByRole('button', { name: 'Review import (1 item)', exact: true }).click();
  await expect(modal.getByText('Receipt Coffee', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await expect(modal.getByRole('button', { name: 'Apply reviewed import', exact: true })).toBeInViewport();
  expect(await modal.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/receipt-import-mobile-dark.png', fullPage: true });
  await modal.getByRole('button', { name: 'Apply reviewed import', exact: true }).click();
  await expect(modal.getByRole('status')).toContainText('Import complete: 1 created, 0 updated.');
  await modal.getByRole('button', { name: 'Done', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByPlaceholder('Search by name, SKU, or barcode...').fill('BROWSER-RECEIPT');
  const row = page.getByRole('row').filter({ hasText: 'BROWSER-RECEIPT' });
  await expect(row).toHaveCount(1); await expect(row.getByText('6', { exact: true })).toBeVisible();
});
