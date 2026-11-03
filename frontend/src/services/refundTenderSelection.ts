export type RefundTenderOption = { sourcePaymentId: string; method: string; reference?: string; originalAmount: number; remainingAmount: number };
export type RefundTenderEdits = Record<string, { amount?: string; method?: string; reference?: string }>;
export type RefundTenderInput = { sourcePaymentId: string; method: string; amount: number; reference?: string };

export function refundTenderSelection(options: RefundTenderOption[], amount: number, edits: RefundTenderEdits) {
  const capacities = options.map(option => Math.max(0, Math.round(option.remainingAmount * 100)));
  const validAmount = Number.isFinite(amount) && amount >= 0 && Number.isSafeInteger(Math.round(amount * 100));
  const total = capacities.reduce((sum, value) => sum + value, 0), target = validAmount ? Math.round(amount * 100) : 0;
  const shares = capacities.map((capacity, index) => ({ index, amount: total ? Number(BigInt(target) * BigInt(capacity) / BigInt(total)) : 0,
    remainder: total ? BigInt(target) * BigInt(capacity) % BigInt(total) : BigInt(0) }));
  let leftover = target - shares.reduce((sum, row) => sum + row.amount, 0);
  for (const row of [...shares].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) {
    if (leftover > 0 && row.amount < capacities[row.index]) { row.amount++; leftover--; }
  }
  const allocations = shares.map(row => row.amount);
  const rows = options.map((option, index) => ({ ...option, method: edits[option.sourcePaymentId]?.method || option.method,
    amount: edits[option.sourcePaymentId]?.amount ?? (allocations[index] / 100).toFixed(2), reference: edits[option.sourcePaymentId]?.reference || '' }));
  const tenderTotal = rows.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0);
  const invalid = !validAmount || !Number.isFinite(tenderTotal) || tenderTotal !== target || rows.some(row => !Number.isFinite(Number(row.amount)) || Number(row.amount) < 0
    || Math.abs(Number(row.amount) * 100 - Math.round(Number(row.amount) * 100)) > 0.00001 || Number(row.amount) > row.remainingAmount
    || Number(row.amount) > 0 && (row.method === 'CARD' && !row.reference.trim() || !['CASH', 'CARD', 'GIFT_CARD', 'STORE_CREDIT', 'HOUSE_ACCOUNT'].includes(row.method)));
  const tenders: RefundTenderInput[] = rows.filter(row => Number(row.amount) > 0).map(row => ({ sourcePaymentId: row.sourcePaymentId,
    method: row.method, amount: Number(row.amount), ...(row.method === 'CARD' ? { reference: row.reference.trim() } : {}) }));
  return { rows, tenders, invalid, tenderTotal: tenderTotal / 100 };
}

