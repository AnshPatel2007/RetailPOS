import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../utils/errorHandler';
import { reportCalendar, parseReportDate } from './reportDates.service';
import { LotterySettings, LotteryReport, LotteryBookInput, LotterySettlementInput, LotteryCorrectionInput, emptyLotteryReport, lotterySettingsSchema } from '../validators/lotteryV2.validator';
import { lotteryDayTotals, lotteryDecimal, ticketPosition, nextTicketNumber, parseLotteryBarcode, verifyBarcodeProfile, hasManualLottery } from './lotteryMath.service';
import { lotteryReadiness } from './lotteryReadiness.service';
import { buildRackRows, simpleReport, validateRackChanges } from './lotteryRack.service';

type Tx = Prisma.TransactionClient;
export type LotteryActor = { locationId: string; userId: string; role: string };
const json = (input: unknown) => JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
const settingsOf = (value: unknown) => lotterySettingsSchema.parse(value);
export async function lotteryAudit(tx: Tx, actor: LotteryActor, action: string, details: unknown, dayId?: string) {
  const businessDate = dayId ? (await tx.lotteryDay.findUniqueOrThrow({ where: { id: dayId }, select: { businessDate: true } })).businessDate : undefined;
  const event = await tx.lotteryAuditEvent.create({ data: { locationId: actor.locationId, userId: actor.userId, action, details: json({ ...Object(details), ...(businessDate ? { businessDate } : {}) }), dayId } });
  await tx.activityLog.create({ data: { locationId: actor.locationId, userId: actor.userId, action: 'UPDATE', entity: 'LOTTERY', entityId: dayId || actor.locationId,
    details: json({ action, ...Object(details) }) } });
  return event;
}
export async function lotteryOperation<T>(actor: LotteryActor, action: string, input: { idempotencyKey: string; [key: string]: unknown }, perform: (tx: Tx) => Promise<T>) {
  const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return prisma.$transaction(async tx => {
    const stores = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM locations WHERE id = ${actor.locationId} AND "isActive" FOR UPDATE`;
    if (!stores.length) throw new AppError('Select an active store', 404);
    const receipt = await tx.operationReceipt.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (receipt) {
      if (receipt.locationId !== actor.locationId || receipt.userId !== actor.userId || receipt.kind !== action || receipt.requestHash !== requestHash) throw new AppError('This retry key belongs to another operation', 409);
      return receipt.result as T;
    }
    const result = await perform(tx);
    await tx.operationReceipt.create({ data: { idempotencyKey: input.idempotencyKey, requestHash, kind: action, targetId: actor.locationId,
      locationId: actor.locationId, userId: actor.userId, result: json(result) } });
    return result;
  }, { timeout: 60000 });
}
async function calendarFor(tx: Tx, locationId: string) {
  const store = await tx.location.findUniqueOrThrow({ where: { id: locationId }, select: { timezone: true } });
  return reportCalendar(store.timezone);
}
const calendarDate = (calendar: ReturnType<typeof reportCalendar>) => `${calendar.year}-${String(calendar.month).padStart(2, '0')}-${String(calendar.dayOfMonth).padStart(2, '0')}`;
async function configurationFor(tx: Tx, locationId: string, businessDate: string) {
  return tx.lotteryConfiguration.findFirst({ where: { locationId, effectiveDate: { lte: businessDate } }, orderBy: { effectiveDate: 'desc' } });
}
export async function getLotteryConfiguration(locationId: string) {
  const versions = await prisma.lotteryConfiguration.findMany({ where: { locationId }, orderBy: { effectiveDate: 'desc' } });
  return { versions, latestId: versions[0]?.id || null };
}
export async function saveLotteryEquipment(tx: Tx, actor: LotteryActor, input: { mode: 'MANUAL' | 'DISPENSER'; previousId: string | null }) {
  const latest = await tx.lotteryConfiguration.findFirst({ where: { locationId: actor.locationId }, orderBy: { effectiveDate: 'desc' } });
  const lastDay = await tx.lotteryDay.findFirst({ where: { locationId: actor.locationId }, orderBy: { businessDate: 'desc' } });
  let effectiveDate = calendarDate(await calendarFor(tx, actor.locationId));
  const after = [lastDay?.businessDate, latest?.effectiveDate].filter((date): date is string => !!date).sort().pop();
  if (after && after >= effectiveDate) { const date = new Date(after + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + 1); effectiveDate = date.toISOString().slice(0, 10); }
  const previous = latest ? settingsOf(latest.settings) : null;
  return saveLotteryConfiguration(tx, actor, { effectiveDate, previousId: input.previousId, settings: {
    mode: input.mode, workflow: 'SIMPLE', cashMode: previous?.cashMode || 'SEPARATE', barcodeProfile: previous?.barcodeProfile || null, pilotEvidence: '',
    dispensers: input.mode === 'DISPENSER' ? previous?.dispensers.length ? previous.dispensers : [{ id: 'machine', name: 'Lottery machine' }] : [],
  } });
}
export async function saveLotteryConfiguration(tx: Tx, actor: LotteryActor, input: { effectiveDate: string; previousId: string | null; settings: LotterySettings }) {
  const latest = await tx.lotteryConfiguration.findFirst({ where: { locationId: actor.locationId }, orderBy: { effectiveDate: 'desc' } });
  if ((latest?.id || null) !== input.previousId) throw new AppError('Configuration changed. Reload it before saving.', 409);
  const calendar = await calendarFor(tx, actor.locationId);
  if (input.effectiveDate < calendarDate(calendar) || (latest && input.effectiveDate <= latest.effectiveDate)) throw new AppError('Choose a new effective date from today onward', 400);
  const latestDay = await tx.lotteryDay.findFirst({ where: { locationId: actor.locationId }, orderBy: { businessDate: 'desc' } });
  if (latestDay && input.effectiveDate <= latestDay.businessDate) throw new AppError('Settings can only change on an unopened business day', 409);
  // Never overlap imported earnings or legacy daily records at cutover.
  const cutover = parseReportDate(calendar, input.effectiveDate).date;
  if (!latest && (await tx.lotteryDayStatus.count({ where: { locationId: actor.locationId, entryDate: { gte: cutover } } }) ||
    await tx.lotteryDailyEntry.count({ where: { locationId: actor.locationId, entryDate: { gte: cutover } } }) ||
    await tx.lotteryTransaction.count({ where: { locationId: actor.locationId, transactionDate: { gte: cutover } } }) ||
    await tx.historicalIncome.count({ where: { locationId: actor.locationId, kind: { startsWith: 'LOTTERY' }, recognizedAt: { gte: cutover } } }))) {
    throw new AppError('Choose a cutover after existing lottery activity and imported earnings', 409);
  }
  if (input.settings.workflow !== 'SIMPLE') verifyBarcodeProfile(input.settings.barcodeProfile);
  const saved = await tx.lotteryConfiguration.create({ data: { locationId: actor.locationId, effectiveDate: input.effectiveDate, settings: json(input.settings), userId: actor.userId } });
  await lotteryAudit(tx, actor, 'CONFIGURE', { configurationId: saved.id, effectiveDate: input.effectiveDate, settings: input.settings });
  return saved;
}
async function bookRows(tx: Tx, day: { id: string }) {
  const checkpoints = await tx.lotteryCheckpoint.findMany({ where: { dayId: day.id }, orderBy: { slot: 'asc' } });
  const books = await tx.lotteryBook.findMany({ where: { id: { in: checkpoints.map(row => row.bookId) } } });
  return checkpoints.map(row => {
    const book = books.find(book => book.id === row.bookId)!;
    return { ...row, book, openingTicket: nextTicketNumber(book, row.openingPosition), closingTicket: row.closingPosition === null ? null : nextTicketNumber(book, row.closingPosition) };
  });
}
async function decorateDay(tx: Tx, day: Awaited<ReturnType<Tx['lotteryDay']['findUniqueOrThrow']>>) {
  const checkpoints = await bookRows(tx, day), configuration = settingsOf(day.configuration), report = day.report as unknown as LotteryReport;
  const totals = lotteryDayTotals(configuration, report, checkpoints);
  const earningsSettlement = day.status === 'CLOSED' ? await tx.lotterySettlement.findFirst({
    where: { locationId: day.locationId, periodStart: { lte: day.businessDate }, periodEnd: { gte: day.businessDate } },
    select: { id: true, reference: true, periodStart: true, periodEnd: true },
  }) : null;
  return { ...day, configuration, report, checkpoints, configured: true,
    earningsPending: day.status !== 'CLOSED' || (day.earningsIncomplete && !earningsSettlement), earningsSettlement,
    totals, readiness: lotteryReadiness(configuration, report, checkpoints, totals), canReopen: day.status === 'CLOSED' &&
      !await tx.lotteryDay.count({ where: { locationId: day.locationId, businessDate: { gt: day.businessDate } } }) &&
      !await tx.lotteryAuditEvent.count({ where: { dayId: day.id, action: 'CORRECTION' } }) &&
      !earningsSettlement };
}
export async function getLotteryDay(locationId: string, businessDate: string) {
  return prisma.$transaction(async tx => {
    const day = await tx.lotteryDay.findUnique({ where: { locationId_businessDate: { locationId, businessDate } } });
    if (day) return decorateDay(tx, day);
    const config = await configurationFor(tx, locationId, businessDate);
    const upcoming = await tx.lotteryConfiguration.findFirst({ where: { locationId }, orderBy: { effectiveDate: 'asc' } });
    if (!config) return { configured: false, upcomingDate: upcoming?.effectiveDate || null, businessDate };
    const settings = settingsOf(config.settings);
    return { configured: true, id: null, businessDate, status: 'DRAFT', version: 0, configuration: settings, configurationId: config.id,
      report: emptyLotteryReport(settings), checkpoints: [], totals: null, canReopen: false };
  });
}
async function ensureDay(tx: Tx, actor: LotteryActor, businessDate: string, expectedVersion: number) {
  const key = { locationId_businessDate: { locationId: actor.locationId, businessDate } };
  let day = await tx.lotteryDay.findUnique({ where: key });
  if (day && (day.status !== 'DRAFT' || day.version !== expectedVersion)) throw new AppError('This day changed or was closed. Reload the saved day before continuing.', 409);
  if (!day) {
    if (expectedVersion !== 0) throw new AppError('Reload this day before continuing', 409);
    const config = await configurationFor(tx, actor.locationId, businessDate);
    if (!config || settingsOf(config.settings).mode === 'DISABLED') throw new AppError('Lottery tracking is not enabled for this date', 409);
    const settings = settingsOf(config.settings), calendar = await calendarFor(tx, actor.locationId);
    if (businessDate > calendarDate(calendar)) throw new AppError('Future lottery days cannot be opened', 400);
    if (await tx.lotterySettlement.count({ where: { locationId: actor.locationId, periodEnd: { gte: businessDate } } })) throw new AppError('This period is settled. Use an audited correction instead of opening another day.', 409);
    const other = await tx.lotteryDay.findFirst({ where: { locationId: actor.locationId, OR: [{ status: 'DRAFT' }, { businessDate: { gte: businessDate } }] } });
    if (other) throw new AppError('Finish the open day first and record new days in date order', 409);
    const previous = await tx.lotteryDay.findFirst({ where: { locationId: actor.locationId, status: 'CLOSED' }, orderBy: { businessDate: 'desc' } });
    const simple = settings.workflow === 'SIMPLE' || (previous && settingsOf(previous.configuration).workflow === 'SIMPLE');
    const previousDate = new Date(businessDate + 'T12:00:00Z'); previousDate.setUTCDate(previousDate.getUTCDate() - 1);
    const automaticOpening = previous?.businessDate === previousDate.toISOString().slice(0, 10) && previous.configurationId === config.id;
    day = await tx.lotteryDay.create({ data: { locationId: actor.locationId, businessDate, configurationId: config.id, configuration: simple ? json({ ...settings, workflow: 'SIMPLE' }) : config.settings as Prisma.InputJsonValue,
      recognizedAt: parseReportDate(calendar, businessDate).date, report: json(emptyLotteryReport(settings)) } });
    if (hasManualLottery(settings) && !simple) {
      const books = await tx.lotteryBook.findMany({ where: { locationId: actor.locationId, status: { in: ['ACTIVE', 'PAUSED'] }, registeredDate: { lte: businessDate } } });
      for (const book of books) await tx.lotteryCheckpoint.create({ data: { dayId: day.id, bookId: book.id, openingPosition: book.position,
        openingVerified: automaticOpening, previousStatus: book.status, disposition: book.status, slot: book.slot,
        ...(book.status === 'PAUSED' ? { closingPosition: book.position, reason: 'Carried paused book' } : {}) } });
    }
    await lotteryAudit(tx, actor, 'OPEN_DAY', { businessDate, configurationId: config.id }, day.id);
  }
  return day;
}
async function finishMutation(tx: Tx, actor: LotteryActor, dayId: string, action: string, details: unknown) {
  const day = await tx.lotteryDay.update({ where: { id: dayId }, data: { version: { increment: 1 } } });
  await lotteryAudit(tx, actor, action, details, dayId);
  return decorateDay(tx, day);
}
export async function openLotteryDay(tx: Tx, actor: LotteryActor, date: string, expectedVersion: number) {
  const day = await ensureDay(tx, actor, date, expectedVersion); return finishMutation(tx, actor, day.id, 'REVIEW_DAY', { date });
}
export async function openSimpleLotteryDay(tx: Tx, actor: LotteryActor, date: string, expectedVersion: number) {
  const day = await ensureDay(tx, actor, date, expectedVersion), configuration = settingsOf(day.configuration);
  const report = day.report as unknown as LotteryReport, rows = await bookRows(tx, day);
  const racks = !hasManualLottery(configuration) ? undefined : report.rackCounts || (rows.length ? rows.map(row => ({
    id: row.bookId, ticketTypeId: row.book.ticketTypeId, bin: row.slot, name: row.book.name, gameNumber: row.book.gameNumber, price: row.book.price.toFixed(2),
    firstTicket: row.book.firstTicket, lastTicket: row.book.lastTicket, direction: row.book.direction as 'ASC' | 'DESC',
    openingNumber: row.book.direction === 'ASC' ? row.book.firstTicket + row.openingPosition : row.book.lastTicket - row.openingPosition,
    closingNumber: row.closingPosition === null ? null : String(row.book.direction === 'ASC' ? row.book.firstTicket + row.closingPosition : row.book.lastTicket - row.closingPosition),
    finishedRolls: 0, lossQuantity: row.lossQuantity,
  })) : await buildRackRows(tx, actor.locationId, date));
  await tx.lotteryDay.update({ where: { id: day.id }, data: { configuration: json({ ...configuration, workflow: 'SIMPLE' }), report: json(simpleReport(report, date, racks)) } });
  return finishMutation(tx, actor, day.id, 'OPEN_ENTRY', { date });
}
export async function saveLotteryReport(tx: Tx, actor: LotteryActor, date: string, expectedVersion: number, report: LotteryReport) {
  const day = await ensureDay(tx, actor, date, expectedVersion);
  validateRackChanges(day.report as unknown as LotteryReport, report);
  lotteryDayTotals(settingsOf(day.configuration), report, await bookRows(tx, day));
  await tx.lotteryDay.update({ where: { id: day.id }, data: { report: json(report) } });
  return finishMutation(tx, actor, day.id, 'SAVE_REPORT', { report });
}
async function registerBook(tx: Tx, actor: LotteryActor, day: Awaited<ReturnType<typeof ensureDay>>, input: LotteryBookInput) {
  if (!hasManualLottery(settingsOf(day.configuration))) throw new AppError('This store uses dispenser reports; individual book counts are not required', 409);
  const game = await tx.lotteryTicketType.findFirst({ where: { id: input.ticketTypeId, locationId: actor.locationId, isActive: true } });
  if (!game || game.gameNumber === null || game.firstTicket === null || game.lastTicket === null) throw new AppError('Complete this game’s ticket range in Ticket Setup first', 400);
  const occupied = (await bookRows(tx, day)).some(row => row.slot === input.slot && row.disposition === 'ACTIVE');
  if (occupied) throw new AppError('This bin already has an active book. Finish or move that book first.', 409);
  const range = { firstTicket: game.firstTicket, lastTicket: game.lastTicket, direction: input.direction, ticketCount: game.lastTicket - game.firstTicket + 1 };
  const position = ticketPosition(range, input.nextTicket);
  if (await tx.lotteryBook.count({ where: { locationId: actor.locationId, gameNumber: game.gameNumber, bookNumber: input.bookNumber } })) throw new AppError('This book is already registered at this store', 409);
  const book = await tx.lotteryBook.create({ data: { locationId: actor.locationId, ticketTypeId: game.id, gameNumber: game.gameNumber, bookNumber: input.bookNumber,
    name: game.ticketName, price: game.pricePerTicket, slot: input.slot, ...range, position, registeredDate: day.businessDate, evidence: input.evidence, userId: actor.userId } });
  await tx.lotteryCheckpoint.create({ data: { dayId: day.id, bookId: book.id, openingPosition: position, openingVerified: true, previousStatus: 'ACTIVE', slot: book.slot } });
  return book;
}
export async function addLotteryBook(tx: Tx, actor: LotteryActor, date: string, expectedVersion: number, input: LotteryBookInput, depletedBookId?: string) {
  const day = await ensureDay(tx, actor, date, expectedVersion);
  if (depletedBookId) {
    const old = await tx.lotteryBook.findFirst({ where: { id: depletedBookId, locationId: actor.locationId } });
    const checkpoint = await tx.lotteryCheckpoint.findUnique({ where: { dayId_bookId: { dayId: day.id, bookId: depletedBookId } } });
    if (!old || !checkpoint || !checkpoint.openingVerified || !['ACTIVE', 'DEPLETED'].includes(checkpoint.disposition)) throw new AppError('Verify the previous book’s opening before replacement', 409);
    await tx.lotteryCheckpoint.update({ where: { id: checkpoint.id }, data: { closingPosition: old.ticketCount, disposition: 'DEPLETED' } });
  }
  const book = await registerBook(tx, actor, day, input);
  return finishMutation(tx, actor, day.id, depletedBookId ? 'REPLACE_BOOK' : 'REGISTER_BOOK', { book, depletedBookId });
}
export async function previewLotteryScan(locationId: string, date: string, raw: string) {
  const config = await prisma.lotteryDay.findUnique({ where: { locationId_businessDate: { locationId, businessDate: date } }, select: { configuration: true } });
  const settings = config?.configuration || (await prisma.lotteryConfiguration.findFirst({ where: { locationId, effectiveDate: { lte: date } }, orderBy: { effectiveDate: 'desc' } }))?.settings;
  if (!settings) throw new AppError('Configure this store’s lottery first', 409);
  const parsed = parseLotteryBarcode(raw, settingsOf(settings).barcodeProfile);
  const book = await prisma.lotteryBook.findUnique({ where: { locationId_gameNumber_bookNumber: { locationId, gameNumber: parsed.game, bookNumber: parsed.book } } });
  return { ...parsed, bookId: book?.id || null, bookName: book?.name || null };
}
export async function checkpointLotteryBook(tx: Tx, actor: LotteryActor, date: string, expectedVersion: number,
  input: { bookId: string; nextTicket?: number; raw?: string; opening?: boolean; resetOpening?: boolean; soldOut?: boolean; disposition?: string; slot?: string; lossQuantity?: number; reason?: string }) {
  const day = await ensureDay(tx, actor, date, expectedVersion);
  const book = await tx.lotteryBook.findFirst({ where: { id: input.bookId, locationId: actor.locationId } });
  const row = await tx.lotteryCheckpoint.findUnique({ where: { dayId_bookId: { dayId: day.id, bookId: input.bookId } } });
  if (!book || !row) throw new AppError('This book is not part of the selected day', 404);
  let ticket = input.nextTicket;
  if (input.raw) {
    const parsed = parseLotteryBarcode(input.raw, settingsOf(day.configuration).barcodeProfile);
    if (parsed.game !== book.gameNumber || parsed.book !== book.bookNumber) throw new AppError('Scanned barcode belongs to another book', 400);
    ticket = Number(parsed.ticket);
  }
  if (input.opening) {
    if (ticket === undefined) throw new AppError('Enter the next unsold ticket', 400);
    const position = ticketPosition(book, ticket);
    if (input.resetOpening) {
      if (actor.role !== 'ADMIN') throw new AppError('Only the owner can review a new starting position', 403);
      if (row.openingVerified || row.closingPosition !== null || !input.reason || input.reason.trim().length < 3) throw new AppError('A new starting position requires an unverified opening and supporting evidence', 409);
    } else if (position !== row.openingPosition) throw new AppError('The opening scan differs from the carried position. Ask the owner to reconcile the difference.', 409);
    await tx.lotteryCheckpoint.update({ where: { id: row.id }, data: { openingVerified: true, openingPosition: position, ...(input.reason ? { reason: input.reason } : {}) } });
  } else {
    if (!row.openingVerified) throw new AppError('Verify this book’s opening position first', 409);
    if (ticket === undefined && !input.soldOut) throw new AppError('Scan the next unsold ticket or explicitly mark the book sold out', 400);
    const position = input.soldOut ? book.ticketCount : ticketPosition(book, ticket!);
    if (position < row.openingPosition) throw new AppError('Closing position is before opening. Check the book and counting direction.', 400);
    const disposition = input.soldOut ? 'DEPLETED' : input.disposition || (row.disposition === 'DEPLETED' ? 'ACTIVE' : row.disposition);
    const lossQuantity = input.lossQuantity ?? row.lossQuantity, slot = input.slot || row.slot;
    if (lossQuantity > position - row.openingPosition) throw new AppError('Lost tickets exceed the tickets removed from this book', 400);
    const adjustmentChanged = lossQuantity !== row.lossQuantity || slot !== row.slot || (disposition !== row.disposition && !['ACTIVE', 'DEPLETED'].includes(disposition));
    if ((lossQuantity || slot !== row.slot || !['ACTIVE', 'DEPLETED'].includes(disposition)) && !(input.reason || (!adjustmentChanged && row.reason) || '').trim()) throw new AppError('Enter a reason for this inventory adjustment', 400);
    if (actor.role === 'CASHIER' && (adjustmentChanged || (disposition === 'ACTIVE' && row.disposition === 'PAUSED'))) throw new AppError('A manager must record book adjustments', 403);
    if (disposition === 'ACTIVE' && (await bookRows(tx, day)).some(other => other.bookId !== book.id && other.slot === slot && other.disposition === 'ACTIVE')) throw new AppError('This bin already has an active book', 409);
    await tx.lotteryCheckpoint.update({ where: { id: row.id }, data: { closingPosition: position, disposition, lossQuantity, slot,
      ...(input.reason ? { reason: input.reason } : {}), ...(input.raw ? { barcode: input.raw } : {}) } });
  }
  return finishMutation(tx, actor, day.id, input.opening ? 'VERIFY_OPENING' : 'CHECKPOINT', input);
}
async function postDailyEarnings(tx: Tx, actor: LotteryActor, day: Awaited<ReturnType<typeof ensureDay>>, desired: string, reason: string) {
  const previous = await tx.lotteryEarningPosting.aggregate({ where: { dayId: day.id }, _sum: { amount: true } });
  const difference = lotteryDecimal(desired).sub(previous._sum.amount || 0);
  if (!difference.isZero()) await tx.lotteryEarningPosting.create({ data: { locationId: actor.locationId, dayId: day.id, recognizedAt: day.recognizedAt,
    sourceKey: `day:${day.id}:${day.version + 1}`, amount: difference, reason, userId: actor.userId } });
}
export async function closeLotteryDay(tx: Tx, actor: LotteryActor, date: string, expectedVersion: number) {
  const day = await ensureDay(tx, actor, date, expectedVersion), rows = await bookRows(tx, day);
  const report = day.report as unknown as LotteryReport, totals = lotteryDayTotals(settingsOf(day.configuration), report, rows);
  if (totals.problems.length) throw new AppError(totals.problems.join('; '), 400);
  const others = await tx.lotteryDay.findMany({ where: { locationId: actor.locationId, id: { not: day.id } }, select: { report: true } });
  if (others.some(other => {
    const saved = other.report as unknown as LotteryReport;
    return saved.reference === report.reference || report.dispensers.some(source => saved.dispensers.some(prior => prior.sourceId === source.sourceId && prior.reference === source.reference));
  })) throw new AppError('A terminal or dispenser report reference is already used on another day. Include its business date in the reference.', 409);
  if (settingsOf(day.configuration).workflow !== 'SIMPLE' && (!totals.cashComplete || (totals.cashVariance !== null && !lotteryDecimal(totals.cashVariance).isZero())) && report.exceptionReason.trim().length < 3) throw new AppError('Reconcile cash or explain the outstanding difference before closing', 400);
  for (const row of report.rackCounts ? [] : rows) await tx.lotteryBook.update({ where: { id: row.bookId }, data: { position: row.closingPosition!, status: row.disposition, slot: row.slot, version: { increment: 1 } } });
  await postDailyEarnings(tx, actor, day, totals.recordedEarnings, 'Confirmed lottery daily report ' + date);
  await tx.lotteryDay.update({ where: { id: day.id }, data: { status: 'CLOSED', closedBy: actor.userId, closedAt: new Date(), totals: json(totals), earningsIncomplete: !totals.earningsComplete } });
  return finishMutation(tx, actor, day.id, 'CLOSE_DAY', { totals, closedVersion: day.version + 1, openingSlots: rows.map(row => ({ bookId: row.bookId, slot: row.book.slot })) });
}
export async function reopenLotteryDay(tx: Tx, actor: LotteryActor, date: string, expectedVersion: number, reason: string) {
  const day = await tx.lotteryDay.findUnique({ where: { locationId_businessDate: { locationId: actor.locationId, businessDate: date } } });
  if (!day || day.status !== 'CLOSED' || day.version !== expectedVersion) throw new AppError('Reload the closed day before reopening', 409);
  if (await tx.lotteryDay.count({ where: { locationId: actor.locationId, businessDate: { gt: date } } }) || await tx.lotteryAuditEvent.count({ where: { dayId: day.id, action: 'CORRECTION' } }) || await tx.lotterySettlement.count({ where: { locationId: actor.locationId, periodStart: { lte: date }, periodEnd: { gte: date } } })) {
    throw new AppError('Later days or a settlement depend on this day. Use an audited correction instead.', 409);
  }
  const closeEvent = await tx.lotteryAuditEvent.findFirst({ where: { dayId: day.id, action: 'CLOSE_DAY', details: { path: ['closedVersion'], equals: day.version } } });
  const openings = (closeEvent?.details as { openingSlots?: { bookId: string; slot: string }[] } | undefined)?.openingSlots || [];
  for (const row of await bookRows(tx, day)) await tx.lotteryBook.update({ where: { id: row.bookId }, data: { position: row.openingPosition, status: row.previousStatus,
    slot: openings.find(item => item.bookId === row.bookId)?.slot || row.slot, version: { increment: 1 } } });
  await postDailyEarnings(tx, actor, day, '0', 'Reopened lottery day: ' + reason);
  await tx.lotteryDay.update({ where: { id: day.id }, data: { status: 'DRAFT', closedAt: null, closedBy: null, earningsIncomplete: true } });
  return finishMutation(tx, actor, day.id, 'REOPEN_DAY', { reason });
}
export async function saveLotterySettlement(tx: Tx, actor: LotteryActor, input: LotterySettlementInput, expectedVersion: number) {
  const config = await configurationFor(tx, actor.locationId, input.periodStart);
  if (!config) throw new AppError('Settlement periods must start on or after lottery cutover', 400);
  if (input.periodEnd > calendarDate(await calendarFor(tx, actor.locationId))) throw new AppError('The settlement period cannot end in the future', 400);
  const overlap = await tx.lotterySettlement.findFirst({ where: { locationId: actor.locationId, periodStart: { lte: input.periodEnd }, periodEnd: { gte: input.periodStart } } });
  if (overlap && (overlap.periodStart !== input.periodStart || overlap.periodEnd !== input.periodEnd)) throw new AppError('Settlement periods must not overlap', 409);
  if ((overlap?.version || 0) !== expectedVersion) throw new AppError('Settlement changed. Reload it before saving.', 409);
  if (await tx.lotteryDay.count({ where: { locationId: actor.locationId, businessDate: { gte: input.periodStart, lte: input.periodEnd }, status: 'DRAFT' } })) throw new AppError('Close the daily drafts in this period first', 409);
  if (new Set(input.settledBookIds).size !== input.settledBookIds.length || await tx.lotteryBook.count({ where: { id: { in: input.settledBookIds }, locationId: actor.locationId, registeredDate: { lte: input.periodEnd } } }) !== input.settledBookIds.length) throw new AppError('Select each settled book once, registered at this store by the period end', 400);
  const duplicateReference = await tx.lotterySettlement.findFirst({ where: { locationId: actor.locationId, reference: input.reference, ...(overlap ? { id: { not: overlap.id } } : {}) } });
  if (duplicateReference) throw new AppError('This settlement reference is already recorded', 409);
  const desired = lotteryDecimal(input.onlineCommission).add(input.scratchCommission).add(input.cashingBonus).add(input.sellingBonus).add(input.earningsAdjustment).sub(input.fees);
  const settlement = overlap ? await tx.lotterySettlement.update({ where: { id: overlap.id }, data: { reference: input.reference, details: json(input), reportedEarnings: desired, version: { increment: 1 }, userId: actor.userId } }) :
    await tx.lotterySettlement.create({ data: { locationId: actor.locationId, periodStart: input.periodStart, periodEnd: input.periodEnd, reference: input.reference, details: json(input), reportedEarnings: desired, userId: actor.userId } });
  const days = await tx.lotteryDay.findMany({ where: { locationId: actor.locationId, businessDate: { gte: input.periodStart, lte: input.periodEnd } }, select: { id: true } });
  const posted = await tx.lotteryEarningPosting.aggregate({ where: { locationId: actor.locationId, OR: [{ dayId: { in: days.map(day => day.id) } }, { settlementId: settlement.id }] }, _sum: { amount: true } });
  const difference = desired.sub(posted._sum.amount || 0);
  const calendar = await calendarFor(tx, actor.locationId);
  await tx.lotteryEarningPosting.create({ data: { locationId: actor.locationId, settlementId: settlement.id, sourceKey: `settlement:${settlement.id}:${settlement.version}`,
    amount: difference, recognizedAt: parseReportDate(calendar, input.periodEnd).date, reason: input.reason, userId: actor.userId } });
  await lotteryAudit(tx, actor, 'SETTLEMENT', { ...input, difference: difference.toFixed(2), settlementId: settlement.id });
  return { ...settlement, adjustment: difference.toFixed(2) };
}

/** Prior counts stay immutable. Corrections are linked deltas, never a rewrite of subsequent openings. */
export async function correctLotteryDay(tx: Tx, actor: LotteryActor, date: string, expectedVersion: number, correction: LotteryCorrectionInput) {
  const day = await tx.lotteryDay.findUnique({ where: { locationId_businessDate: { locationId: actor.locationId, businessDate: date } } });
  if (!day || day.status !== 'CLOSED' || day.version !== expectedVersion) throw new AppError('Reload the closed day before recording a correction', 409);
  if (!lotteryDecimal(correction.earnings).isZero() && await tx.lotterySettlement.count({ where: { locationId: actor.locationId, periodStart: { lte: date }, periodEnd: { gte: date } } })) throw new AppError('Correct the settlement to change earnings in a settled period', 409);
  const calendar = await calendarFor(tx, actor.locationId), postingDate = calendarDate(calendar);
  const event = await lotteryAudit(tx, actor, 'CORRECTION', { ...correction, businessDate: date, postingDate }, day.id);
  if (!lotteryDecimal(correction.earnings).isZero()) await tx.lotteryEarningPosting.create({ data: { locationId: actor.locationId, dayId: day.id, sourceKey: 'correction:' + event.id,
    recognizedAt: parseReportDate(calendar, postingDate).date, amount: correction.earnings, reason: correction.reason, userId: actor.userId } });
  await tx.lotteryDay.update({ where: { id: day.id }, data: { version: { increment: 1 } } });
  return { event, postingDate };
}
