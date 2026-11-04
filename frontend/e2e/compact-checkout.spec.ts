import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';
import { confirmInApp } from './utils/confirm-helper';

test('photo catalog and text-only cart keep six item rows visible on a laptop', async ({ page }, info) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await login(page, 'owner@example.test');
  const status = page.getByRole('button', { name: 'Register recovery and connection status', exact: true }).filter({ visible: true });
  expect((await status.boundingBox())!.height).toBe(24);
  const store = page.locator('[data-sidebar-store-name]').filter({ visible: true });
  const brand = page.getByText('POS System', { exact: true }).filter({ visible: true });
  expect((await store.boundingBox())!.y - (await brand.boundingBox())!.y).toBeLessThan(36);
  await page.screenshot({ path: info.outputPath('compact-sidebar.png'), animations: 'disabled' });
  const headers = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) };
  for (let index = 1; index <= 6; index++) expect((await page.request.post('/api/products', { headers, data: {
    name: 'Compact item ' + index, sku: 'COMPACT-' + index, price: 1, cost: 0.5, stockQuantity: 10, trackInventory: true, isTaxable: false,
  } })).status()).toBe(201);
  await page.goto('/pos');
  await page.getByPlaceholder('Search products... (/ or F3)', { exact: true }).fill('Compact item');
  for (let index = 1; index <= 6; index++) await page.getByRole('button', { name: new RegExp('^Compact item ' + index + ' \\$') }).click();
  const cart = page.locator('[data-sale-cart]').filter({ visible: true });
  await expect(cart.getByRole('button', { name: 'Recent Transactions', exact: true })).toHaveCount(0);
  await expect(cart.getByText('Link Customer', { exact: true })).toHaveCount(0);
  await expect(cart.locator('img')).toHaveCount(0);
  expect((await cart.boundingBox())!.width).toBeGreaterThanOrEqual(435);
  const heading = (await cart.getByRole('heading', { name: 'Current Sale', exact: true }).boundingBox())!;
  const refund = (await cart.getByTitle('Quick refund', { exact: true }).boundingBox())!;
  expect(refund.x).toBeGreaterThan(heading.x + heading.width); expect(Math.abs(refund.y - heading.y)).toBeLessThan(10);
  await expect.poll(async () => {
    const launcher = (await page.getByRole('button', { name: 'Open POS assistant', exact: true }).boundingBox())!;
    return launcher.x + launcher.width <= (await cart.boundingBox())!.x - 8;
  }).toBe(true);
  for (let index = 1; index <= 6; index++) {
    const quantity = cart.getByRole('button', { name: 'Change quantity for Compact item ' + index, exact: true });
    await expect(quantity).toBeInViewport(); expect((await quantity.boundingBox())!.height).toBeCloseTo(32, 1);
  }
  await page.screenshot({ path: info.outputPath('compact-cart-laptop.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Toggle theme', exact: true }).filter({ visible: true }).click();
  await page.screenshot({ path: info.outputPath('compact-cart-dark.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open sale cart', exact: true }).click();
  const phoneCart = page.locator('[data-sale-cart]').filter({ visible: true });
  expect((await phoneCart.getByTitle('Quick refund', { exact: true }).boundingBox())!.height).toBeCloseTo(44, 1);
  await expect(page.getByRole('dialog', { name: 'Current Sale', exact: true })).toBeVisible();
  await expect(phoneCart.getByRole('button', { name: 'Charge $6.00', exact: true })).toBeInViewport();
  await phoneCart.getByRole('button', { name: 'Actions for Compact item 1', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Item notes', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Current Sale', exact: true })).toBeVisible();
  await expect(phoneCart.getByRole('button', { name: 'Actions for Compact item 1', exact: true })).toBeFocused();
  await page.screenshot({ path: info.outputPath('compact-cart-phone.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open sale cart', exact: true })).toBeFocused();
  await expect(page).toHaveURL(/\/pos$/);
});

