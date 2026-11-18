import { formatCurrency } from '@/lib/utils';
import { api } from './api';
import { z } from 'zod';
import { lotteryReportSchema, lotteryRackSchema } from '../../../backend/src/validators/lotteryV2.validator';
export type { LotteryRack } from '../../../backend/src/validators/lotteryV2.validator';
export type { LotterySettings, LotteryReport, LotteryBookInput, LotterySettlementInput, LotteryCorrectionInput, BarcodeProfile } from '../../../backend/src/validators/lotteryV2.validator';
import type { LotterySettings, LotteryReport, LotterySettlementInput } from '../../../backend/src/validators/lotteryV2.validator';
import type { LotteryReadiness } from '../../../backend/src/services/lotteryReadiness.service';
export type { LotteryReadiness, LotteryIssue, LotteryStage } from '../../../backend/src/services/lotteryReadiness.service';

export interface LotteryGame { id: string; ticketName: string; ticketCode: string; gameNumber: string | null; firstTicket: number | null; lastTicket: number | null; binNumber: string | null; startingNumber: number | null; countDirection: 'ASC' | 'DESC'; pricePerTicket: string | number; isActive: boolean; updatedAt: string }
export interface LotteryBook { id: string; ticketTypeId: string; name: string; gameNumber: string; bookNumber: string; slot: string; direction: 'ASC' | 'DESC'; firstTicket: number; lastTicket: number; ticketCount: number; price: string; position: number; status: string; registeredDate: string; settlementReferences?: string[] }
export interface LotteryCheckpoint { id: string; bookId: string; book: LotteryBook; openingPosition: number; closingPosition: number | null; openingVerified: boolean; openingTicket: string | null; closingTicket: string | null; disposition: string; lossQuantity: number; reason: string | null; slot: string }
export interface LotteryTotals { manualTickets: number | null; manualSales: string | null; dispenserSales: string | null; totalScratchTickets: number | null; scratchSales: string | null; onlineSales: string | null; payouts: string | null; netCollections: string | null; netCash: string | null; expectedCash: string | null; cashVariance: string | null; recordedEarnings: string; earnings: string | null; earningsComplete: boolean; cashComplete: boolean; problems: string[] }
export interface LotteryDay { configured: boolean; upcomingDate?: string; businessDate: string; id: string | null; status: 'DRAFT' | 'CLOSED'; version: number; configuration: LotterySettings; report: LotteryReport; checkpoints: LotteryCheckpoint[]; totals: LotteryTotals | null; readiness?: LotteryReadiness; canReopen: boolean; earningsIncomplete?: boolean; earningsPending?: boolean; earningsSettlement?: { id: string; reference: string; periodStart: string; periodEnd: string } | null }
export interface LotteryConfigVersion { id: string; effectiveDate: string; settings: LotterySettings; createdAt: string }
export interface LotteryConfiguration { versions: LotteryConfigVersion[]; latestId: string | null }
export interface LotterySettlement { id: string; periodStart: string; periodEnd: string; reference: string; details: LotterySettlementInput; version: number; reportedEarnings: string }
export interface LotteryEvent { id: string; action: string; dayId: string | null; createdAt: string; details: Record<string, unknown> }
export interface LotteryReports { days: LotteryDay[]; events: LotteryEvent[]; settlements: LotterySettlement[]; corrections: LotteryEvent[]; earnings: { id: string; dayId: string | null; settlementId: string | null; recognizedAt: string; amount: string; reason: string }[] }
export const lotteryRead = async <T>(path: string, locationId: string, signal?: AbortSignal, params?: Record<string, unknown>): Promise<T> =>
  (await api.get('/lottery/v2' + path, { params: { ...params, locationId }, signal })).data.data;
export const lotteryMoney = (value: string | number | null | undefined) => value == null ? 'Pending' : formatCurrency(Number(value));
export const manualLottery = (settings: LotterySettings) => ['MANUAL', 'BOTH'].includes(settings.mode);
export const lotteryBookStatus = (status: string) => ({ ACTIVE: 'On rack', PAUSED: 'Paused', DEPLETED: 'Sold out', RETURNED: 'Returned', LOST: 'Missing / stolen' }[status] || status);
export const lotteryError = (error: unknown) => (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Unable to complete this request. Your draft is retained.';

// Drafts can contain unfinished amounts and game rows. Validate their shape without
// treating an unfinished input as corrupted browser storage.
const draftAmount = z.string().max(32).nullable();
export const lotteryDraftReportSchema = lotteryReportSchema.extend({
  rackCounts: z.array(lotteryRackSchema.extend({ closingNumber: z.string().max(100).nullable() })).max(500).optional(),
  onlineGross: draftAmount, onlineCancels: draftAmount, drawPayouts: draftAmount, fastPlayPayouts: draftAmount, scratchPayouts: draftAmount,
  onlinePromotions: draftAmount, scratchPromotions: draftAmount, onlineNoncash: draftAmount, scratchNoncash: draftAmount,
  onlineCommission: draftAmount, scratchCommission: draftAmount, cashingBonus: draftAmount, sellingBonus: draftAmount, fees: draftAmount,
  collectionAdjustment: draftAmount, earningsAdjustment: draftAmount, printedOnlineBalance: draftAmount, printedInstantBalance: draftAmount,
  openingCash: draftAmount, countedCash: draftAmount, cashAdded: draftAmount, cashRemoved: draftAmount, nonLotteryNetCash: draftAmount,
  dispensers: z.array(z.object({ sourceId: z.string(), reference: z.string().max(150), grossSales: draftAmount, cancellations: draftAmount,
    games: z.array(z.object({ gameNumber: z.string().max(20), quantity: z.number().nullable(), amount: z.string().max(32) })).max(500) })).max(20),
  onlineGames: z.array(z.object({ name: z.string().max(80), amount: z.string().max(32) })).max(50),
});
