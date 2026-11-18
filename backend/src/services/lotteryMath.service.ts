import { Prisma } from '@prisma/client';
import { AppError } from '../utils/errorHandler';
import { BarcodeProfile, LotteryReport, LotterySettings } from '../validators/lotteryV2.validator';
import { rackTicketsSold } from './lotteryRack.service';

export const lotteryDecimal = (value: string | number | Prisma.Decimal | null | undefined) => new Prisma.Decimal(value ?? 0);
const add = (values: (string | number | Prisma.Decimal | null | undefined)[]) => values.reduce<Prisma.Decimal>((total, value) => total.add(lotteryDecimal(value)), lotteryDecimal(0));
const fixed = (value: Prisma.Decimal) => value.toFixed(2);
export const hasManualLottery = (settings: LotterySettings) => ['MANUAL', 'BOTH'].includes(settings.mode);
type BookRange = { firstTicket: number; lastTicket: number; direction: string; ticketCount: number };
export function ticketPosition(book: BookRange, ticket: number) {
  if (!Number.isInteger(ticket) || ticket < book.firstTicket || ticket > book.lastTicket) throw new AppError('Ticket number is outside this book', 400);
  return book.direction === 'ASC' ? ticket - book.firstTicket : book.lastTicket - ticket;
}
export function nextTicketNumber(book: BookRange, position: number) {
  if (position === book.ticketCount) return null;
  return String(book.direction === 'ASC' ? book.firstTicket + position : book.lastTicket - position).padStart(Math.max(3, String(book.lastTicket).length), '0');
}
export function parseLotteryBarcode(raw: string, profile: BarcodeProfile | null) {
  if (!profile) throw new AppError('Barcode parsing needs a verified inventory-code profile. Use manual game, book and ticket entry.', 409);
  const normalized = raw.trim().replace(/[ -]/g, '');
  const { gameDigits, bookDigits, ticketDigits, prefixDigits, suffixDigits } = profile;
  if (!/^\d+$/.test(normalized) || normalized.length !== gameDigits + bookDigits + ticketDigits + prefixDigits + suffixDigits) {
    throw new AppError('This code does not match the verified inventory barcode format. Use the game–book–ticket code.', 400);
  }
  const start = prefixDigits;
  return { game: normalized.slice(start, start + gameDigits), book: normalized.slice(start + gameDigits, start + gameDigits + bookDigits),
    ticket: normalized.slice(start + gameDigits + bookDigits, start + gameDigits + bookDigits + ticketDigits), normalized };
}
export function verifyBarcodeProfile(profile: BarcodeProfile | null) {
  if (!profile) return;
  for (const sample of profile.samples) {
    const parsed = parseLotteryBarcode(sample.raw, profile);
    if (parsed.game !== sample.game || parsed.book !== sample.book || parsed.ticket !== sample.ticket) throw new AppError('Barcode sample does not match its printed game, book and ticket identifiers', 400);
  }
  const [first, second] = profile.samples;
  if (first.game !== second.game || first.book !== second.book || Math.abs(Number(first.ticket) - Number(second.ticket)) !== 1) {
    throw new AppError('Verify two adjacent tickets from the same book', 400);
  }
}
export type LotteryCount = { book: BookRange & { name: string; price: Prisma.Decimal | string | number }; openingPosition: number; closingPosition: number | null;
  openingVerified: boolean; lossQuantity: number; disposition: string; reason: string | null };
