import { z } from 'zod';

export const lotteryDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value + 'T12:00:00Z'); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Enter a valid business date');
export const lotteryMoney = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'Enter a nonnegative amount with up to two decimals');
export const signedLotteryMoney = z.string().regex(/^-?\d{1,10}(\.\d{1,2})?$/);
const signedMoney = signedLotteryMoney;
const optionalMoney = lotteryMoney.nullable();
const reason = z.string().trim().min(3).max(2000);
const numberCode = z.string().regex(/^\d{1,20}$/);
export const retryKey = z.string().uuid();
export const version = z.number().int().nonnegative();
export const barcodeProfileSchema = z.object({
  gameDigits: z.number().int().min(1).max(6), bookDigits: z.number().int().min(1).max(12), ticketDigits: z.number().int().min(1).max(6),
  prefixDigits: z.number().int().min(0).max(4), suffixDigits: z.number().int().min(0).max(4),
  evidence: reason,
  samples: z.array(z.object({ raw: z.string().max(100), game: numberCode, book: numberCode, ticket: numberCode }).strict()).length(2),
}).strict();
export const lotterySettingsSchema = z.object({
  mode: z.enum(['DISABLED', 'MANUAL', 'DISPENSER', 'BOTH']), cashMode: z.enum(['SHARED', 'SEPARATE']),
  dispensers: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/), name: z.string().trim().min(1).max(80) }).strict()).max(20),
  barcodeProfile: barcodeProfileSchema.nullable(), pilotEvidence: z.string().max(2000).default(''),
  workflow: z.enum(['BOOKS', 'SIMPLE']).optional(),
}).strict().superRefine((settings, context) => {
  const usesMachine = ['DISPENSER', 'BOTH'].includes(settings.mode);
  if (usesMachine !== (settings.dispensers.length > 0)) context.addIssue({ code: 'custom', path: ['dispensers'], message: 'Configure dispensers only for a dispenser or mixed store' });
  if (new Set(settings.dispensers.map(d => d.id)).size !== settings.dispensers.length) context.addIssue({ code: 'custom', message: 'Each dispenser needs a unique identifier' });
});
export const lotteryGameSchema = z.object({
  ticketName: z.string().trim().min(1).max(150), ticketCode: z.string().trim().min(1).max(50), gameNumber: numberCode,
  pricePerTicket: lotteryMoney.refine(value => Number(value) > 0), firstTicket: z.number().int().min(0).max(999999),
  lastTicket: z.number().int().min(0).max(999999), isActive: z.boolean(),
  binNumber: z.string().trim().min(1).max(80).nullable().optional(),
  startingNumber: z.number().int().nonnegative().nullable().optional(),
  countDirection: z.enum(['ASC', 'DESC']).optional(),
}).strict().refine(value => value.lastTicket >= value.firstTicket && value.lastTicket - value.firstTicket < 10000, 'Check the book ticket range');
export const lotteryRackSchema = z.object({
  id: z.string().min(1), ticketTypeId: z.string().min(1), bin: z.string().min(1).max(80), name: z.string().max(150),
  gameNumber: numberCode, price: lotteryMoney, firstTicket: z.number().int(), lastTicket: z.number().int(),
  direction: z.enum(['ASC', 'DESC']), openingNumber: z.number().int(), closingNumber: z.string().regex(/^-?\d{1,6}$/).nullable(),
  finishedRolls: z.number().int().min(0).max(100), lossQuantity: z.number().int().nonnegative().default(0),
}).strict();
export type LotteryRack = z.infer<typeof lotteryRackSchema>;
export const lotteryBookSchema = z.object({
  ticketTypeId: z.string().min(1), bookNumber: numberCode, slot: z.string().trim().min(1).max(80),
  direction: z.enum(['ASC', 'DESC']), nextTicket: z.number().int().nonnegative(), evidence: reason,
}).strict();
export const lotteryReportSchema = z.object({
  reference: z.string().trim().max(150),
  onlineGross: optionalMoney, onlineCancels: optionalMoney, drawPayouts: optionalMoney, fastPlayPayouts: optionalMoney, scratchPayouts: optionalMoney,
  onlinePromotions: optionalMoney, scratchPromotions: optionalMoney, onlineNoncash: optionalMoney, scratchNoncash: optionalMoney,
  onlineCommission: optionalMoney, scratchCommission: optionalMoney, cashingBonus: optionalMoney, sellingBonus: optionalMoney, fees: optionalMoney,
  collectionAdjustment: signedMoney.nullable(), earningsAdjustment: signedMoney.nullable(), adjustmentReason: z.string().trim().max(2000),
  printedOnlineBalance: signedMoney.nullable(), printedInstantBalance: signedMoney.nullable(),
  dispensers: z.array(z.object({ sourceId: z.string().max(40), reference: z.string().trim().max(150), grossSales: optionalMoney, cancellations: optionalMoney,
    games: z.array(z.object({ gameNumber: numberCode, quantity: z.number().int().nonnegative().nullable(), amount: lotteryMoney }).strict()).max(500),
  }).strict()).max(20),
  onlineGames: z.array(z.object({ name: z.string().trim().min(1).max(80), amount: lotteryMoney }).strict()).max(50),
  openingCash: optionalMoney, countedCash: optionalMoney, cashAdded: optionalMoney, cashRemoved: optionalMoney, nonLotteryNetCash: signedMoney.nullable(),
  exceptionReason: z.string().trim().max(2000), noBooksReason: z.string().trim().max(2000), notes: z.string().max(2000),
  rackCounts: z.array(lotteryRackSchema).max(500).optional(),
}).strict();
export const lotterySettlementSchema = z.object({
  periodStart: lotteryDate, periodEnd: lotteryDate, reference: z.string().trim().min(1).max(150),
  onlineCommission: lotteryMoney, scratchCommission: lotteryMoney, cashingBonus: lotteryMoney, sellingBonus: lotteryMoney, fees: lotteryMoney,
  earningsAdjustment: signedMoney, settledBookValue: lotteryMoney, returnedBookValue: lotteryMoney, lotteryAdjustments: signedMoney,
  netDue: signedMoney, bankSweep: signedMoney.nullable(), reason,
  settledBookIds: z.array(z.string().min(1)).max(500),
}).strict().refine(value => value.periodEnd >= value.periodStart, 'Period end must follow its start');
export type LotterySettings = z.infer<typeof lotterySettingsSchema>;
export type LotteryReport = z.infer<typeof lotteryReportSchema>;
export type LotteryBookInput = z.infer<typeof lotteryBookSchema>;
export type BarcodeProfile = z.infer<typeof barcodeProfileSchema>;
export type LotterySettlementInput = z.infer<typeof lotterySettlementSchema>;
export const lotteryCorrectionSchema = z.object({
  scratchSales: signedMoney, onlineSales: signedMoney, payouts: signedMoney, netCollections: signedMoney, netCash: signedMoney,
  earnings: signedMoney, tickets: z.number().int().min(-1000000).max(1000000).nullable(), reason,
  reference: z.string().trim().min(1).max(150),
}).strict();
export type LotteryCorrectionInput = z.infer<typeof lotteryCorrectionSchema>;
export function emptyLotteryReport(settings: LotterySettings): LotteryReport {
  return { reference: '', onlineGross: null, onlineCancels: null, drawPayouts: null, fastPlayPayouts: null, scratchPayouts: null,
    onlinePromotions: null, scratchPromotions: null, onlineNoncash: null, scratchNoncash: null,
    onlineCommission: null, scratchCommission: null, cashingBonus: null, sellingBonus: null, fees: null,
    collectionAdjustment: null, earningsAdjustment: null, adjustmentReason: '', printedOnlineBalance: null, printedInstantBalance: null,
    dispensers: settings.dispensers.map(source => ({ sourceId: source.id, reference: '', grossSales: null, cancellations: null, games: [] })), onlineGames: [],
    openingCash: null, countedCash: null, cashAdded: null, cashRemoved: null, nonLotteryNetCash: null, exceptionReason: '', noBooksReason: '', notes: '' };
}
