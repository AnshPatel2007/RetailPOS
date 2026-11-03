import { Router, Response } from 'express';
import { z } from 'zod';
import { LotteryAuditEvent, LotteryCheckpoint, Prisma } from '@prisma/client';
import prisma from '../config/database';
import { authorize } from '../middleware/auth';
import { AuthRequest } from '../types';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { getLocationFilter } from '../utils/locationFilter.util';
import { lotteryDate, lotterySettingsSchema, lotteryBookSchema, lotteryGameSchema, lotteryReportSchema, lotterySettlementSchema, lotteryCorrectionSchema, retryKey, version } from '../validators/lotteryV2.validator';
import { LotteryActor, lotteryOperation, lotteryAudit, getLotteryConfiguration, saveLotteryConfiguration, getLotteryDay,
  openLotteryDay, saveLotteryReport, addLotteryBook, previewLotteryScan, checkpointLotteryBook, closeLotteryDay, reopenLotteryDay, saveLotterySettlement, correctLotteryDay } from '../services/lotteryV2.service';
import { openSimpleLotteryDay, saveLotteryEquipment } from '../services/lotteryV2.service';
import { reportCalendar, parseReportDate } from '../services/reportDates.service';
import { nextTicketNumber } from '../services/lotteryMath.service';
import { buildRackRows } from '../services/lotteryRack.service';
import type { LotteryReport, LotterySettings } from '../validators/lotteryV2.validator';

const router = Router();
const actor = (req: AuthRequest): LotteryActor => {
  const locationId = getLocationFilter(req, req.params.locationId || (typeof req.query.locationId === 'string' ? req.query.locationId : undefined)).locationId;
  if (!locationId) throw new AppError('Select a store', 400);
  return { locationId, userId: req.user!.id, role: req.user!.role };
};
const send = (res: Response, data: unknown) => res.json({ success: true, data });
const mutation = z.object({ idempotencyKey: retryKey, expectedVersion: version });
const entryRoles = authorize('ADMIN', 'MANAGER', 'CASHIER'), manageRoles = authorize('ADMIN', 'MANAGER');

