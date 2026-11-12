import { test, expect, Page } from '@playwright/test';
import { login } from './utils/auth-helper';
import { chooseOption, selectField } from './utils/select-helper';

const auth = async (page: Page) => ({ Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) });

// receive@example.test owns a store no other spec writes credits to.
test('a credit a supplier owes is recorded, then marked received with its credit note', async ({ page }) => {
  await login(page, 'receive@example.test');
  const stamp = Date.now(), supplierName = `Credit Supplier ${stamp}`;
  const created = await page.request.post('/api/suppliers', { headers: await auth(page), data: { name: supplierName } });
  expect(created.ok()).toBe(true);

  await page.goto('/inventory/purchasing/credits');
  await expect(page.getByRole('link', { name: 'Credits Owed' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Record credit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record a credit owed' });
  await dialog.getByLabel('Supplier', { exact: true }).fill(supplierName);
  await dialog.getByRole('button', { name: supplierName }).click();
  await chooseOption(selectField(dialog, 'Why'), 'Short delivery');
  await dialog.getByLabel('Amount owed').fill('18.5');
  await dialog.getByLabel('Notes').fill(`Two cases missing on invoice ${stamp}`);
  await dialog.getByRole('button', { name: 'Record credit' }).click();
  await expect(dialog).toHaveCount(0);

  const owed = page.getByRole('table', { name: 'Credits owed' });
  const row = owed.getByRole('row').filter({ hasText: supplierName });
  await expect(row).toContainText('Short delivery');
  await expect(row).toContainText('$18.50');
  await expect(row).toContainText(`Two cases missing on invoice ${stamp}`);

  await row.getByRole('button', { name: 'Mark received' }).click();
  const settle = page.getByRole('dialog', { name: 'Mark credit received' });
  await expect(settle).toContainText(`${supplierName} · Short delivery · $18.50`);
  await settle.getByLabel('Credit note or reference (optional)').fill(`CN-${stamp}`);
  await settle.getByRole('button', { name: 'Mark received' }).click();
  await expect(owed.getByRole('row').filter({ hasText: supplierName })).toHaveCount(0);

  await page.getByRole('button', { name: 'Settled' }).click();
  const settledRow = page.getByRole('table', { name: 'Settled credits' }).getByRole('row').filter({ hasText: supplierName });
  await expect(settledRow).toContainText('Received');
  await expect(settledRow).toContainText(`CN-${stamp}`);
});
