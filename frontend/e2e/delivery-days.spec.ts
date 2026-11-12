import { test, expect, Page } from '@playwright/test';
import { login } from './utils/auth-helper';

const auth = async (page: Page) => ({ Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) });
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// reorder@example.test owns a store no other spec orders in.
test('delivery days set on a supplier plan its reorder to the delivery after next', async ({ page }) => {
  await login(page, 'reorder@example.test');
  const headers = await auth(page), stamp = Date.now();
  const call = async (method: 'get' | 'post', path: string, data?: object) => {
    const response = await page.request[method]('/api' + path, { headers, ...(data ? { data } : {}) });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return (await response.json()).data;
  };
  const supplierName = `Tuesday Friday Drinks ${stamp}`;
  const supplier = await call('post', '/suppliers', { name: supplierName, leadTimeDays: 1 });
  const product = await call('post', '/products', { name: `Reorder Cola ${stamp}`, sku: `RO-${stamp}`, price: 2, cost: 1, stockQuantity: 0, lowStockAlert: 5, isTaxable: false, trackInventory: true });
  await call('post', '/financial/inventory-costs/opening', { idempotencyKey: crypto.randomUUID(), notes: 'Counted on the shelf with the supplier invoice',
    items: [{ productId: product.id, quantity: 1, value: 1, expectedVersion: product.stockVersion }] });
  await call('post', `/suppliers/${supplier.id}/products`, { productId: product.id, cost: 1 });

  // Without delivery days the supplier is planned for two weeks.
  await page.goto(`/inventory/purchasing/suggestions?supplier=${supplier.id}`);
  await expect(page.getByText(`Showing ${supplierName} only.`)).toBeVisible();
  await expect(page.getByText('No delivery days set: planned for 14 days.')).toBeVisible();

  // Set Tuesday and Friday on the supplier form.
  await page.goto('/inventory/purchasing/suppliers');
  await page.getByPlaceholder('Search suppliers...').fill(supplierName);
  await page.getByRole('button', { name: `Edit supplier ${supplierName}` }).click();
  const form = page.getByRole('dialog', { name: 'Edit Supplier' });
  const days = form.getByRole('group', { name: 'Delivery days' });
  await days.getByRole('button', { name: 'Tuesday' }).click();
  await days.getByRole('button', { name: 'Friday' }).click();
  await expect(days.getByRole('button', { name: 'Tuesday' })).toHaveAttribute('aria-pressed', 'true');
  await form.getByRole('button', { name: 'Update Supplier' }).click();
  await expect(form).toHaveCount(0);
  expect((await call('get', `/suppliers/${supplier.id}`)).deliveryDays).toEqual([2, 5]);

  const plan = await call('get', '/purchase-orders/suggested');
  const group = plan.suppliers.find((row: { supplierId: string }) => row.supplierId === supplier.id);
  expect(group.basis).toBe('DELIVERY_DAYS');
  const label = (date: string) => WEEKDAY[new Date(date + 'T12:00:00Z').getUTCDay()];
  expect(['Tue', 'Fri']).toContain(label(group.nextDelivery));

  await page.goto(`/inventory/purchasing/suggestions?supplier=${supplier.id}`);
  await expect(page.getByText(`Delivers Tue, Fri. Ordered today it arrives ${label(group.nextDelivery)},`)).toBeVisible();
  await expect(page.getByText(`lasts until the next delivery, ${label(group.followingDelivery)},`)).toBeVisible();
  await page.getByRole('button', { name: 'Show all suppliers' }).click();
  await expect(page).not.toHaveURL(/supplier=/);
});
