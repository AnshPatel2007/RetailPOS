import type { LotteryReport } from './lotteryWorkbench';

export interface LotteryDraft { version: number; report: LotteryReport; base?: LotteryReport }
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
export const sameLotteryReport = (first: LotteryReport, second: LotteryReport) => JSON.stringify(canonical(first)) === JSON.stringify(canonical(second));

/** A count-only revision may advance the report base. Another person's report edit never does. */
export function reconcileLotteryDraft(draft: LotteryDraft, saved: { version: number; report: LotteryReport }, submitted?: LotteryReport): LotteryDraft | null {
  if (submitted && sameLotteryReport(draft.report, submitted)) return null;
  if (saved.version < draft.version) return draft;
  if (submitted || (draft.base && sameLotteryReport(draft.base, saved.report)) || draft.version === saved.version) {
    return { ...draft, version: saved.version, base: saved.report };
  }
  return draft;
}
