import { test, expect, Page } from '@playwright/test';
import { login } from './utils/auth-helper';

const auth = async (page: Page) => ({ Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) });

// counts@example.test owns a store no other spec counts in. The count screen is checked at phone width.
test.use({ viewport: { width: 390, height: 844 } });

test('a suggested count starts from the listed items, is counted on a phone, and feeds stock accuracy', async ({ page }) => {
  await login(page, 'counts@example.test');
  const headers = await auth(page), stamp = Date.now();
  const call = async (method: 'get' | 'post', path: string, data?: object) => {
    const response = await page.request[method]('/api' + path, { headers, ...(data ? { data } : {}) });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return (await response.json()).data;
  };
  for (const name of ['Ice 10 lb', 'Energy Drink', 'Long-named Imported Sparkling Mineral Water 750 ml']) {
    const product = await call('post', '/products', { name: `${name} ${stamp}`, sku: `CNT-${name.length}-${stamp}`, price: 4, cost: 2, stockQuantity: 0, lowStockAlert: 5, isTaxable: false, trackInventory: true });
    await call('post', '/financial/inventory-costs/opening', { idempotencyKey: crypto.randomUUID(), notes: 'Counted on the shelf with the supplier invoice',
      items: [{ productId: product.id, quantity: 12, value: 24, expectedVersion: product.stockVersion }] });
  }
  const suggested: { productId: string; name: string; reasons: string[] }[] = await call('get', '/cycle-counts/suggested?limit=8');
  expect(suggested.length).toBeGreaterThan(0);

  await page.goto('/inventory/stock-control/counts');
  const list = page.getByRole('list', { name: 'Suggested items to count' });
  await expect(list.getByRole('listitem')).toHaveCount(suggested.length);
  await expect(list.getByRole('listitem').first()).toContainText(suggested[0].name);
  await expect(list.getByRole('listitem').first()).toContainText(suggested[0].reasons[0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole('button', { name: 'Start Suggested Count' }).click();
  const dialog = page.getByRole('dialog', { name: /Cycle Count CC/ });
  await expect(dialog.getByText(`Items (${suggested.length})`)).toBeVisible();
  const countId = new URL(page.url()).searchParams.get('record');
  const count = await call('get', `/cycle-counts/${countId}`);
  expect(count.items.map((item: { productId: string }) => item.productId).sort()).toEqual(suggested.map(item => item.productId).sort());
  for (const item of count.items) await dialog.getByLabel('Count for ' + item.product.name, { exact: true }).fill(String(item.expectedQty));
  // Nothing in the dialog runs off a phone screen, including the actions.
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(dialog.getByRole('button', { name: 'Submit for Review' })).toBeInViewport();
  await page.screenshot({ path: 'test-results/count-suggestions-phone.png', animations: 'disabled' });

  await dialog.getByRole('button', { name: 'Submit for Review' }).click();
  await page.getByRole('dialog', { name: 'Submit for review?' }).getByRole('button', { name: 'Submit' }).click();
  // Submitting closes the count; the owner reopens it from the list to approve.
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: count.countNumber, exact: true }).click();
  await dialog.getByRole('button', { name: 'Approve & Adjust' }).click();
  await page.getByRole('dialog', { name: 'Approve cycle count?' }).getByRole('button', { name: 'Approve & Adjust' }).click();
  await expect.poll(async () => (await call('get', `/cycle-counts/${countId}`)).status).toBe('APPROVED');

  // Every count matched the record, so the 30-day accuracy includes these items as matches.
  const accuracy = await call('get', '/cycle-counts/accuracy');
  expect(accuracy.counted).toBeGreaterThanOrEqual(suggested.length);
  if (await dialog.count()) await page.keyboard.press('Escape');
  const tile = page.locator('.summary-item').filter({ hasText: 'Stock accuracy (last 30 days)' });
  await expect(tile).toContainText(`${Math.round(accuracy.accuracy * 100)}%`);
  await expect(tile).toContainText(`${accuracy.matched} of ${accuracy.counted} counted items matched the record`);
});
