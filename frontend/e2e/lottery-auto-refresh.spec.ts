import { test, expect } from '@playwright/test';
import { login } from './utils/auth-helper';
import { emptyLotteryReport } from '../../backend/src/validators/lotteryV2.validator';

test('lottery reads refresh quietly and preserve unfinished reports across navigation without replaying writes', async ({ page }) => {
  await login(page, 'owner@example.test');
  await page.clock.install();
  const configuration = { mode: 'MANUAL' as const, workflow: 'SIMPLE' as const, cashMode: 'SEPARATE' as const, dispensers: [], barcodeProfile: null, pilotEvidence: 'Fixture' };
  let reads = 0, writes = 0;
  await page.route('**/api/lottery/**', route => {
    const request = route.request();
    if (request.method() !== 'GET') { writes++; return route.fulfill({ status: 503, json: { error: 'Unexpected write' } }); }
    reads++;
    return route.fulfill({ json: { success: true, data: { id: 'fixture-day', configured: true, businessDate: '2026-10-26', status: 'DRAFT', version: 1, configuration, report: emptyLotteryReport(configuration), checkpoints: [], totals: null, canReopen: false } } });
  });
  await page.goto('/lottery?date=2026-10-26&lotteryView=online');
  const sales = page.getByLabel('Gross online sales', { exact: true });
  await expect(sales).toHaveValue('');
  await page.clock.fastForward(30000);
  await expect.poll(() => reads).toBe(2);
  await sales.fill('12.'); await page.getByLabel('Terminal report reference').fill('Unfinished draft');
  await page.clock.fastForward(30000);
  await expect(sales).toHaveValue('12.');
  expect(reads).toBe(2);
  expect(writes).toBe(0);
  await page.goto('/lottery?date=2026-10-26&lotteryView=online');
  await expect(sales).toHaveValue('12.'); await expect(page.getByLabel('Terminal report reference')).toHaveValue('Unfinished draft');
  expect(writes).toBe(0);
});

test('a conflicting report revision preserves the draft and requires a comparison before resubmitting', async ({ page }) => {
  await login(page, 'owner@example.test');
  const configuration = { mode: 'MANUAL' as const, workflow: 'SIMPLE' as const, cashMode: 'SEPARATE' as const, dispensers: [], barcodeProfile: null, pilotEvidence: 'Fixture' };
  const rack = { id: 'one', ticketTypeId: 'one', bin: '1', name: 'Fixture', gameNumber: '284', price: '10', firstTicket: 0, lastTicket: 59, direction: 'ASC' as const, openingNumber: 0, closingNumber: '010' as string | null, finishedRolls: 0, lossQuantity: 0 };
  let version = 1, report = { ...emptyLotteryReport(configuration), rackCounts: [rack] }, writes = 0;
  const current = () => ({ id: 'fixture-conflict', configured: true, businessDate: '2026-10-26', status: 'DRAFT', version, configuration, report, checkpoints: [], totals: null, canReopen: false });
  await page.route('**/api/lottery/**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { success: true, data: current() } });
    writes++;
    if (writes === 1) { version = 2; report = { ...report, reference: 'Changed in another session', onlineGross: '20', rackCounts: [rack, { ...rack, id: 'two', ticketTypeId: 'two', bin: '2', closingNumber: null }] }; return route.fulfill({ status: 409, json: { error: 'This day changed. Review the saved day.' } }); }
    expect(route.request().postDataJSON().expectedVersion).toBe(2); expect(route.request().postDataJSON().report.rackCounts).toHaveLength(2); version = 3; report = route.request().postDataJSON().report;
    return route.fulfill({ json: { success: true, data: current() } });
  });
  await page.goto('/lottery?date=2026-10-26&lotteryView=online'); await page.getByLabel('Gross online sales', { exact: true }).fill('12');
  await page.getByRole('button', { name: 'Save draft', exact: true }).first().click();
  await expect(page.getByLabel('Gross online sales', { exact: true })).toHaveValue('12');
  await page.getByRole('button', { name: 'Review updated report', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review changed report', exact: true });
  await expect(dialog.getByRole('cell', { name: 'Bin 2: closing / new rolls', exact: true })).toBeVisible();
  await expect(dialog.getByRole('cell', { name: '20', exact: true })).toBeVisible(); await expect(dialog.getByRole('cell', { name: '12', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep my reviewed draft', exact: true }).click(); await page.getByRole('button', { name: 'Save draft', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled(); expect(report.onlineGross).toBe('12'); expect(writes).toBe(2);
});
