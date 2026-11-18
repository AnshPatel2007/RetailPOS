import { test, expect, Page } from '@playwright/test';
import { login, logout } from './utils/auth-helper';

async function headers(page: Page) {
  return { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) };
}
async function storageKey(page: Page) {
  return page.evaluate(() => {
    const user = JSON.parse(localStorage.getItem('user')!);
    return `pos-pending-bulk-void:${user.locationId}:${user.id}`;
  });
}
async function createSales(page: Page, quantities: number[]) {
  const auth = await headers(page);
  const shift = await page.request.get('/api/shifts/current', { headers: auth });
  if (!(await shift.json()).data) expect((await page.request.post('/api/shifts/clock-in', { headers: auth, data: { startingCash: 100 } })).status()).toBe(201);
  const products = await page.request.get('/api/products?search=FIXTURE-BULK-VOID', { headers: auth });
  const product = (await products.json()).data[0];
  const sales = [];
  for (const quantity of quantities) {
    const response = await page.request.post('/api/sales', { headers: auth, data: {
      items: [{ productId: product.id, quantity, price: 10, discount: 0 }], paymentMethod: 'CASH', amountPaid: quantity * 11,
    } });
    expect(response.status()).toBe(201); sales.push((await response.json()).data);
  }
  await page.goto('/reports');
  for (const sale of sales) await page.getByRole('checkbox', { name: 'Select sale ' + sale.saleNumber, exact: true }).check();
  return { sales, product };
}

test('bulk void recovery survives a lost response, reload, another user and drawer closure', async ({ page }) => {
  test.setTimeout(60000);
  await login(page, 'bulk-voids@example.test');
  const { sales, product } = await createSales(page, [1, 2]);
  await page.getByRole('button', { name: 'Void Selected', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Void Selected Sales', exact: true });
  await expect(dialog).toContainText('$33.00');
  await expect(dialog.getByRole('button', { name: 'Record Bulk Void', exact: true })).toBeDisabled();
  await dialog.getByLabel('Reason', { exact: true }).fill('Duplicate delivery batch');
  for (const sale of sales) await expect(dialog.getByRole('list', { name: 'Sales to void' })).toContainText(sale.saleNumber);
  await page.screenshot({ path: 'test-results/bulk-void-review-light.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await expect(dialog.getByRole('button', { name: 'Record Bulk Void', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'test-results/bulk-void-review-mobile-dark.png', fullPage: true, animations: 'disabled' });
  let original: unknown;
  await page.route('**/api/sales/bulk-void', async route => {
    original = route.request().postDataJSON();
    const committed = await route.fetch(); expect(committed.status()).toBe(200);
    await route.abort('failed');
  }, { times: 1 });
  await dialog.getByRole('button', { name: 'Record Bulk Void', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Retry the saved batch');
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Refund Selected', exact: true })).toBeDisabled();
  await page.reload(); await page.setViewportSize({ width: 1280, height: 900 });
  const key = await storageKey(page);
  await expect(page.getByRole('button', { name: 'Review saved bulk void', exact: true })).toBeVisible();
  // Recovery must remain available even if the report itself cannot load.
  await page.route('**/api/reports/sales?*', route => route.fulfill({ status: 503, json: { error: 'Report unavailable' } }));
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Report unavailable');
  await expect(page.getByRole('button', { name: 'Review saved bulk void', exact: true })).toBeEnabled();
  await page.unroute('**/api/reports/sales?*');
  await logout(page); await login(page, 'bulk-other@example.test'); await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'All Sales', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review saved bulk void', exact: true })).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).not.toBeNull();
  await logout(page); await login(page, 'bulk-voids@example.test');
  const auth = await headers(page);
  const closed = await page.request.post('/api/shifts/clock-out', { headers: auth, data: { endingCash: 100 } });
  expect(closed.status()).toBe(200);
  await page.goto('/reports'); await page.getByRole('button', { name: 'Review saved bulk void', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Duplicate delivery batch');
  await expect(dialog.getByLabel('Reason', { exact: true })).toHaveCount(0);
  const confirmed = page.waitForResponse(response => response.url().endsWith('/api/sales/bulk-void') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Retry saved bulk void', exact: true }).click();
  const response = await confirmed;
  expect(response.request().postDataJSON()).toEqual(original);
  expect((await response.json()).replayed).toBe(true);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review saved bulk void', exact: true })).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  const finalProduct = await page.request.get('/api/products/' + product.id, { headers: auth });
  expect((await finalProduct.json()).data.stockQuantity).toBe(20);
  const shiftData = (await closed.json()).data;
  expect(shiftData).toMatchObject({ expectedCash: 100, endingCash: 100, cashDifference: 0 });
});

test('unreadable or unwritable recovery storage blocks new bulk voids', async ({ page }) => {
  await login(page, 'bulk-voids@example.test');
  const { sales } = await createSales(page, [1]); const key = await storageKey(page);
  await page.evaluate(key => localStorage.setItem(key, '{broken'), key); await page.reload();
  await expect(page.getByRole('alert')).toContainText('saved bulk void cannot be read');
  await page.getByRole('checkbox', { name: 'Select sale ' + sales[0].saleNumber, exact: true }).check();
  await expect(page.getByRole('button', { name: 'Void Selected', exact: true })).toBeDisabled();
  await page.evaluate(key => localStorage.removeItem(key), key);
  await page.getByRole('button', { name: 'Retry recovery storage', exact: true }).click();
  await page.getByRole('button', { name: 'Void Selected', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Void Selected Sales', exact: true });
  await dialog.getByLabel('Reason', { exact: true }).fill('Storage failure test');
  await page.evaluate(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('pos-pending-bulk-void:')) throw new Error('Storage unavailable');
      write.call(this, key, value);
    };
  });
  let requests = 0;
  page.on('request', request => { if (request.url().endsWith('/api/sales/bulk-void')) requests++; });
  await dialog.getByRole('button', { name: 'Record Bulk Void', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('cannot be saved for recovery');
  expect(requests).toBe(0);
  const sale = await page.request.get('/api/sales/' + sales[0].id, { headers: await headers(page) });
  expect((await sale.json()).data.status).toBe('COMPLETED');
});

test('a definitive rejected batch can be reviewed and corrected without retaining an uncertain request', async ({ page }) => {
  await login(page, 'bulk-voids@example.test');
  await createSales(page, [1]); const key = await storageKey(page);
  await page.getByRole('button', { name: 'Void Selected', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Void Selected Sales', exact: true });
  await dialog.getByLabel('Reason', { exact: true }).fill('Review rejection');
  await page.route('**/api/sales/bulk-void', route => route.fulfill({ status: 409, json: { error: 'Sale amount changed. Reload and review the void.' } }), { times: 1 });
  await dialog.getByRole('button', { name: 'Record Bulk Void', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Sale amount changed');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  await expect(dialog.getByLabel('Reason', { exact: true })).toHaveValue('Review rejection');
  await dialog.getByLabel('Reason', { exact: true }).fill('Reviewed duplicate');
  await dialog.getByRole('button', { name: 'Record Bulk Void', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
