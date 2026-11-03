import { test, expect, Page } from '@playwright/test';
import { login, logout } from './utils/auth-helper';

async function checkout(page: Page, sku: string, price = 100) {
  await login(page, 'owner@example.test');
  const headers = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) };
  const response = await page.request.post('/api/products', { headers, data: { name: sku, sku, price, cost: 10, stockQuantity: 3, isTaxable: false, trackInventory: true } });
  expect(response.status()).toBe(201); const product = (await response.json()).data;
  await page.goto('/pos');
  await page.getByPlaceholder('Search products... (/ or F3)', { exact: true }).fill(sku);
  await page.getByRole('button', { name: new RegExp('^' + sku) }).click();
  await page.getByRole('button', { name: 'Charge $' + price.toFixed(2), exact: true }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  return { payment: page.getByRole('dialog', { name: 'Payment', exact: true }), headers, product };
}

test('cash, partial terminal approval, and final cash preserve the unpaid balance through reload and logout', async ({ page }, info) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const { payment, headers, product } = await checkout(page, 'Progressive hundred');
  let saleRequests = 0;
  page.on('request', request => { if (request.url().endsWith('/api/sales') && request.method() === 'POST') saleRequests++; });
  await expect(payment.getByRole('button', { name: /Single Payment|Split Payment/ })).toHaveCount(0);
  await payment.getByRole('spinbutton', { name: 'Amount Tendered' }).fill('20');
  await payment.getByRole('button', { name: 'Charge $20.00', exact: true }).click();
  await expect(payment.getByRole('status', { name: 'Payment balance', exact: true })).toContainText('$80.00 still due');
  expect(saleRequests).toBe(0);
  expect((await (await page.request.get('/api/products/' + product.id, { headers })).json()).data.stockQuantity).toBe(3);
  await payment.getByRole('button', { name: 'Save & close', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Progressive hundred/ })).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: 'Continue payment', exact: true }).click();
  await expect(payment.getByRole('status', { name: 'Payment balance', exact: true })).toContainText('$80.00 still due');
  await payment.getByRole('button', { name: 'Card (external)', exact: true }).click();
  await payment.getByRole('spinbutton', { name: 'Approved amount' }).fill('78.81');
  await payment.getByPlaceholder('Terminal approval / transaction reference').fill('PARTIAL-APPROVED-7881');
  await payment.getByRole('button', { name: 'Save payment $78.81', exact: true }).click();
  await expect(payment.getByRole('status', { name: 'Payment balance', exact: true })).toContainText('$1.19 still due');
  expect(saleRequests).toBe(0);
  await expect(payment.getByText('Verifying final total…', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('remaining-desktop.png'), animations: 'disabled' });
  await payment.getByRole('button', { name: 'Save & close', exact: true }).click();
  await logout(page); await login(page, 'manager@example.test'); await page.goto('/pos');
  await expect(page.getByRole('button', { name: 'Continue payment', exact: true })).toHaveCount(0);
  await expect(page.getByText('PARTIAL-APPROVED-7881', { exact: true })).toHaveCount(0);
  await logout(page); await login(page, 'owner@example.test'); await page.goto('/pos');
  await page.getByRole('button', { name: 'Continue payment', exact: true }).click();
  await expect(payment.getByRole('status', { name: 'Payment balance', exact: true })).toContainText('$1.19 still due');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(payment.getByText('Verifying final total…', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('remaining-phone.png'), animations: 'disabled' });
  await payment.getByRole('button', { name: 'Cash', exact: true }).click();
  await payment.getByRole('button', { name: 'Exact', exact: true }).click();
  const saved = page.waitForResponse(response => response.url().endsWith('/api/sales') && response.request().method() === 'POST');
  await payment.getByRole('button', { name: 'Charge $1.19', exact: true }).click();
  const response = await saved; expect(response.status()).toBe(201); const sale = (await response.json()).data;
  expect(sale.total).toBe(100); expect(sale.amountPaid).toBe(100); expect(sale.changeDue).toBe(0);
  expect(sale.payments.map((p: { amount: number }) => p.amount).sort((a: number, b: number) => a - b)).toEqual([1.19, 20, 78.81]);
  const refreshedHeaders = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) };
  expect((await (await page.request.get('/api/products/' + product.id, { headers: refreshedHeaders })).json()).data.stockQuantity).toBe(2);
  await expect(payment).toHaveCount(0);
  await page.reload(); await expect(page.getByRole('button', { name: 'Continue payment', exact: true })).toHaveCount(0);
});