router.get('/configuration', asyncHandler(async (req: AuthRequest, res: Response) => { send(res, await getLotteryConfiguration(actor(req).locationId)); }));
router.post('/equipment/:locationId', authorize('SUPER_ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const input = z.object({ idempotencyKey: retryKey, mode: z.enum(['MANUAL', 'DISPENSER']), previousId: z.string().nullable() }).strict().parse(req.body);
  const who = actor(req); send(res, await lotteryOperation(who, 'LOTTERY_EQUIPMENT', input, tx => saveLotteryEquipment(tx, who, input)));
}));
router.post(['/configuration', '/configuration/:locationId'], authorize('SUPER_ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const input = z.object({ idempotencyKey: retryKey, previousId: z.string().nullable(), effectiveDate: lotteryDate, settings: lotterySettingsSchema }).strict().parse(req.body);
  const who = actor(req); send(res, await lotteryOperation(who, 'LOTTERY_CONFIGURATION', input, tx => saveLotteryConfiguration(tx, who, input)));
}));
router.get('/games', asyncHandler(async (req: AuthRequest, res: Response) => {
  send(res, await prisma.lotteryTicketType.findMany({ where: { locationId: actor(req).locationId }, orderBy: [{ sortOrder: 'asc' }, { ticketName: 'asc' }] }));
}));
router.post('/games', manageRoles, asyncHandler(async (req: AuthRequest, res: Response) => {
  const input = z.object({ idempotencyKey: retryKey, id: z.string().optional(), expectedUpdatedAt: z.string().optional(), game: lotteryGameSchema }).strict().parse(req.body);
  const who = actor(req);
  send(res, await lotteryOperation(who, 'LOTTERY_GAME', input, async tx => {
    const previous = input.id ? await tx.lotteryTicketType.findFirst({ where: { id: input.id, locationId: who.locationId } }) : null;
    if (input.id && !previous) throw new AppError('Game not found', 404);
    if (previous && previous.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new AppError('Game changed. Reload before saving.', 409);
    const duplicate = await tx.lotteryTicketType.findFirst({ where: { locationId: who.locationId, OR: [{ gameNumber: input.game.gameNumber }, { ticketCode: input.game.ticketCode }], ...(previous ? { id: { not: previous.id } } : {}) } });
    if (duplicate) throw new AppError('This game number or code is already registered', 409);
    if (input.game.binNumber && input.game.isActive && await tx.lotteryTicketType.count({ where: { locationId: who.locationId, binNumber: input.game.binNumber, isActive: true, ...(previous ? { id: { not: previous.id } } : {}) } })) throw new AppError('This bin already has an active game', 409);
    if (input.game.startingNumber != null && (input.game.startingNumber < input.game.firstTicket || input.game.startingNumber > input.game.lastTicket)) throw new AppError('Starting number must be inside the ticket range', 400);
    const game = previous ? await tx.lotteryTicketType.update({ where: { id: previous.id }, data: input.game }) : await tx.lotteryTicketType.create({ data: { ...input.game, locationId: who.locationId } });
    const draft = await tx.lotteryDay.findFirst({ where: { locationId: who.locationId, status: 'DRAFT' } });
    const report = draft?.report as unknown as LotteryReport | undefined;
    if (draft && (draft.configuration as unknown as LotterySettings).workflow === 'SIMPLE' && report?.rackCounts && game.isActive && game.binNumber && game.startingNumber !== null && !report.rackCounts.some(row => row.ticketTypeId === game.id)) {
      const row = (await buildRackRows(tx, who.locationId, draft.businessDate)).find(row => row.ticketTypeId === game.id);
      if (row) await tx.lotteryDay.update({ where: { id: draft.id }, data: { report: { ...report, rackCounts: [...report.rackCounts, row] } as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
    }
    await lotteryAudit(tx, who, 'GAME_SETUP', { previous, game }); return game;
  }));
}));
router.get('/books', asyncHandler(async (req: AuthRequest, res: Response) => {
  const page = z.coerce.number().int().min(1).parse(req.query.page || 1);
  const search = z.string().trim().max(150).parse(req.query.search || ''), status = z.enum(['ACTIVE', 'PAUSED', 'DEPLETED', 'RETURNED', 'LOST']).optional().parse(req.query.status);
  const where: Prisma.LotteryBookWhereInput = { locationId: actor(req).locationId, ...(status ? { status } : {}), ...(search ? { OR: ['name', 'gameNumber', 'bookNumber', 'slot'].map(field => ({ [field]: { contains: search, mode: 'insensitive' } })) } : {}) };
  const [records, total] = await Promise.all([prisma.lotteryBook.findMany({ where, orderBy: [{ registeredDate: 'desc' }, { slot: 'asc' }], take: 100, skip: (page - 1) * 100 }), prisma.lotteryBook.count({ where })]);
  const settlements = records.length ? await prisma.$queryRaw<{ bookId: string; reference: string }[]>(Prisma.sql`SELECT b.id AS "bookId", t.reference FROM lottery_books b
    JOIN lottery_settlements t ON t."locationId" = b."locationId" AND t.details->'settledBookIds' ? b.id
    WHERE b.id IN (${Prisma.join(records.map(book => book.id))})`) : [];
  send(res, { records: records.map(book => ({ ...book, settlementReferences: settlements.filter(row => row.bookId === book.id).map(row => row.reference) })), pagination: { page, total, totalPages: Math.ceil(total / 100) } });
}));
router.get('/days/:date', asyncHandler(async (req: AuthRequest, res: Response) => { send(res, await getLotteryDay(actor(req).locationId, lotteryDate.parse(req.params.date))); }));
router.get('/days/:date/history', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = actor(req).locationId, businessDate = lotteryDate.parse(req.params.date);
  const day = await prisma.lotteryDay.findUnique({ where: { locationId_businessDate: { locationId, businessDate } } });
  if (!day) throw new AppError('Lottery day not found', 404);
  const [events, earnings] = await Promise.all([
    prisma.lotteryAuditEvent.findMany({ where: { locationId, dayId: day.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.lotteryEarningPosting.findMany({ where: { locationId, dayId: day.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ]);
  send(res, { events, earnings });
}));
router.get('/books/:id', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = actor(req).locationId;
  const book = await prisma.lotteryBook.findFirst({ where: { id: req.params.id, locationId } });
  if (!book) throw new AppError('Book not found', 404);
  const [counts, settlements] = await Promise.all([
    prisma.$queryRaw<(LotteryCheckpoint & { businessDate: string; dayStatus: string })[]>`SELECT c.*, d."businessDate", d.status AS "dayStatus"
      FROM lottery_checkpoints c JOIN lottery_days d ON d.id = c."dayId"
      WHERE c."bookId" = ${book.id} AND d."locationId" = ${locationId} ORDER BY d."businessDate" DESC LIMIT 100`,
    prisma.$queryRaw<{ id: string; reference: string; periodStart: string; periodEnd: string }[]>`SELECT id, reference, "periodStart", "periodEnd" FROM lottery_settlements
      WHERE "locationId" = ${locationId} AND details->'settledBookIds' ? ${book.id} ORDER BY "periodEnd" DESC LIMIT 100`,
  ]);
  send(res, { book, counts: counts.map(row => ({ ...row, openingTicket: nextTicketNumber(book, row.openingPosition), closingTicket: row.closingPosition === null ? null : nextTicketNumber(book, row.closingPosition) })), settlements });
}));
router.post('/days/:date/open', entryRoles, asyncHandler(async (req: AuthRequest, res: Response) => {
  const input = mutation.strict().parse(req.body), who = actor(req), date = lotteryDate.parse(req.params.date);
  send(res, await lotteryOperation(who, 'LOTTERY_OPEN', { ...input, date }, tx => openLotteryDay(tx, who, date, input.expectedVersion)));
}));
router.post('/days/:date/entry', entryRoles, asyncHandler(async (req: AuthRequest, res: Response) => {
  const input = mutation.strict().parse(req.body), who = actor(req), date = lotteryDate.parse(req.params.date);
  send(res, await lotteryOperation(who, 'LOTTERY_ENTRY', { ...input, date }, tx => openSimpleLotteryDay(tx, who, date, input.expectedVersion)));
}));
router.post('/days/:date/report', entryRoles, asyncHandler(async (req: AuthRequest, res: Response) => {
  const input = mutation.extend({ report: lotteryReportSchema }).strict().parse(req.body), who = actor(req), date = lotteryDate.parse(req.params.date);
  send(res, await lotteryOperation(who, 'LOTTERY_REPORT', { ...input, date }, tx => saveLotteryReport(tx, who, date, input.expectedVersion, input.report)));
}));
router.post('/days/:date/books', manageRoles, asyncHandler(async (req: AuthRequest, res: Response) => {
  const input = mutation.extend({ book: lotteryBookSchema, depletedBookId: z.string().optional() }).strict().parse(req.body), who = actor(req), date = lotteryDate.parse(req.params.date);
  send(res, await lotteryOperation(who, 'LOTTERY_BOOK', { ...input, date }, tx => addLotteryBook(tx, who, date, input.expectedVersion, input.book, input.depletedBookId)));
}));
router.post('/days/:date/scan-preview', entryRoles, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { raw } = z.object({ raw: z.string().min(1).max(100) }).strict().parse(req.body);
  send(res, await previewLotteryScan(actor(req).locationId, lotteryDate.parse(req.params.date), raw));
}));
router.post('/days/:date/checkpoint', entryRoles, asyncHandler(async (req: AuthRequest, res: Response) => {
  const input = mutation.extend({ bookId: z.string().min(1), nextTicket: z.number().int().nonnegative().optional(), raw: z.string().min(1).max(100).optional(), opening: z.boolean().optional(),
    soldOut: z.boolean().optional(), resetOpening: z.boolean().optional(), disposition: z.enum(['ACTIVE', 'PAUSED', 'RETURNED', 'LOST']).optional(), slot: z.string().trim().min(1).max(80).optional(),
    lossQuantity: z.number().int().nonnegative().optional(), reason: z.string().trim().min(3).max(2000).optional() }).strict().parse(req.body);
  const who = actor(req), date = lotteryDate.parse(req.params.date);
  send(res, await lotteryOperation(who, 'LOTTERY_CHECKPOINT', { ...input, date }, tx => checkpointLotteryBook(tx, who, date, input.expectedVersion, input)));
}));
router.post('/days/:date/close', manageRoles, asyncHandler(async (req: AuthRequest, res: Response) => {
  const input = mutation.strict().parse(req.body), who = actor(req), date = lotteryDate.parse(req.params.date);
  send(res, await lotteryOperation(who, 'LOTTERY_CLOSE', { ...input, date }, tx => closeLotteryDay(tx, who, date, input.expectedVersion)));
}));
router.post('/days/:date/reopen', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const input = mutation.extend({ reason: z.string().trim().min(3).max(2000) }).strict().parse(req.body), who = actor(req), date = lotteryDate.parse(req.params.date);
  send(res, await lotteryOperation(who, 'LOTTERY_REOPEN', { ...input, date }, tx => reopenLotteryDay(tx, who, date, input.expectedVersion, input.reason)));
}));
router.post('/days/:date/correction', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const input = mutation.extend({ correction: lotteryCorrectionSchema }).strict().parse(req.body), who = actor(req), date = lotteryDate.parse(req.params.date);
  send(res, await lotteryOperation(who, 'LOTTERY_CORRECTION', { ...input, date }, tx => correctLotteryDay(tx, who, date, input.expectedVersion, input.correction)));
}));
router.get('/settlements', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  send(res, await prisma.lotterySettlement.findMany({ where: { locationId: actor(req).locationId }, orderBy: { periodEnd: 'desc' }, take: 100 }));
}));
router.post('/settlements', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const input = mutation.extend({ settlement: lotterySettlementSchema }).strict().parse(req.body), who = actor(req);
  send(res, await lotteryOperation(who, 'LOTTERY_SETTLEMENT', input, tx => saveLotterySettlement(tx, who, input.settlement, input.expectedVersion)));
}));
router.get('/reports', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = actor(req).locationId, start = lotteryDate.parse(req.query.start), end = lotteryDate.parse(req.query.end);
  if (end < start || (Date.parse(end) - Date.parse(start)) / 86400000 > 366) throw new AppError('Select a reporting period of up to one year', 400);
  const store = await prisma.location.findUniqueOrThrow({ where: { id: locationId }, select: { timezone: true } });
  const calendar = reportCalendar(store.timezone);
  const endExclusive = new Date(end + 'T12:00:00Z'); endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const [days, events, settlements, earnings, corrections] = await Promise.all([
    prisma.lotteryDay.findMany({ where: { locationId, businessDate: { gte: start, lte: end } }, orderBy: { businessDate: 'asc' } }),
    prisma.lotteryAuditEvent.findMany({ where: { locationId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.lotterySettlement.findMany({ where: { locationId, periodEnd: { gte: start, lte: end } }, orderBy: { periodEnd: 'asc' } }),
    prisma.lotteryEarningPosting.findMany({ where: { locationId, recognizedAt: { gte: parseReportDate(calendar, start).date, lt: parseReportDate(calendar, endExclusive.toISOString().slice(0, 10)).date } }, orderBy: { recognizedAt: 'asc' } }),
    prisma.$queryRaw<LotteryAuditEvent[]>`SELECT * FROM lottery_audit_events WHERE "locationId" = ${locationId} AND action = 'CORRECTION'
      AND details->>'postingDate' >= ${start} AND details->>'postingDate' <= ${end} ORDER BY "createdAt"`,
  ]);
  const coverage = await prisma.lotterySettlement.findMany({ where: { locationId, periodStart: { lte: end }, periodEnd: { gte: start } }, select: { periodStart: true, periodEnd: true } });
  send(res, { days: days.map(day => ({ ...day, earningsPending: day.status !== 'CLOSED' || (day.earningsIncomplete && !coverage.some(period => period.periodStart <= day.businessDate && period.periodEnd >= day.businessDate)) })), events, settlements, earnings, corrections });
}));
export default router;
