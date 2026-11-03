import { Prisma } from '@prisma/client';
import { AppError } from '../utils/errorHandler';
import { LotteryRack, LotteryReport } from '../validators/lotteryV2.validator';

export function rackPosition(row: Pick<LotteryRack, 'firstTicket' | 'lastTicket' | 'direction'>, number: number) {
  return row.direction === 'ASC' ? number - row.firstTicket : row.lastTicket - number;
}
export function rackTicketsSold(row: LotteryRack) {
  if (row.closingNumber === null) return null;
  const length = row.lastTicket - row.firstTicket + 1;
  const opening = rackPosition(row, row.openingNumber), closing = rackPosition(row, Number(row.closingNumber));
  if (length <= 0 || opening < 0 || opening > length || closing < 0 || closing > length) throw new AppError('Closing number is outside the ticket range for Bin ' + row.bin, 400);
  const sold = row.finishedRolls * length + closing - opening - row.lossQuantity;
  if (sold < 0) throw new AppError('Closing number is before opening in Bin ' + row.bin + '. Use New roll if the roll was replaced.', 400);
  return sold;
}
export function validateRackChanges(saved: LotteryReport, incoming: LotteryReport) {
  if (!saved.rackCounts && !incoming.rackCounts) return;
  if (!saved.rackCounts || !incoming.rackCounts || saved.rackCounts.length !== incoming.rackCounts.length) throw new AppError('Reload the rack before saving its counts', 409);
  const fixed = ({ closingNumber: _closing, finishedRolls: _rolls, ...row }: LotteryRack) => row;
  for (const row of incoming.rackCounts) {
    const previous = saved.rackCounts.find(item => item.id === row.id);
    if (!previous || Object.keys(fixed(previous)).some(key => previous[key as keyof LotteryRack] !== row[key as keyof LotteryRack])) throw new AppError('Opening numbers and game details are fixed for this day', 409);
    rackTicketsSold(row);
  }
  if (new Set(incoming.rackCounts.map(row => row.id)).size !== incoming.rackCounts.length) throw new AppError('Enter each bin once', 400);
}
export async function buildRackRows(tx: Prisma.TransactionClient, locationId: string, date: string): Promise<LotteryRack[]> {
  const games = await tx.lotteryTicketType.findMany({ where: { locationId, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { ticketName: 'asc' }] });
  const carried = await tx.$queryRaw<{ row: LotteryRack }[]>`SELECT DISTINCT ON (r->>'ticketTypeId') r AS row FROM lottery_days d
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.report->'rackCounts', '[]'::jsonb)) r
    WHERE d."locationId" = ${locationId} AND d."businessDate" < ${date} AND d.status = 'CLOSED'
    ORDER BY r->>'ticketTypeId', d."businessDate" DESC`;
  const books = await tx.lotteryBook.findMany({ where: { locationId, status: { in: ['ACTIVE', 'PAUSED', 'DEPLETED'] } }, orderBy: { updatedAt: 'desc' } });
  return games.map(game => {
    const prior = carried.find(item => item.row.ticketTypeId === game.id)?.row;
    if ((!game.binNumber && !prior?.bin) || (game.startingNumber === null && !prior) || game.gameNumber === null || game.firstTicket === null || game.lastTicket === null) throw new AppError('Set the bin, ticket range and starting number for ' + game.ticketName + ' in Ticket Setup.', 400);
    const oldBook = books.find(book => book.ticketTypeId === game.id && book.slot === game.binNumber);
    const openingNumber = prior?.closingNumber !== null && prior?.closingNumber !== undefined ? Number(prior.closingNumber) :
      oldBook ? oldBook.direction === 'ASC' ? oldBook.firstTicket + oldBook.position : oldBook.lastTicket - oldBook.position : game.startingNumber!;
    const row: LotteryRack = { id: game.id, ticketTypeId: game.id, bin: game.binNumber || prior!.bin, name: game.ticketName, gameNumber: game.gameNumber!,
      price: game.pricePerTicket.toFixed(2), firstTicket: game.firstTicket!, lastTicket: game.lastTicket!, direction: game.countDirection === 'DESC' ? 'DESC' : 'ASC',
      openingNumber, closingNumber: null, finishedRolls: 0, lossQuantity: 0 };
    if (rackPosition(row, openingNumber) < 0 || rackPosition(row, openingNumber) > row.lastTicket - row.firstTicket + 1) throw new AppError('The carried number is outside the configured range for Bin ' + row.bin + '. Correct the game range in Ticket Setup.', 409);
    return row;
  });
}
export function simpleReport(report: LotteryReport, date: string, rackCounts?: LotteryRack[]): LotteryReport {
  return { ...report, reference: report.reference || date,
    onlinePromotions: report.onlinePromotions ?? '0', scratchPromotions: report.scratchPromotions ?? '0',
    onlineNoncash: report.onlineNoncash ?? '0', scratchNoncash: report.scratchNoncash ?? '0',
    collectionAdjustment: report.collectionAdjustment ?? '0', earningsAdjustment: report.earningsAdjustment ?? '0',
    cashingBonus: report.cashingBonus ?? '0', sellingBonus: report.sellingBonus ?? '0', fees: report.fees ?? '0',
    dispensers: report.dispensers.map(source => ({ ...source, reference: source.reference || date, cancellations: source.cancellations ?? '0' })),
    ...(rackCounts ? { rackCounts } : {}),
  };
}
