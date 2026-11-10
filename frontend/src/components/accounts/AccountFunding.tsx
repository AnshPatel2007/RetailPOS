import { Select } from '@/components/ui/Select';
import { useId } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, formatDateTime, formatEnumLabel } from '@/lib/utils';
import { useAccountOperation } from '@/hooks/useAccountOperation';
import toast from 'react-hot-toast';

export type FundingMethod = 'CASH' | 'CARD' | 'PROMOTIONAL';
export function FundingFields({ method, setMethod, reference, setReference, reason, setReason, allowGrant = false }: {
  method: FundingMethod; setMethod: (value: FundingMethod) => void;
  reference: string; setReference: (value: string) => void;
  reason?: string; setReason?: (value: string) => void; allowGrant?: boolean;
}) {
  const id = useId();
  return <div className="space-y-3">
    <label htmlFor={id} className="block text-sm font-medium">Payment method</label>
    <Select id={id} className="w-full h-11 rounded-md border bg-background px-3" value={method} onChange={e => setMethod(e.target.value as FundingMethod)}>
      <option value="CASH">Cash</option><option value="CARD">External card terminal</option>
      {allowGrant && <option value="PROMOTIONAL">Promotional grant (no payment)</option>}
    </Select>
    {method === 'CASH' && <p className="text-sm text-muted-foreground">Record the exact cash collected. This adds to your open drawer.</p>}
    {method === 'CARD' && <>
      <Input label="Terminal approval reference" value={reference} onChange={e => setReference(e.target.value)} required maxLength={120} />
      <p className="text-sm text-muted-foreground">Record an approved payment from your separate terminal. If saving fails, retry the saved record without charging again.</p>
    </>}
    {method === 'PROMOTIONAL' && setReason && <Input label="Grant reason" value={reason || ''} onChange={e => setReason(e.target.value)} required minLength={3} maxLength={500} />}
  </div>;
}

const titles = { GIFT_ISSUE: 'Gift card issued', GIFT_RELOAD: 'Gift card reloaded', HOUSE_PAYMENT: 'House account payment', STORE_CREDIT: 'Store credit issued' };
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function AccountOperationFeedback({ operation }: { operation: ReturnType<typeof useAccountOperation> }) {
  const receipt = operation.receipt;
  const rows = receipt ? [
    ['Transaction', titles[receipt.record.kind]], ['Account', receipt.label], ['Receipt', receipt.record.id],
    ['Recorded', formatDateTime(receipt.record.createdAt)], ['Method / source', formatEnumLabel(receipt.record.paymentMethod)],
    ['Amount', formatCurrency(receipt.record.amount)], ['Balance before', formatCurrency(receipt.record.balanceBefore)],
    ['Balance after this transaction', formatCurrency(receipt.record.balanceAfter)],
    ...(receipt.record.reference ? [['Terminal reference', receipt.record.reference]] : []),
    ...(receipt.record.reason ? [['Reason / notes', receipt.record.reason]] : []),
  ] : [];
  const print = () => {
    const popup = window.open('', '_blank', 'width=450,height=700');
    if (!popup) { toast.error('Allow popups to open the receipt print preview.'); return; }
    popup.document.write(`<html><head><title>Account receipt</title><style>body{font:14px Arial;padding:24px}dt{margin-top:14px;color:#555}dd{margin:4px 0;overflow-wrap:anywhere}</style></head><body><h1>Account receipt</h1><dl>${rows.map(([label, value]) => `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join('')}</dl><p>Balances shown at the time of this transaction.</p></body></html>`);
    popup.document.close(); popup.focus(); popup.print();
  };
  return <>
    {operation.storageError && <p role="alert" className="p-4 mb-4 rounded border border-destructive">Payment recovery storage is unavailable. Restore browser storage and reconcile any saved operation before recording another payment.</p>}
    {operation.pending && <div role="status" className="p-4 mb-4 rounded border border-warning bg-warning/10 space-y-2">
      <p>{operation.busy ? 'Recording' : 'Result unconfirmed for'} {operation.pending.label}: {formatCurrency(operation.pending.payload.amount)}.</p>
      <p className="text-sm">Retry the saved operation to recover its receipt. Do not collect payment again.</p>
      <Button variant="outline" onClick={() => void operation.retry()} disabled={operation.busy}>Retry saved operation</Button>
    </div>}
    {createPortal(<Modal isOpen={!!receipt} onClose={operation.closeReceipt} title="Account receipt">
      <dl className="space-y-3">{rows.map(([label, value]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="font-medium break-words tabular-nums">{value}</dd></div>)}</dl>
      <p className="text-sm text-muted-foreground my-4">Balances shown at the time of this transaction.</p>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={operation.closeReceipt}>Done</Button><Button onClick={print}>Print receipt</Button></div>
    </Modal>, document.body)}
  </>;
}
