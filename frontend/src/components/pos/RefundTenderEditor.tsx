import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { formatCurrency } from '@/lib/utils';

import { refundTenderSelection } from '@/services/refundTenderSelection';
import type { RefundTenderOption, RefundTenderEdits } from '@/services/refundTenderSelection';
const label = (method: string) => method.replace(/_/g, ' ');

export function RefundTenderEditor({ options, amount, hasCustomer, edits, onChange, idPrefix = '' }: { options: RefundTenderOption[]; amount: number; hasCustomer: boolean;
  edits: RefundTenderEdits; onChange: (edits: RefundTenderEdits) => void; idPrefix?: string }) {
  const selection = refundTenderSelection(options, amount, edits);
  return <div className="space-y-3 min-w-0">
    <p className="text-sm">Refund to the original payments. Customer store credit is an explicit alternative when a customer is linked.</p>
    {selection.rows.map((row, index) => <div key={row.sourcePaymentId} className="rounded border p-3 space-y-2">
      <p className="text-sm">Original {label(options[index].method)}{options[index].reference && options[index].method === 'GIFT_CARD' ? ` ending ${options[index].reference!.slice(-4)}` : ''}: {formatCurrency(options[index].originalAmount)} · Remaining {formatCurrency(row.remainingAmount)}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Input label={`${idPrefix}Payout amount for payment ${index + 1}`} type="number" min="0" step="0.01" max={row.remainingAmount} value={row.amount}
          onChange={event => onChange({ ...edits, [row.sourcePaymentId]: { ...edits[row.sourcePaymentId], amount: event.target.value } })} />
        <label className="text-sm">{idPrefix}Refund destination for payment {index + 1}<Select className="block w-full rounded border bg-background p-2" value={row.method}
          onChange={event => onChange({ ...edits, [row.sourcePaymentId]: { ...edits[row.sourcePaymentId], method: event.target.value } })}>
          <option value={options[index].method}>{label(options[index].method)}{options[index].method === 'CARD' ? ' (external terminal)' : ''}</option>
          {hasCustomer && options[index].method !== 'STORE_CREDIT' && <option value="STORE_CREDIT">Customer store credit</option>}
        </Select></label>
      </div>
      {row.method === 'CARD' && Number(row.amount) > 0 && <><p className="text-sm text-muted-foreground">Complete this amount on the original card terminal once. Saving or retrying this POS record does not contact the terminal.</p>
        <Input label={`${idPrefix}Terminal refund reference for payment ${index + 1}`} value={row.reference} maxLength={150}
          onChange={event => onChange({ ...edits, [row.sourcePaymentId]: { ...edits[row.sourcePaymentId], reference: event.target.value } })} /></>}
    </div>)}
    {amount === 0 && <p className="text-sm">No money is paid for this return.</p>}
    {amount > 0 && selection.invalid && <p role="alert" className="text-sm text-destructive">Review tender amounts and terminal references. Payments must total {formatCurrency(amount)} and stay within their remaining balances.</p>}
  </div>;
}