test('accepted cash needs return confirmation and a card payment needs reversal evidence before removal', async ({ page }) => {
  const { payment } = await checkout(page, 'Progressive reversal');
  await payment.getByRole('spinbutton', { name: 'Amount Tendered' }).fill('20');
  await payment.getByRole('button', { name: 'Charge $20.00', exact: true }).click();
  await expect(payment.getByRole('status', { name: 'Payment balance', exact: true })).toContainText('$80.00 still due');
  page.once('dialog', dialog => dialog.dismiss());
  await payment.getByRole('button', { name: 'Remove payment 1', exact: true }).click();
  await expect(payment.getByRole('status', { name: 'Payment balance', exact: true })).toContainText('$80.00 still due');
  await payment.getByRole('button', { name: 'Card (external)', exact: true }).click();
  await payment.getByRole('spinbutton', { name: 'Approved amount' }).fill('10');
  await payment.getByPlaceholder('Terminal approval / transaction reference').fill('REVERSE-TEN');
  await payment.getByRole('button', { name: 'Save payment $10.00', exact: true }).click();
  await expect(payment.getByRole('status', { name: 'Payment balance', exact: true })).toContainText('$70.00 still due');
  await payment.getByRole('button', { name: 'Remove payment 2', exact: true }).click();
  const reversal = page.getByRole('dialog', { name: 'Reverse terminal payment', exact: true });
  await expect(reversal.getByRole('button', { name: 'Confirm reversal', exact: true })).toBeDisabled();
  await reversal.getByLabel('Terminal reversal reference').fill('VOID-TEN');
  await reversal.getByRole('button', { name: 'Confirm reversal', exact: true }).click();
  await expect(reversal).toHaveCount(0); await expect(payment.getByRole('status', { name: 'Payment balance', exact: true })).toContainText('$80.00 still due');
  page.once('dialog', dialog => dialog.accept());
  await payment.getByRole('button', { name: 'Remove payment 1', exact: true }).click();
  await expect(payment.getByRole('status', { name: 'Payment balance', exact: true })).toContainText('$100.00 still due');
  await payment.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue payment', exact: true })).toHaveCount(0);
  const sessions = await page.evaluate(async () => { const { db } = await import('/src/services/offlineDb.ts'); return db.paymentSessions.toArray(); });
  expect(sessions).toHaveLength(1); expect(sessions[0].status).toBe('CANCELLED');
  expect(sessions[0].events.some((event: { reference?: string }) => event.reference === 'VOID-TEN')).toBe(true);
});

test('an uncertain cash sale keeps its exact submission and cannot collect a second payment', async ({ page }) => {
  const { payment } = await checkout(page, 'Progressive cash recovery', 10);
  let original: unknown, saleId = '';
  await page.route('**/api/sales', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    original = route.request().postDataJSON();
    const saved = await route.fetch(); expect(saved.status()).toBe(201); saleId = (await saved.json()).data.id;
    await route.fulfill({ status: 503, json: { error: 'Response unavailable after commit' } });
  });
  await payment.getByRole('button', { name: 'Charge $10.00', exact: true }).click();
  await expect(payment.getByRole('status', { name: 'Payment balance', exact: true })).toContainText('confirmation pending');
  await expect(payment.getByRole('button', { name: 'Retry saving sale', exact: true })).toBeEnabled();
  await page.reload();
  await page.getByRole('button', { name: 'Continue payment', exact: true }).click();
  await expect(payment.getByRole('button', { name: 'Remove payment 1', exact: true })).toBeDisabled();
  await page.unroute('**/api/sales');
  const retry = page.waitForResponse(response => response.url().endsWith('/api/sales') && response.request().method() === 'POST');
  await payment.getByRole('button', { name: 'Retry saving sale', exact: true }).click();
  const response = await retry; expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual(original); expect((await response.json()).data.id).toBe(saleId);
  await expect(payment).toHaveCount(0);
});

