import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';

test('product workspace keeps the catalog prominent and groups all product fields', async ({ page }, info) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await login(page, 'owner@example.test');
  await page.goto('/inventory');
  const row = page.getByRole('row').filter({ hasText: 'Fixture Coffee' });
  await expect(row).toBeVisible();
  // Other specs may add products. Measure the catalog's first row, not its sort order.
  // (Leaves room for the Single items / Packs tabs above the catalog.)
  expect((await page.locator('.products-table tbody tr').first().boundingBox())!.y).toBeLessThan(350);
  await expect(page.getByText('Total Products', { exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Showing' })).toHaveText(/Showing 1 to \d+ of \d+ products/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('products-laptop.png'), animations: 'disabled' });

  await row.getByRole('button', { name: 'Edit Fixture Coffee', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Product', exact: true });
  // Essentials stay open; everything else is one click away.
  for (const title of ['Basics', 'Selling rules']) {
    await expect(dialog.getByRole('heading', { name: title, exact: true })).toHaveCount(1);
  }
  for (const title of ['Pricing help', 'Packs of this item', 'How you buy it', 'Brand, size & description', 'Advanced']) {
    await expect(dialog.locator('summary', { hasText: title })).toHaveCount(1);
  }
  await expect(dialog.getByLabel('Image URL', { exact: true })).toBeHidden();
  for (const name of ['SKU', 'Product Name', 'Cost Price', 'Retail Price', 'Stock Quantity', 'Low Stock Alert']) {
    await expect(dialog.getByLabel(name, { exact: true })).toHaveAttribute('required', '');
  }
  await expect(dialog.getByRole('button', { name: 'Update Product', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('product-form-laptop.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Edit Fixture Coffee', exact: true })).toBeFocused();
});

test('phone product cards retain actions, filter recovery and dark-theme form layout', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'owner@example.test');
  await page.goto('/inventory');
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  const row = page.getByRole('row').filter({ hasText: 'Fixture Coffee' });
  await expect(row).toBeVisible();
  const more = row.getByRole('button', { name: 'More actions for Fixture Coffee', exact: true });
  await more.click();
  await expect(page.getByRole('menuitem', { name: 'Adjust Stock', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await page.getByRole('searchbox', { name: 'Search products', exact: true }).fill('No matching product fixture');
  await expect(page.getByText('No products found', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(row).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('products-phone-dark.png'), animations: 'disabled' });
  await row.getByRole('button', { name: 'Edit Fixture Coffee', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Product', exact: true });
  await dialog.getByLabel('SKU', { exact: true }).focus();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(dialog.getByLabel('SKU', { exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Update Product', exact: true })).toBeInViewport();
  for (const name of ['Cancel', 'Update Product', 'Auto-fill']) {
    expect((await dialog.getByRole('button', { name, exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: info.outputPath('product-form-phone-dark.png'), animations: 'disabled' });
});

test('long product identities, large values and unavailable images stay readable', async ({ page }, info) => {
  await login(page, 'owner@example.test');
  const longName = 'Imported reserve product with a long descriptive name and packaging details';
  // Change display responses only; store products and costing records remain untouched.
  await page.route('**/api/products?*', async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.data[0] = { ...body.data[0], name: longName, sku: 'LONG-IDENTIFIER-WITHOUT-BREAKS-0123456789', price: 9999999.99, cost: 999999.99, image: '/unavailable-product-image.png' };
    await route.fulfill({ response, json: body });
  });
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 844 }); await page.goto('/inventory');
    const row = page.getByRole('row').filter({ hasText: longName });
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: 'Edit ' + longName, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await row.evaluate(element => [...element.querySelectorAll('td')].every(cell => cell.scrollWidth <= cell.clientWidth + 1))).toBe(true);
    await page.screenshot({ path: info.outputPath(`products-long-content-${width}.png`) });
  }
});
