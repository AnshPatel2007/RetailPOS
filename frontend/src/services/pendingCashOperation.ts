export interface PendingCashOperation {
  saleId?: string;
  label: string;
  amount: number;
  externalReversal?: boolean;
  payload: Record<string, unknown> & { idempotencyKey: string };
}

export const cashOperationKey = (kind: 'refund' | 'movement' | 'void', userId?: string, locationId?: string | null) =>
  `pos-pending-${kind}:${locationId || ''}:${userId || ''}`;

export function readCashOperation(key: string): PendingCashOperation | null {
  const saved = localStorage.getItem(key);
  if (!saved) return null;
  try { return JSON.parse(saved) as PendingCashOperation; }
  catch { throw new Error('The saved cash operation could not be read. Ask a manager to reconcile it before continuing.'); }
}

// Keep uncertain requests across reload/logout, partitioned by store and actor.
// A definitive rejection rolls back the POS transaction. Separately recorded
// terminal refunds still need their evidence retained even after that rejection.
export function cashOperationRejected(error: unknown): boolean {
  const response = (error as { response?: { status?: number; data?: { retrySameRequest?: boolean } } })?.response;
  if (response?.data?.retrySameRequest) return false;
  const status = response?.status;
  return !!status && [400, 403, 404, 409, 422, 428].includes(status);
}

export function hasExternalRefundEvidence(payload: Record<string, unknown>): boolean {
  const rowHasEvidence = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    const positive = (amount: unknown) => typeof amount === 'number' && Number.isFinite(amount) && amount > 0;
    const reference = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
    if (Array.isArray(row.refundTenders) && row.refundTenders.some(part => {
      if (!part || typeof part !== 'object') return false;
      return part.method === 'CARD' && positive(part.amount) && reference(part.reference);
    })) return true;
    const amount = row.expectedAmount ?? row.amount;
    return row.refundMethod === 'CARD' && (amount === undefined || positive(amount)) && reference(row.reference);
  };
  return rowHasEvidence(payload) || (Array.isArray(payload.sales) && payload.sales.some(rowHasEvidence));
}
