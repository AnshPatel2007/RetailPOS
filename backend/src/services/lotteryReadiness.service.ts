import type { LotteryReport, LotterySettings } from '../validators/lotteryV2.validator';
import type { LotteryCount, lotteryDayTotals } from './lotteryMath.service';

export type LotteryStage = 'scratch' | 'online' | 'reconcile';
export interface LotteryIssue {
  stage: LotteryStage;
  field: string;
  message: string;
  blocking: boolean;
  bookId?: string;
  sourceId?: string;
}
export interface LotteryReadiness {
  stages: Record<LotteryStage, { complete: boolean; remaining: number }>;
  books: { counted: number; total: number };
  issues: LotteryIssue[];
  canClose: boolean;
}

/** Navigation metadata only. Monetary calculations and closing rules stay in the lottery services. */
export function lotteryReadiness(settings: LotterySettings, report: LotteryReport,
  books: (LotteryCount & { bookId: string; slot: string })[], totals: ReturnType<typeof lotteryDayTotals>): LotteryReadiness {
  const issues: LotteryIssue[] = [];
  const add = (stage: LotteryStage, field: string, message: string, blocking = true, reference: Partial<LotteryIssue> = {}) =>
    issues.push({ stage, field, message, blocking, ...reference });
  if (report.rackCounts) {
    if (!report.rackCounts.length) add('scratch', 'setup', 'Add your rack games in Ticket Setup');
    for (const row of report.rackCounts) if (row.closingNumber === null) add('scratch', 'rack-' + row.id, 'Enter closing number for Bin ' + row.bin);
  }
  if (['MANUAL', 'BOTH'].includes(settings.mode) && !report.rackCounts && !books.length && report.noBooksReason.trim().length < 3) {
    add('scratch', 'noBooksReason', 'Add books or explain the empty rack');
  }
  for (const book of report.rackCounts ? [] : books) {
    if (!book.openingVerified || book.closingPosition === null) add('scratch', 'book-' + book.bookId,
      `${book.openingVerified ? 'Count' : 'Verify opening for'} Bin ${book.slot}`, true, { bookId: book.bookId });
  }
  for (const source of report.dispensers) {
    const name = settings.dispensers.find(item => item.id === source.sourceId)?.name || 'Dispenser';
    for (const [field, label] of [['reference', 'report reference'], ['grossSales', 'sales'], ['cancellations', 'cancellations']] as const) {
      if (source[field] === null || source[field] === '') add('scratch', `dispenser-${source.sourceId}-${field}`, `Enter ${name} ${label}`, true, { sourceId: source.sourceId });
    }
  }
  if (!report.reference.trim()) add('online', 'reference', 'Enter the terminal report reference');
  const terminal = [['onlineGross', 'online sales'], ['onlineCancels', 'cancellations'], ['drawPayouts', 'draw-game payouts'],
    ['fastPlayPayouts', 'FastPlay payouts'], ['scratchPayouts', 'scratch payouts'], ['onlinePromotions', 'online promotions'],
    ['scratchPromotions', 'scratch promotions'], ['onlineNoncash', 'online noncash sales'], ['scratchNoncash', 'scratch noncash sales'],
    ['collectionAdjustment', 'cash adjustments']] as const;
  for (const [field, label] of terminal) if (report[field] === null) add('online', field, `Enter ${label}`);
  const explained = report.exceptionReason.trim().length >= 3;
  const cash = [['openingCash', 'opening cash'], ['countedCash', 'counted closing cash'], ['cashAdded', 'cash added'], ['cashRemoved', 'cash removed'],
    ...(settings.cashMode === 'SHARED' ? [['nonLotteryNetCash', 'non-lottery cash'] as const] : [])] as const;
  for (const [field, label] of settings.workflow === 'SIMPLE' ? [] : cash) if (report[field] === null) add('reconcile', field, `Enter ${label} or explain the difference`, !explained);
  if (settings.workflow !== 'SIMPLE' && totals.cashVariance !== null && Number(totals.cashVariance) !== 0) add('reconcile', 'exceptionReason', 'Review the cash difference', !explained);
  if (!totals.earningsComplete) add('reconcile', 'onlineCommission', 'Review pending lottery earnings', false);
  const stages = Object.fromEntries((['scratch', 'online', 'reconcile'] as const).map(stage => {
    const remaining = issues.filter(issue => issue.stage === stage && issue.blocking).length;
    return [stage, { complete: remaining === 0, remaining }];
  })) as LotteryReadiness['stages'];
  return { stages, books: { counted: books.filter(book => book.openingVerified && book.closingPosition !== null).length, total: books.length },
    issues, canClose: !issues.some(issue => issue.blocking) };
}