export function lotteryDayTotals(settings: LotterySettings, report: LotteryReport, checkpoints: LotteryCount[]) {
  const problems: string[] = [];
  if (hasManualLottery(settings) && !checkpoints.length && !report.rackCounts && report.noBooksReason.trim().length < 3) problems.push('Register the manual books or explain why there are none');
  let manualSales = lotteryDecimal(0), manualTickets = 0;
  if (report.rackCounts) {
    if (hasManualLottery(settings) && !report.rackCounts.length) problems.push('Add your rack games in Ticket Setup');
    for (const row of report.rackCounts) {
      const sold = rackTicketsSold(row);
      if (sold === null) { problems.push('Enter the closing number for Bin ' + row.bin); continue; }
      manualTickets += sold; manualSales = manualSales.add(lotteryDecimal(row.price).mul(sold));
    }
  }
  for (const row of report.rackCounts ? [] : checkpoints) {
    if (row.closingPosition === null || !row.openingVerified) { problems.push('Scan or verify ' + row.book.name); continue; }
    const moved = row.closingPosition - row.openingPosition;
    if (moved < 0 || row.closingPosition > row.book.ticketCount || row.lossQuantity > moved) throw new AppError('Book counts do not reconcile', 400);
    if (row.lossQuantity || !['ACTIVE', 'DEPLETED'].includes(row.disposition)) {
      if (!row.reason || row.reason.trim().length < 3) throw new AppError('Explain book losses, moves and returns', 400);
    }
    const sold = moved - row.lossQuantity; manualTickets += sold; manualSales = manualSales.add(lotteryDecimal(row.book.price).mul(sold));
  }
  const countsComplete = problems.length === 0;
  if (new Set(report.dispensers.map(row => row.sourceId)).size !== report.dispensers.length ||
    report.dispensers.length !== settings.dispensers.length || report.dispensers.some(row => !settings.dispensers.some(source => source.id === row.sourceId))) {
    throw new AppError('Enter exactly one report for each configured dispenser', 400);
  }
  let dispenserSales = lotteryDecimal(0), dispenserTickets = 0, dispenserCountsKnown = true;
  for (const source of report.dispensers) {
    if (!source.reference.trim()) problems.push('Add a dispenser report reference');
    if (source.grossSales === null || source.cancellations === null) { problems.push('Complete each dispenser sales report'); dispenserCountsKnown = false; continue; }
    const net = lotteryDecimal(source.grossSales).sub(source.cancellations);
    if (net.isNegative()) throw new AppError('Dispenser cancellations exceed sales', 400);
    if (source.games.length && !add(source.games.map(row => row.amount)).eq(net)) throw new AppError('Dispenser game amounts must equal its sales after cancellations', 400);
    if (new Set(source.games.map(row => row.gameNumber)).size !== source.games.length) throw new AppError('Enter each game once per dispenser report', 400);
    dispenserSales = dispenserSales.add(net);
    if (!source.games.length || source.games.some(row => row.quantity === null)) dispenserCountsKnown = false;
    else dispenserTickets += source.games.reduce((total, row) => total + row.quantity!, 0);
  }
  const required = ['onlineGross', 'onlineCancels', 'drawPayouts', 'fastPlayPayouts', 'scratchPayouts', 'onlinePromotions', 'scratchPromotions',
    'onlineNoncash', 'scratchNoncash', 'collectionAdjustment'] as const;
  const labels = { onlineGross: 'gross online sales', onlineCancels: 'online cancellations', drawPayouts: 'draw-game payouts', fastPlayPayouts: 'FastPlay payouts', scratchPayouts: 'scratch-ticket payouts',
    onlinePromotions: 'online promotions', scratchPromotions: 'scratch promotions', onlineNoncash: 'online noncash sales', scratchNoncash: 'scratch noncash sales', collectionAdjustment: 'cash adjustments' };
  if (!report.reference.trim()) problems.push('Add the lottery terminal report reference');
  for (const name of required) if (report[name] === null) problems.push('Enter ' + labels[name] + ' (zero when confirmed)');
  const onlineSales = lotteryDecimal(report.onlineGross).sub(lotteryDecimal(report.onlineCancels));
  const scratchSales = manualSales.add(dispenserSales);
  if (report.onlineGross !== null && report.onlineCancels !== null && onlineSales.isNegative()) throw new AppError('Online cancellations exceed sales', 400);
  if (report.onlineGames.length && report.onlineGross !== null && !add(report.onlineGames.map(row => row.amount)).eq(lotteryDecimal(report.onlineGross))) throw new AppError('Online game amounts must equal gross online sales', 400);
  if ((report.onlineGross !== null && report.onlineCancels !== null && add([report.onlinePromotions, report.onlineNoncash]).gt(onlineSales)) ||
    (countsComplete && report.dispensers.every(row => row.grossSales !== null && row.cancellations !== null) && add([report.scratchPromotions, report.scratchNoncash]).gt(scratchSales))) {
    throw new AppError('Promotions and noncash sales cannot exceed their related sales', 400);
  }
  if ((!lotteryDecimal(report.collectionAdjustment).isZero() || !lotteryDecimal(report.earningsAdjustment).isZero()) && report.adjustmentReason.trim().length < 3) {
    throw new AppError('Explain the reported adjustment', 400);
  }
  const payouts = add([report.drawPayouts, report.fastPlayPayouts, report.scratchPayouts]);
  const netCollections = onlineSales.add(scratchSales).sub(add([report.onlinePromotions, report.scratchPromotions])).sub(payouts);
  const netCash = netCollections.sub(add([report.onlineNoncash, report.scratchNoncash])).add(lotteryDecimal(report.collectionAdjustment));
  const cashFields = ['openingCash', 'countedCash', 'cashAdded', 'cashRemoved', ...(settings.cashMode === 'SHARED' ? ['nonLotteryNetCash' as const] : [])] as const;
  const cashComplete = problems.length === 0 && cashFields.every(name => report[name] !== null);
  const expectedCash = lotteryDecimal(report.openingCash).add(netCash).add(lotteryDecimal(report.cashAdded)).sub(lotteryDecimal(report.cashRemoved))
    .add(settings.cashMode === 'SHARED' ? lotteryDecimal(report.nonLotteryNetCash) : lotteryDecimal(0));
  const earningsFields = ['onlineCommission', 'scratchCommission', 'cashingBonus', 'sellingBonus', 'fees', 'earningsAdjustment'] as const;
  const earningsComplete = earningsFields.every(name => report[name] !== null);
  const recordedEarnings = add([report.onlineCommission, report.scratchCommission, report.cashingBonus, report.sellingBonus, report.earningsAdjustment]).sub(lotteryDecimal(report.fees));
  return { manualTickets: countsComplete ? manualTickets : null, manualSales: countsComplete ? fixed(manualSales) : null,
    dispenserSales: report.dispensers.every(row => row.grossSales !== null && row.cancellations !== null) ? fixed(dispenserSales) : null,
    totalScratchTickets: countsComplete && dispenserCountsKnown ? manualTickets + dispenserTickets : null,
    scratchSales: countsComplete && report.dispensers.every(row => row.grossSales !== null && row.cancellations !== null) ? fixed(scratchSales) : null,
    onlineSales: report.onlineGross !== null && report.onlineCancels !== null ? fixed(onlineSales) : null,
    payouts: [report.drawPayouts, report.fastPlayPayouts, report.scratchPayouts].every(value => value !== null) ? fixed(payouts) : null,
    netCollections: problems.length ? null : fixed(netCollections), netCash: problems.length ? null : fixed(netCash),
    expectedCash: cashComplete ? fixed(expectedCash) : null, cashVariance: cashComplete ? fixed(lotteryDecimal(report.countedCash).sub(expectedCash)) : null,
    recordedEarnings: fixed(recordedEarnings), earnings: earningsComplete ? fixed(recordedEarnings) : null, earningsComplete, cashComplete, problems };
}
