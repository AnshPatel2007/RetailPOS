import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { emptyLotteryReport, LotteryReport, LotterySettings } from '../../validators/lotteryV2.validator';
import { getFinancialMetrics } from '../../services/financialMetrics.service';
import { lotteryDayTotals, parseLotteryBarcode, ticketPosition, verifyBarcodeProfile } from '../../services/lotteryMath.service';
import { reportCalendar } from '../../services/reportDates.service';

const settings: LotterySettings = { mode: 'MANUAL', cashMode: 'SEPARATE', dispensers: [], pilotEvidence: 'Isolated test fixture, not live verification',
  barcodeProfile: { gameDigits: 4, bookDigits: 6, ticketDigits: 3, prefixDigits: 0, suffixDigits: 0, evidence: 'Synthetic adjacent test codes',
    samples: [{ raw: '0001000001010', game: '0001', book: '000001', ticket: '010' }, { raw: '0001000001011', game: '0001', book: '000001', ticket: '011' }] } };
const completeReport = (config = settings, overrides: Partial<LotteryReport> = {}): LotteryReport => ({ ...emptyLotteryReport(config), reference: randomUUID(),
  onlineGross: '0', onlineCancels: '0', drawPayouts: '0', fastPlayPayouts: '0', scratchPayouts: '0', onlinePromotions: '0', scratchPromotions: '0', onlineNoncash: '0', scratchNoncash: '0',
  onlineCommission: '0', scratchCommission: '0', cashingBonus: '0', sellingBonus: '0', fees: '0', collectionAdjustment: '0', earningsAdjustment: '0',
  exceptionReason: 'Test report cash reviewed separately', ...overrides });

