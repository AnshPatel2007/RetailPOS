import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { OperationRecovery } from '@/components/common/OperationRecovery';
import { useSavedOperation } from '@/hooks/useSavedOperation';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { useAuthStore } from '@/store/authStore';
import { can } from '@/lib/capabilities';
import { formatCurrency } from '@/lib/utils';
import { saleService } from '@/services/api';
import type { Sale } from '@/types';
import { RefundTenderEditor } from '@/components/pos/RefundTenderEditor';
import { refundTenderSelection, RefundTenderEdits } from '@/services/refundTenderSelection';

export function BulkRefundActions({ selectedSales, onSuccess }: { selectedSales: Sale[]; onSuccess: () => void }) {
  const user = useAuthStore(state => state.user), allowed = can(user?.role, 'sale.reverse');
  const [open, setOpen] = useState(false), [ids, setIds] = useState<string[]>([]), [reason, setReason] = useState('');
  const [edits, setEdits] = useState<Record<string, RefundTenderEdits>>({});
  const [, refreshRecovery] = useState(0);
  useEffect(() => {
    const changed = () => refreshRecovery(value => value + 1);
    window.addEventListener('pos-reversal-recovery', changed); window.addEventListener('storage', changed);
    return () => { window.removeEventListener('pos-reversal-recovery', changed); window.removeEventListener('storage', changed); };
  }, []);
  const operation = useSavedOperation('bulk-refund', '/sales/bulk-refund', () => { setOpen(false); setReason(''); setEdits({}); onSuccess(); });
  const query = useScopedQuery<any[]>(['bulk-refund-preview', ids], signal => saleService.previewBulkRefund(ids, signal).then(response => response.data.data), allowed && open && !operation.pending && ids.length > 0, 0);
  if (!allowed) return null;
  const rows = query.data?.map(row => ({ ...row, selection: refundTenderSelection(row.refundTenderOptions || [], row.expectedAmount, edits[row.id] || {}) })) || [];
  const blockedByVoid = (() => { try { return !!localStorage.getItem(`pos-pending-void:${user?.locationId}:${user?.id}`) || !!localStorage.getItem(`pos-pending-bulk-void:${user?.locationId}:${user?.id}`); } catch { return true; } })();
  return <div className="mb-4 space-y-3">
    {(selectedSales.length > 0 || operation.pending) && <Button size="sm" variant="outline" disabled={operation.busy || operation.storageError || blockedByVoid || (!operation.pending && selectedSales.length > 50)} onClick={() => { setIds(selectedSales.map(sale => sale.id).sort()); setEdits({}); setOpen(true); }}>{operation.pending ? 'Review saved bulk refund' : 'Refund Selected'}</Button>}
    <OperationRecovery operation={operation} />
    <Modal isOpen={open} onClose={() => { if (!operation.busy) setOpen(false); }} title="Refund Selected Sales" size="lg">
      <div className="space-y-4">
        <p>Return the remaining balance and inventory for every selected sale. Earlier returns remain in history. The entire batch commits together.</p>
        <p className="text-sm text-muted-foreground">Confirm the payout method for each sale. Complete external card refunds on the terminal first and enter each refund reference. Retrying the saved POS request must not refund the terminal again.</p>
        {operation.pending ? <><p role="status">A saved refund batch needs confirmation. Reason: {String(operation.pending.payload.reason || '')}</p><OperationRecovery operation={operation} /></> : <>
          {query.loading && <p role="status">Loading remaining balances...</p>}
          {query.error && <div role="alert"><p>{query.error}</p><Button onClick={query.refresh}>Retry balances</Button></div>}
          <fieldset disabled={operation.blocked || query.loading || !!query.error} className="space-y-4 min-w-0">
            {rows.map(row => <div key={row.id} className="rounded border p-3 space-y-2"><p className="font-medium break-all">{row.saleNumber} — {formatCurrency(row.expectedAmount)}</p>{!row.eligible && <p role="alert" className="text-destructive">{row.refundTenderError || 'This sale is not eligible for a bulk return. Review it individually.'}</p>}<RefundTenderEditor options={row.refundTenderOptions || []} amount={row.expectedAmount} hasCustomer={row.hasCustomer} edits={edits[row.id] || {}} onChange={value => setEdits({ ...edits, [row.id]: value })} idPrefix={row.saleNumber + ' '} /></div>)}
            {rows.length > 0 && <p className="font-semibold">Total refund: {formatCurrency(rows.reduce((sum, row) => sum + Math.round(row.expectedAmount * 100), 0) / 100)}</p>}
            <Input label="Refund reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={500} />
            <Button disabled={!rows.length || !reason.trim() || rows.some(row => !row.eligible || row.selection.invalid)} onClick={() => void operation.submit({ label: `${rows.length} sales, ${formatCurrency(rows.reduce((sum, row) => sum + Math.round(row.expectedAmount * 100), 0) / 100)} refund`, path: '/sales/bulk-refund', payload: { reason: reason.trim(), sales: rows.map(row => ({ id: row.id, expectedAmount: row.expectedAmount, refundTenders: row.selection.tenders })) } })}>Record Bulk Refund</Button>
          </fieldset>
          {operation.error && <p role="alert" className="text-destructive">{operation.error}</p>}
        </>}
      </div>
    </Modal>
  </div>;
}