test('another window cannot overwrite a newly accepted payment', async ({ page, context }) => {
  const { payment } = await checkout(page, 'Progressive two windows');
  const other = await context.newPage(); await other.goto('/pos');
  await other.getByRole('button', { name: 'Charge $100.00', exact: true }).click();
  await other.getByRole('button', { name: 'Skip', exact: true }).click();
  const otherPayment = other.getByRole('dialog', { name: 'Payment', exact: true });
  await payment.getByRole('spinbutton', { name: 'Amount Tendered' }).fill('20');
  await payment.getByRole('button', { name: 'Charge $20.00', exact: true }).click();
  await expect(payment.getByRole('status', { name: 'Payment balance', exact: true })).toContainText('$80.00 still due');
  await expect(otherPayment.getByRole('alert')).toContainText('another window');
  await expect(otherPayment.getByRole('button', { name: 'Charge $100.00', exact: true })).toBeDisabled();
  await otherPayment.getByRole('button', { name: 'Cancel', exact: true }).click();
  await other.getByRole('button', { name: 'Continue payment', exact: true }).click();
  await expect(otherPayment.getByRole('status', { name: 'Payment balance', exact: true })).toContainText('$80.00 still due');
  await expect(otherPayment.getByRole('button', { name: 'Remove payment 1', exact: true })).toBeVisible();
});

test('storage failure retains the entered payment and prevents collecting another one until saved', async ({ page }) => {
  const { payment } = await checkout(page, 'Progressive storage');
  await payment.getByRole('spinbutton', { name: 'Amount Tendered' }).fill('20');
  await page.evaluate(async () => {
    const { db } = await import('/src/services/offlineDb.ts');
    (window as any).restorePaymentStorage = db.paymentSessions.put.bind(db.paymentSessions);
    db.paymentSessions.put = async () => { throw new Error('Payment storage temporarily unavailable'); };
  });
  await payment.getByRole('button', { name: 'Charge $20.00', exact: true }).click();
  await expect(payment.getByRole('alert')).toContainText('Keep this screen open');
  await expect(payment.getByRole('spinbutton', { name: 'Amount Tendered' })).toHaveValue('20');
  await expect(payment.getByRole('button', { name: 'Card (external)', exact: true })).toBeDisabled();
  await payment.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(payment).toBeVisible();
  await page.evaluate(async () => {
    const { db } = await import('/src/services/offlineDb.ts'); db.paymentSessions.put = (window as any).restorePaymentStorage;
  });
  await payment.getByRole('button', { name: 'Charge $20.00', exact: true }).click();
  await expect(payment.getByRole('status', { name: 'Payment balance', exact: true })).toContainText('$80.00 still due');
  const clearing = await page.evaluate(async () => {
    const { offlineDb } = await import('/src/services/offlineDb.ts');
    try { await offlineDb.clearAll(); return 'cleared'; } catch (error: any) { return error.message; }
  });
  expect(clearing).toContain('Unconfirmed payments');
});

test('a rejected account allocation can be replaced without forgetting received cash', async ({ page }) => {
  const { payment } = await checkout(page, 'Progressive rejected gift');
  await page.evaluate(async () => {
    const { useStoreSettingsStore } = await import('/src/store/storeSettingsStore.ts');
    const settings = useStoreSettingsStore.getState();
    await settings.savePaymentMethods({ ...settings.paymentMethods, giftCard: true });
  });
  try {
    await payment.getByRole('spinbutton', { name: 'Amount Tendered' }).fill('20');
    await payment.getByRole('button', { name: 'Charge $20.00', exact: true }).click();
    await expect(payment.getByRole('status', { name: 'Payment balance', exact: true })).toContainText('$80.00 still due');
    await payment.getByRole('button', { name: 'Gift Card', exact: true }).click();
    await payment.getByPlaceholder('Gift card number', { exact: true }).fill('MISSING-GIFT-CARD');
    await payment.getByRole('button', { name: 'Charge $80.00', exact: true }).click();
    await expect(payment.getByRole('button', { name: 'Remove payment 2', exact: true })).toBeEnabled();
    await payment.getByRole('button', { name: 'Remove payment 2', exact: true }).click();
    await expect(payment.getByRole('status', { name: 'Payment balance', exact: true })).toContainText('$80.00 still due');
    await expect(payment.getByText('CASH · $20.00', { exact: true })).toBeVisible();
    await payment.getByRole('button', { name: 'Cash', exact: true }).click();
    const saved = page.waitForResponse(response => response.url().endsWith('/api/sales') && response.request().method() === 'POST' && response.status() === 201);
    await payment.getByRole('button', { name: 'Charge $80.00', exact: true }).click();
    const sale = (await (await saved).json()).data;
    expect(sale.total).toBe(100); expect(sale.payments.map((p: { amount: number }) => p.amount).sort((a: number, b: number) => a - b)).toEqual([20, 80]);
  } finally {
    await page.evaluate(async () => {
      const { useStoreSettingsStore } = await import('/src/store/storeSettingsStore.ts');
      const settings = useStoreSettingsStore.getState(); await settings.savePaymentMethods({ ...settings.paymentMethods, giftCard: false });
    });
  }
});
