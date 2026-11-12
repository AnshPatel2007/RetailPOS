import { test, expect, Page } from '@playwright/test';
import { login } from './utils/auth-helper';

const auth = async (page: Page) => ({ Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) });

// receive@example.test owns a store no other spec changes prices in.
test('labels for changed prices print from Products and from Price Review, then leave the list', async ({ page }) => {
  await login(page, 'receive@example.test');
  const headers = await auth(page), stamp = Date.now();
  const call = async (method: 'get' | 'post' | 'put', path: string, data?: object) => {
    const response = await page.request[method]('/api' + path, { headers, ...(data ? { data } : {}) });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return (await response.json()).data;
  };
  const tea = await call('post', '/products', { name: `Label Tea ${stamp}`, sku: `LBL-TEA-${stamp}`, barcode: `${stamp}5`, price: 2, cost: 1, isTaxable: false, trackInventory: true });
  const packaging = await call('post', `/products/${tea.id}/selling-units`, { name: '6-pack', barcode: `${stamp}6`, unitsPerPackage: 6, price: 10 });
  const pack = packaging.sellingUnits.find((unit: { barcode: string }) => unit.barcode === `${stamp}6`);
  await call('put', `/products/${tea.id}`, { price: 2.25 });
  await call('put', `/products/${tea.id}/selling-units/${pack.id}`, { price: 11, expectedVersion: pack.version });
  const ours = (items: { name: string }[]) => items.map(item => item.name).filter(name => name.includes(String(stamp))).sort();
  expect(ours((await call('get', '/products/labels/pending')).items)).toEqual([`Label Tea ${stamp}`, `Label Tea ${stamp} (6-pack)`]);

  // The attention list links straight to the labels.
  await page.goto('/inventory?labels=pending');
  const sheet = page.getByRole('dialog', { name: 'Print Barcode Labels' });
  await expect(sheet.getByText(`Label Tea ${stamp} (6-pack)`)).toBeVisible();
  await expect(sheet.getByText(`Label Tea ${stamp}`, { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/inventory$/);
  const popup = page.waitForEvent('popup');
  await sheet.getByRole('button', { name: 'Print Labels' }).click();
  await (await popup).close();
  const confirm = page.getByRole('dialog', { name: 'Did the labels print?' });
  await confirm.getByRole('button', { name: 'Yes, mark printed' }).click();
  await expect(confirm).toHaveCount(0);
  expect(ours((await call('get', '/products/labels/pending')).items)).toEqual([]);

  // Price Review: after applying a new price, print just that item's label.
  await call('put', '/pricing/rules', { scope: 'STORE', targetMargin: 0.6, rounding: 'CENT' });
  await page.goto('/inventory/purchasing/price-review');
  await page.getByRole('checkbox', { name: 'Select every item' }).uncheck();
  await page.getByRole('checkbox', { name: `Apply new price for Label Tea ${stamp}`, exact: true }).check();
  await page.getByRole('button', { name: 'Apply 1 price' }).click();
  const offer = page.getByRole('status').filter({ hasText: 'New prices for 1 item' });
  await expect(offer).toContainText('Their shelf labels still show the old price.');
  await offer.getByRole('button', { name: 'Print labels for these items' }).click();
  await expect(sheet.getByText(`Label Tea ${stamp}`, { exact: true })).toBeVisible();
  await expect(sheet.getByText(`Label Tea ${stamp} (6-pack)`)).toHaveCount(0); // only what was just repriced
  const reprint = page.waitForEvent('popup');
  await sheet.getByRole('button', { name: 'Print Labels' }).click();
  await (await reprint).close();
  await confirm.getByRole('button', { name: 'Yes, mark printed' }).click();
  await expect(confirm).toHaveCount(0);
  expect(ours((await call('get', '/products/labels/pending')).items)).toEqual([]);
});