test('short receipts print a barcode and Quick Refund supports recent, typed and scanned lookup', async ({ page }, info) => {
  await login(page, 'owner@example.test');
  const headers = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) };
  expect((await page.request.post('/api/products', { headers, data: { name: 'Receipt barcode item', sku: 'RECEIPT-CODE-ITEM', price: 10, cost: 5, stockQuantity: 20, trackInventory: true, isTaxable: true } })).status()).toBe(201);
  await page.goto('/pos');
  await page.getByPlaceholder('Search products... (/ or F3)', { exact: true }).fill('Receipt barcode item');
  await page.getByRole('button', { name: /^Receipt barcode item/ }).click();
  await page.getByRole('button', { name: 'Charge $11.00', exact: true }).click();
  const payment = page.getByRole('dialog', { name: 'Payment', exact: true });
  await payment.getByRole('button', { name: 'Exact', exact: true }).click();
  const saved = page.waitForResponse(response => response.url().endsWith('/api/sales') && response.request().method() === 'POST');
  await payment.getByRole('button', { name: 'Charge $11.00', exact: true }).click();
  const response = await saved; expect(response.status()).toBe(201); const sale = (await response.json()).data;
  expect(sale.saleNumber).toMatch(/^S-\d{6}-\d{6,}$/);
  const receipt = page.getByRole('dialog', { name: 'Receipt', exact: true });
  const barcode = receipt.getByRole('img', { name: 'Receipt barcode ' + sale.saleNumber, exact: true });
  await expect(barcode).toBeVisible(); await expect(barcode).toHaveAttribute('viewBox', /^0 0 \d+ \d+$/);
  await barcode.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('receipt-barcode.png'), animations: 'disabled' });
  const printVersions = await page.evaluate(async booked => {
    const hardwarePath = '/src/services/hardware.ts', receiptPath = '/src/services/receiptFromSale.ts';
    const { hardware } = await import(/* @vite-ignore */ hardwarePath);
    const { receiptFromSale } = await import(/* @vite-ignore */ receiptPath);
    const settings = hardware.getSettings().receiptPrinter;
    const versions = [58, 80].map(paperWidth => {
      hardware.printer.updateSettings({ ...settings, paperWidth });
      return { paperWidth, html: hardware.printer.preview(receiptFromSale(booked)) };
    });
    hardware.printer.updateSettings(settings); return versions;
  }, sale);
  for (const version of printVersions) {
    expect(version.html).toContain('data-receipt-reference="' + sale.saleNumber + '"');
    const printed = await page.context().newPage(); await printed.emulateMedia({ media: 'print' }); await printed.setContent(version.html);
    const paper = await printed.locator('body').boundingBox(), content = await printed.locator('.receipt').boundingBox();
    expect(paper!.width).toBeCloseTo(version.paperWidth * 96 / 25.4, 0);
    expect(content!.x + content!.width).toBeLessThanOrEqual(paper!.x + paper!.width);
    await printed.locator('.receipt').screenshot({ path: info.outputPath('printed-receipt-' + version.paperWidth + '.png') });
    await printed.close();
  }
  await receipt.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByTitle('Quick refund', { exact: true }).click();
  const refund = page.getByRole('dialog', { name: 'Quick Refund', exact: true });
  await expect(refund.getByRole('button').filter({ hasText: '#' + sale.saleNumber })).toBeVisible();
  await page.screenshot({ path: info.outputPath('recent-sales-refund.png'), animations: 'disabled' });
  await refund.getByRole('button').filter({ hasText: '#' + sale.saleNumber }).click();
  await expect(refund.getByRole('button', { name: 'Return more Receipt barcode item', exact: true })).toBeVisible();
  await refund.getByRole('button', { name: 'Choose another sale', exact: true }).click();
  await refund.getByLabel('Receipt number', { exact: true }).fill(sale.saleNumber.split('-').at(-1));
  await refund.getByRole('button', { name: 'Find sale', exact: true }).click();
  await expect(refund.getByRole('button', { name: 'Return more Receipt barcode item', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(refund).toHaveCount(0);
  await page.getByRole('heading', { name: 'Current Sale', exact: true }).click();
  await page.keyboard.type(sale.saleNumber, { delay: 2 }); await page.keyboard.press('Enter');
  await expect(refund).toBeVisible();
  await expect(refund.getByRole('button', { name: 'Return more Receipt barcode item', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('quick-refund-phone.png'), animations: 'disabled' });
  await refund.getByRole('button', { name: 'Return more Receipt barcode item', exact: true }).click();
  const recorded = page.waitForResponse(result => result.url().endsWith('/refund') && result.request().method() === 'POST');
  await refund.getByRole('button', { name: 'Refund $11.00', exact: true }).click();
  await confirmInApp(page, 'Refund $11.00?', 'Refund');
  expect((await recorded).status()).toBe(200); await expect(refund).toHaveCount(0);
});