describe('Illinois lottery books, daily records and earnings', () => {
  let data: TestData, token: string, cashier: string, platform: string, game: any;
  const get = (path: string, auth = token) => request(app).get('/api/lottery/v2' + path).set('Authorization', 'Bearer ' + auth);
  const post = (path: string, input: object, auth = token) => request(app).post('/api/lottery/v2' + path).set('Authorization', 'Bearer ' + auth).send(input);
  const day = async (date = '2026-01-01') => (await get('/days/' + date).expect(200)).body.data;
  const mutate = async (action: string, input: object = {}, date = '2026-01-01', auth = token) => post(`/days/${date}/${action}`, { idempotencyKey: randomUUID(), expectedVersion: (await day(date)).version, ...input }, auth);
  const book = async (bookNumber = '000001', nextTicket = 0, direction = 'ASC', slot = bookNumber, date = '2026-01-01') => {
    const response = await mutate('books', { book: { ticketTypeId: game.id, bookNumber, slot, direction, nextTicket, evidence: 'Verified starting position on count sheet' } }, date);
    expect(response.status).toBe(200); return response.body.data.checkpoints.find((row: any) => row.book.bookNumber === bookNumber);
  };
  const close = async (date = '2026-01-01', report = completeReport()) => {
    expect((await mutate('report', { report }, date)).status).toBe(200);
    const response = await mutate('close', {}, date); expect(response.status).toBe(200); return response.body.data;
  };
  beforeEach(async () => {
    data = await seedTestData();
    await prisma.location.update({ where: { id: data.location.id }, data: { timezone: 'America/Chicago' } });
    token = await createTestToken(data.adminUser.id, 'ADMIN'); cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    const user = await prisma.user.create({ data: { email: 'platform@lottery.test', password: 'unused', firstName: 'Platform', lastName: 'Test', role: 'SUPER_ADMIN' } });
    platform = await createTestToken(user.id, 'SUPER_ADMIN');
    await prisma.lotteryConfiguration.create({ data: { locationId: data.location.id, userId: user.id, effectiveDate: '2026-01-01', settings: JSON.parse(JSON.stringify(settings)) } });
    game = (await post('/games', { idempotencyKey: randomUUID(), game: { ticketName: 'Test Illinois game', ticketCode: 'IL-1', gameNumber: '0001', pricePerTicket: '10', firstTicket: 0, lastTicket: 59, isActive: true } }).expect(200)).body.data;
  });

  it('uses simple rack counts, carries openings, supports multiple new rolls and preserves daily prices', async () => {
    await prisma.lotteryTicketType.update({ where: { id: game.id }, data: { binNumber: '12', startingNumber: 55 } });
    const opened = (await mutate('entry')).body.data;
    expect(opened.configuration.workflow).toBe('SIMPLE');
    const row = opened.report.rackCounts[0];
    expect(row).toMatchObject({ bin: '12', openingNumber: 55, closingNumber: null, finishedRolls: 0 });
    expect((await mutate('report', { report: { ...opened.report, rackCounts: [{ ...row, openingNumber: 0, closingNumber: '003', finishedRolls: 2 }] } })).status).toBe(409);
    expect((await mutate('report', { report: { ...opened.report, rackCounts: [{ ...row, closingNumber: '003' }] } })).status).toBe(400);
    const report = completeReport(settings, { ...opened.report, onlineGross: '0', onlineCancels: '0', drawPayouts: '0', fastPlayPayouts: '0', scratchPayouts: '0', rackCounts: [{ ...row, closingNumber: '003', finishedRolls: 2 }] });
    const payload = { idempotencyKey: randomUUID(), expectedVersion: opened.version, report };
    await post('/days/2026-01-01/report', payload).expect(200); await post('/days/2026-01-01/report', payload).expect(200);
    const closed = (await mutate('close')).body.data;
    expect(closed).toMatchObject({ status: 'CLOSED', totals: { manualTickets: 68, scratchSales: '680.00', earnings: null } });
    expect(await getFinancialMetrics({ locationId: data.location.id })).toMatchObject({ netProfit: null });
    await prisma.lotteryTicketType.update({ where: { id: game.id }, data: { pricePerTicket: 12, startingNumber: 20 } });
    const next = (await mutate('entry', {}, '2026-01-02')).body.data;
    expect(next.report.rackCounts[0]).toMatchObject({ openingNumber: 3, price: '12.00', closingNumber: null, finishedRolls: 0 });
    expect((await day()).totals.scratchSales).toBe('680.00');
    const stale = await post('/days/2026-01-02/report', { idempotencyKey: randomUUID(), expectedVersion: 0, report: next.report });
    expect(stale.status).toBe(409);
    expect((await mutate('close', {}, '2026-01-02', cashier)).status).toBe(403);
  });

  it('keeps descending final-ticket counts and adds a newly configured bin to an open entry', async () => {
    await prisma.lotteryTicketType.update({ where: { id: game.id }, data: { binNumber: '2', startingNumber: 59, countDirection: 'DESC' } });
    const opened = (await mutate('entry')).body.data;
    const row = opened.report.rackCounts[0];
    await mutate('report', { report: { ...opened.report, rackCounts: [{ ...row, closingNumber: '050' }] } });
    expect((await day()).totals.manualTickets).toBe(9);
    const current = await day();
    await mutate('report', { report: { ...current.report, rackCounts: [{ ...row, closingNumber: '-1' }] } });
    expect((await day()).totals.manualTickets).toBe(60);
    await post('/games', { idempotencyKey: randomUUID(), game: { ticketName: 'Second bin', ticketCode: 'TWO', gameNumber: '284', pricePerTicket: '5', firstTicket: 0, lastTicket: 99, binNumber: '10', startingNumber: 15, countDirection: 'ASC', isActive: true } }).expect(200);
    expect((await day()).report.rackCounts).toEqual(expect.arrayContaining([expect.objectContaining({ closingNumber: '-1' }), expect.objectContaining({ bin: '10', openingNumber: 15 })]));
  });

  it('lets only platform administrators choose rack or machine without verification fields', async () => {
    const config = await prisma.lotteryConfiguration.findFirstOrThrow();
    const input = { idempotencyKey: randomUUID(), previousId: config.id, mode: 'DISPENSER' };
    await post('/equipment/' + data.location.id, input, token).expect(403);
    await post('/equipment/' + data.location.id, input, cashier).expect(403);
    const result = (await post('/equipment/' + data.location.id, input, platform).expect(200)).body.data;
    expect(result.settings).toMatchObject({ mode: 'DISPENSER', workflow: 'SIMPLE', pilotEvidence: '' });
    expect(await prisma.lotteryDay.count()).toBe(0);
    expect(await prisma.lotteryEarningPosting.count()).toBe(0);
  });

  it('counts next-unsold ascending and descending tickets, preserves zeros and replaces repeated scans', async () => {
    const ascending = await book('000001', 10), descending = await book('000002', 59, 'DESC');
    expect(parseLotteryBarcode('0001-000001-025', settings.barcodeProfile)).toMatchObject({ game: '0001', book: '000001', ticket: '025' });
    expect((await mutate('checkpoint', { bookId: ascending.bookId, raw: '0001000001025' }, undefined, cashier)).status).toBe(200);
    expect((await mutate('checkpoint', { bookId: ascending.bookId, raw: '0001000001025' })).status).toBe(200);
    expect((await mutate('checkpoint', { bookId: descending.bookId, raw: '0001000002050' })).status).toBe(200);
    expect((await day()).totals).toMatchObject({ manualTickets: 24, manualSales: '240.00' });
    expect((await mutate('checkpoint', { bookId: ascending.bookId, raw: '0001000002025' })).status).toBe(400);
    expect((await mutate('checkpoint', { bookId: ascending.bookId, nextTicket: 9 })).status).toBe(400);
    expect((await mutate('checkpoint', { bookId: ascending.bookId, nextTicket: 60 })).status).toBe(400);
    expect((await day()).totals.manualTickets).toBe(24);
  });

  it('links stage readiness to missing counts and fields without making unknown earnings zero', async () => {
    const row = await book('000001', 10, 'ASC', '12');
    let current = await day();
    expect(current.readiness.books).toEqual({ counted: 0, total: 1 });
    expect(current.readiness.issues).toContainEqual(expect.objectContaining({ stage: 'scratch', bookId: row.bookId, message: 'Count Bin 12', blocking: true }));
    expect(current.readiness.issues).toContainEqual(expect.objectContaining({ stage: 'online', field: 'scratchPayouts', blocking: true }));
    await mutate('checkpoint', { bookId: row.bookId, nextTicket: 12 });
    await mutate('report', { report: completeReport(settings, { onlineCommission: null, scratchCommission: null }) });
    current = await day();
    expect(current.readiness.books).toEqual({ counted: 1, total: 1 });
    expect(current.readiness.stages.scratch.complete).toBe(true);
    expect(current.readiness.stages.online.complete).toBe(true);
    expect(current.readiness.canClose).toBe(true); // Cash exception was explicitly explained.
    expect(current.readiness.issues).toContainEqual(expect.objectContaining({ field: 'onlineCommission', blocking: false }));
    expect(current.totals.earnings).toBeNull();
    await mutate('report', { report: completeReport(settings, { exceptionReason: '' }) });
    expect((await day()).readiness.canClose).toBe(false);
    await get('/days/2026-01-01/history', cashier).expect(403);
    const history = (await get('/days/2026-01-01/history').expect(200)).body.data;
    expect(history.events.some((event: any) => event.action === 'CHECKPOINT')).toBe(true);
    await get('/days/2026-01-01/history?locationId=another-store').expect(403);
  });

  it('exposes scoped book details and filters without changing book balances', async () => {
    const row = await book('000001', 10, 'ASC', '12');
    await mutate('checkpoint', { bookId: row.bookId, nextTicket: 15 });
    const details = (await get('/books/' + row.bookId).expect(200)).body.data;
    expect(details.book.position).toBe(10); // Draft counting is distinct from the confirmed balance.
    expect(details.counts[0]).toMatchObject({ businessDate: '2026-01-01', dayStatus: 'DRAFT', openingTicket: '010', closingTicket: '015' });
    expect((await get('/books?search=000001&status=ACTIVE').expect(200)).body.data.pagination.total).toBe(1);
    expect((await get('/books?search=missing').expect(200)).body.data.records).toEqual([]);
    await get('/books/' + row.bookId, cashier).expect(403);
    await get('/books/' + row.bookId + '?locationId=another-store').expect(403);
    await get('/books/not-a-book').expect(404);
  });

  it('handles a final ticket and multiple replacements without inventing prior sales', async () => {
    game = await prisma.lotteryTicketType.update({ where: { id: game.id }, data: { lastTicket: 9 } });
    const first = await book('000001', 5, 'ASC', 'A1');
    expect((await mutate('books', { depletedBookId: first.bookId, book: { ticketTypeId: game.id, bookNumber: '000002', slot: 'A1', direction: 'ASC', nextTicket: 0, evidence: 'New book opened at first ticket' } })).status).toBe(200);
    const second = (await day()).checkpoints.find((row: any) => row.book.bookNumber === '000002');
    expect((await mutate('checkpoint', { bookId: second.bookId, nextTicket: 3 })).status).toBe(200);
    expect((await day()).totals.manualTickets).toBe(8);
    expect((await mutate('books', { depletedBookId: second.bookId, book: { ticketTypeId: game.id, bookNumber: '000003', slot: 'A1', direction: 'ASC', nextTicket: 0, evidence: 'Second replacement checked' } })).status).toBe(200);
    const third = (await day()).checkpoints.find((row: any) => row.book.bookNumber === '000003');
    await mutate('checkpoint', { bookId: third.bookId, nextTicket: 9 });
    expect((await day()).totals.manualTickets).toBe(24);
    await mutate('checkpoint', { bookId: third.bookId, soldOut: true });
    expect((await day()).totals.manualTickets).toBe(25);
    expect((await close()).totals.scratchSales).toBe('250.00');
    expect(await prisma.lotteryBook.count({ where: { status: 'DEPLETED' } })).toBe(3);
  });

  it('keeps unchanged books at zero, excludes losses, and carries paused books without selling their remainder', async () => {
    const first = await book('000001', 10), second = await book('000002', 5);
    await mutate('checkpoint', { bookId: first.bookId, nextTicket: 15, lossQuantity: 2, reason: 'Two tickets damaged', disposition: 'PAUSED' });
    await mutate('checkpoint', { bookId: second.bookId, nextTicket: 5, disposition: 'RETURNED', reason: 'Partial book returned to Illinois' });
    expect((await close()).totals).toMatchObject({ manualTickets: 3, scratchSales: '30.00' });
    await mutate('open', {}, '2026-01-02');
    const next = await day('2026-01-02');
    expect(next.checkpoints).toHaveLength(1);
    expect(next.checkpoints[0]).toMatchObject({ openingPosition: 15, closingPosition: 15, openingVerified: true, disposition: 'PAUSED' });
    expect((await close('2026-01-02')).totals.manualTickets).toBe(0);
  });

  it('serializes competing revisions and replays the exact committed retry without duplicate effects', async () => {
    const row = await book(); const current = await day();
    const input = { expectedVersion: current.version, idempotencyKey: randomUUID(), bookId: row.bookId, nextTicket: 3 };
    const [a, b] = await Promise.all([post('/days/2026-01-01/checkpoint', input), post('/days/2026-01-01/checkpoint', { ...input, idempotencyKey: randomUUID(), nextTicket: 4 })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? input : null;
    if (winner) {
      const replay = await post('/days/2026-01-01/checkpoint', winner).expect(200); expect(replay.body.data.version).toBe(a.body.data.version);
      await post('/days/2026-01-01/checkpoint', { ...winner, nextTicket: 5 }).expect(409);
    }
    expect(await prisma.lotteryAuditEvent.count({ where: { action: 'CHECKPOINT' } })).toBe(1);
    expect(await prisma.operationReceipt.count({ where: { kind: 'LOTTERY_CHECKPOINT' } })).toBe(1);
  });

  it('keeps game edits from changing a physical book snapshot and enforces store and role permissions', async () => {
    const row = await book();
    await post('/games', { idempotencyKey: randomUUID(), id: game.id, expectedUpdatedAt: game.updatedAt, game: { ticketName: 'Changed name', ticketCode: 'IL-1', gameNumber: '0001', pricePerTicket: '50', firstTicket: 0, lastTicket: 29, isActive: true } }).expect(200);
    await mutate('checkpoint', { bookId: row.bookId, nextTicket: 2 });
    expect((await day()).totals.manualSales).toBe('20.00');
    expect((await mutate('books', { book: { ticketTypeId: game.id, bookNumber: '000002', slot: 'B', direction: 'ASC', nextTicket: 0, evidence: 'Reviewed' } }, undefined, cashier)).status).toBe(403);
    expect((await mutate('close', {}, undefined, cashier)).status).toBe(403);
    expect((await mutate('checkpoint', { bookId: row.bookId, nextTicket: 3, lossQuantity: 1, reason: 'Unauthorized loss' }, undefined, cashier)).status).toBe(403);
    await get('/days/2026-01-01?locationId=another-store').expect(403);
    await post('/days/2026-01-01/open?locationId=' + data.location.id, { expectedVersion: 0, idempotencyKey: randomUUID() }, platform).expect(403);
    await get('/reports?start=2026-01-01&end=2026-01-31', cashier).expect(403);
    await request(app).post('/api/lottery/scan').set('Authorization', 'Bearer ' + token).send({ barcode: '0001000001001' }).expect(410);
    await expect(prisma.lotteryAuditEvent.updateMany({ data: { action: 'TAMPER' } })).rejects.toThrow();
  });

  it('uses machine totals without inventing counts, allows negative collections, and posts only earnings', async () => {
    const machine: LotterySettings = { ...settings, mode: 'DISPENSER', dispensers: [{ id: 'machine', name: 'Cashier machine' }] };
    await prisma.lotteryConfiguration.updateMany({ data: { settings: JSON.parse(JSON.stringify(machine)) } });
    const report = completeReport(machine, { onlineGross: '100', onlineCancels: '10', scratchPayouts: '400', onlineCommission: '4.50', scratchCommission: '10', fees: '1',
      dispensers: [{ sourceId: 'machine', reference: 'M-20260101', grossSales: '200', cancellations: '0', games: [] }],
      openingCash: '500', countedCash: '390', cashAdded: '0', cashRemoved: '0', exceptionReason: '' });
    const result = await close(undefined, report);
    expect(result.totals).toMatchObject({ scratchSales: '200.00', onlineSales: '90.00', netCollections: '-110.00', expectedCash: '390.00', cashVariance: '0.00', earnings: '13.50', totalScratchTickets: null });
    expect(await getFinancialMetrics({ locationId: data.location.id })).toMatchObject({ netSales: 0, costOfGoodsSold: 0, otherIncome: 13.5, netProfit: 13.5 });
    const pnl = (await request(app).get('/api/financial/reports/pnl?startDate=2026-01-01&endDate=2026-01-31&workbook=true').set('Authorization', 'Bearer ' + token).expect(200)).body.data;
    expect(pnl).toMatchObject({ lotteryEarnings: 13.5, netIncome: 13.5 });
    expect(pnl.workbook.months[0].income).toContainEqual({ kind: 'LOTTERY_EARNINGS', amount: 13.5 });
    expect(pnl.workbook.months[0].days[0]).toMatchObject({ date: '2026-01-01', sales: 0, lotteryNet: -110 });
    expect((await prisma.lotteryDay.findFirstOrThrow()).recognizedAt.toISOString()).toBe('2026-01-01T06:00:00.000Z');
  });

  it('keeps unknown commissions pending and reconciles settlement deltas exactly once', async () => {
    const row = await book(); await mutate('checkpoint', { bookId: row.bookId, nextTicket: 1 });
    await close(undefined, completeReport(settings, { scratchCommission: null, onlineCommission: '2' }));
    expect(await day()).toMatchObject({ earningsPending: true, earningsSettlement: null, totals: { earnings: null } });
    expect(await getFinancialMetrics({ locationId: data.location.id })).toMatchObject({ otherIncome: 2, netProfit: null, earningsCompleteness: { complete: false } });
    const settlement = { periodStart: '2026-01-01', periodEnd: '2026-01-07', reference: 'WEEK-1', onlineCommission: '2', scratchCommission: '3', cashingBonus: '0', sellingBonus: '0', fees: '0', earningsAdjustment: '0',
      settledBookValue: '600', returnedBookValue: '0', lotteryAdjustments: '0', netDue: '595', bankSweep: '595', settledBookIds: [row.bookId], reason: 'Compared the complete weekly statement' };
    const payload = { expectedVersion: 0, idempotencyKey: randomUUID(), settlement };
    const result = (await post('/settlements', payload).expect(200)).body.data; expect(result.adjustment).toBe('3.00');
    expect(await day()).toMatchObject({ earningsPending: false, canReopen: false, earningsSettlement: { id: result.id, reference: 'WEEK-1' }, totals: { earnings: null } });
    await post('/settlements', payload).expect(200);
    expect(await getFinancialMetrics({ locationId: data.location.id })).toMatchObject({ otherIncome: 5, netProfit: 5, earningsCompleteness: { complete: true } });
    const correction = (await post('/settlements', { expectedVersion: 1, idempotencyKey: randomUUID(), settlement: { ...settlement, scratchCommission: '4', reason: 'Corrected commission statement' } }).expect(200)).body.data;
    expect(correction.adjustment).toBe('1.00');
    expect(await getFinancialMetrics({ locationId: data.location.id })).toMatchObject({ otherIncome: 6 });
    expect((await mutate('open', {}, '2026-01-02')).status).toBe(409);
    expect((await prisma.lotteryBook.findUniqueOrThrow({ where: { id: row.bookId } })).status).toBe('ACTIVE');
    await expect(prisma.lotteryEarningPosting.updateMany({ data: { amount: 999 } })).rejects.toThrow();
  });

  it('reopens only the latest unsettled day and records earlier corrections without rewriting checkpoints', async () => {
    const row = await book(); await mutate('checkpoint', { bookId: row.bookId, nextTicket: 2 });
    await close(undefined, completeReport(settings, { scratchCommission: '1' }));
    expect((await mutate('reopen', { reason: 'Count reviewed' })).status).toBe(200);
    expect(await getFinancialMetrics({ locationId: data.location.id })).toMatchObject({ otherIncome: 0 });
    expect((await prisma.lotteryBook.findUniqueOrThrow({ where: { id: row.bookId } })).position).toBe(0);
    await close(); await mutate('open', {}, '2026-01-02');
    expect((await day('2026-01-02')).checkpoints[0]).toMatchObject({ openingPosition: 2, openingVerified: true });
    expect((await mutate('reopen', { reason: 'Earlier count' })).status).toBe(409);
    const correction = { scratchSales: '-10', onlineSales: '0', payouts: '0', netCollections: '-10', netCash: '-10', earnings: '0', tickets: -1, reason: 'One prior ticket was missing, not sold', reference: 'COUNT-REVIEW' };
    expect((await mutate('correction', { correction })).status).toBe(200);
    expect((await day('2026-01-02')).checkpoints[0].openingPosition).toBe(2);
    const report = (await get('/reports?start=2026-01-01&end=2026-12-31').expect(200)).body.data;
    expect(report.corrections[0].details).toMatchObject({ businessDate: '2026-01-01', tickets: -1 });
  });

  it('requires owner review of a changed opening after a tracking gap', async () => {
    const row = await book(); await mutate('checkpoint', { bookId: row.bookId, nextTicket: 2 }); await close();
    await mutate('open', {}, '2026-01-03');
    expect((await day('2026-01-03')).checkpoints[0].openingVerified).toBe(false);
    expect((await mutate('checkpoint', { bookId: row.bookId, nextTicket: 5, opening: true }, '2026-01-03')).status).toBe(409);
    expect((await mutate('checkpoint', { bookId: row.bookId, nextTicket: 5, opening: true, resetOpening: true, reason: 'Reviewed after untracked day' }, '2026-01-03', cashier)).status).toBe(403);
    expect((await mutate('checkpoint', { bookId: row.bookId, nextTicket: 5, opening: true, resetOpening: true, reason: 'Reviewed after untracked day' }, '2026-01-03')).status).toBe(200);
    await mutate('checkpoint', { bookId: row.bookId, nextTicket: 5 }, '2026-01-03');
    expect((await day('2026-01-03')).totals.manualTickets).toBe(0);
  });

  it('rejects duplicate report references, missing sources, invalid formats and premature closing', async () => {
    const row = await book();
    expect((await mutate('close')).status).toBe(400);
    await mutate('checkpoint', { bookId: row.bookId, nextTicket: 0 });
    const report = completeReport(); await close(undefined, report);
    await mutate('open', {}, '2026-01-02'); await mutate('checkpoint', { bookId: row.bookId, nextTicket: 0 }, '2026-01-02');
    await mutate('report', { report }, '2026-01-02'); expect((await mutate('close', {}, '2026-01-02')).status).toBe(409);
    expect(() => parseLotteryBarcode('059', settings.barcodeProfile)).toThrow(); expect(() => parseLotteryBarcode('0001000001059', null)).toThrow();
    expect(() => verifyBarcodeProfile({ ...settings.barcodeProfile!, samples: [settings.barcodeProfile!.samples[0], { ...settings.barcodeProfile!.samples[1], ticket: '012' }] })).toThrow();
    expect(() => lotteryDayTotals({ ...settings, mode: 'BOTH', dispensers: [{ id: 'm', name: 'Machine' }] }, report, [])).toThrow();
    expect(() => ticketPosition({ firstTicket: 0, lastTicket: 59, ticketCount: 60, direction: 'DESC' }, 60)).toThrow();
  });

  it('combines distinct manual and dispenser sales once and reconciles shared cash with promotions and noncash', async () => {
    const mixed: LotterySettings = { ...settings, mode: 'BOTH', cashMode: 'SHARED', dispensers: [{ id: 'm', name: 'Machine' }] };
    await prisma.lotteryConfiguration.updateMany({ data: { settings: JSON.parse(JSON.stringify(mixed)) } });
    const row = await book(); await mutate('checkpoint', { bookId: row.bookId, nextTicket: 2 });
    const report = completeReport(mixed, { onlineGross: '50', onlineCancels: '5', onlinePromotions: '5', scratchNoncash: '10', drawPayouts: '20', scratchPayouts: '30', collectionAdjustment: '-2', adjustmentReason: 'Documented cash adjustment',
      dispensers: [{ sourceId: 'm', reference: 'M-DAY-1', grossSales: '100', cancellations: '0', games: [{ gameNumber: '0001', amount: '100', quantity: 10 }] }],
      openingCash: '100', countedCash: '408', cashAdded: '10', cashRemoved: '50', nonLotteryNetCash: '250', exceptionReason: '' });
    expect((await close(undefined, report)).totals).toMatchObject({ totalScratchTickets: 12, scratchSales: '120.00', onlineSales: '45.00', payouts: '50.00', netCollections: '110.00', netCash: '98.00', expectedCash: '408.00', cashVariance: '0.00' });
    expect(await getFinancialMetrics({ locationId: 'unrelated-store' })).toMatchObject({ lotteryEarnings: 0, otherIncome: 0 });
  });

  it('gates configuration to platform review, rejects unverified codes, and snapshots settings by business date', async () => {
    const calendar = reportCalendar('America/Chicago');
    const date = `${calendar.year}-${String(calendar.month).padStart(2, '0')}-${String(calendar.dayOfMonth).padStart(2, '0')}`;
    const latest = (await get('/configuration').expect(200)).body.data.latestId;
    const payload = { idempotencyKey: randomUUID(), previousId: latest, effectiveDate: date, settings: { ...settings, mode: 'DISPENSER', dispensers: [{ id: 'm', name: 'Cashier dispenser' }] } };
    await post('/configuration', payload).expect(403);
    await post('/configuration/' + data.location.id, { ...payload, settings: { ...payload.settings, barcodeProfile: { ...settings.barcodeProfile!, samples: [{ ...settings.barcodeProfile!.samples[0], game: '9999' }, settings.barcodeProfile!.samples[1]] } } }, platform).expect(400);
    await post('/configuration/' + data.location.id, payload, platform).expect(200);
    expect((await day('2026-01-01')).configuration.mode).toBe('MANUAL'); expect((await day(date)).configuration.mode).toBe('DISPENSER');
    await mutate('open', {}, date);
    const config = (await get('/configuration').expect(200)).body.data.latestId;
    await post('/configuration/' + data.location.id, { ...payload, idempotencyKey: randomUUID(), previousId: config }, platform).expect(400);
    expect((await mutate('books', { book: { ticketTypeId: game.id, bookNumber: '99', slot: 'A', direction: 'ASC', nextTicket: 0, evidence: 'Not a manual rack' } }, date)).status).toBe(409);
  });

  it('uses Chicago business boundaries through daylight-saving transitions', async () => {
    for (const [date, expected] of [['2026-03-08', '2026-03-08T06:00:00.000Z'], ['2026-11-01', '2026-11-01T05:00:00.000Z']] as const) {
      const calendar = reportCalendar('America/Chicago', new Date(date + 'T12:00:00Z'));
      expect(calendar.midnight(calendar.year, calendar.month, calendar.dayOfMonth).toISOString()).toBe(expected);
    }
  });
});
