import { Checkbox } from '@/components/ui/Checkbox';
import { Select } from '@/components/ui/Select';
import { useState } from 'react';
import { db, PendingSale, TerminalCheckout } from '@/services/offlineDb';
import { useSavedOperation } from '@/hooks/useSavedOperation';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { api } from '@/services/api';
import { OperationRecovery } from './OperationRecovery';
import { Pagination } from './Pagination';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { formatCurrency, formatDateTime, formatTime, formatEnumLabel } from '@/lib/utils';
import { lineMoney, roundMoney } from '@/lib/money';

type Choice = { record: PendingSale | TerminalCheckout; kind: 'CASH' | 'TERMINAL' };
export function OfflineReconciliation({ cash, terminal }: { cash: PendingSale[]; terminal: TerminalCheckout[] }) {
  const [choice, setChoice] = useState<Choice | null>(null), [disposition, setDisposition] = useState('HOLD');
  const [reason, setReason] = useState(''), [reference, setReference] = useState(''), [saleId, setSaleId] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [lines, setLines] = useState<any[]>([]), [ageVerified, setAgeVerified] = useState(false), [page, setPage] = useState(1), [historyOpen, setHistoryOpen] = useState(false);
  const [result, setResult] = useState<any>(null), [localError, setLocalError] = useState('');
  const history = useScopedQuery<any>(['offline-history', page], signal => api.get('/offline/history', { params: { page }, signal }).then(response => response.data.data), historyOpen);
  const operation = useSavedOperation('offline', '/offline/', response => {
    setResult({ ...response.data, receiptId: response.receiptId }); setChoice(null);
    void archive(response).catch(() => setLocalError('The server receipt is saved, but this browser could not be updated. Restore browser storage and use the history receipt to reconcile the local record.'));
  });
  async function archive(response: any) {
    const evidence = { receiptId: response.receiptId, status: response.data.status, disposition: response.data.disposition, recordedAt: Date.now() };
    await db.transaction('rw', db.pendingSales, db.terminalCheckouts, db.paymentSessions, async () => {
      const queued = await db.pendingSales.filter(record => record.localId === response.data.localId && record.userId === response.data.cashierId).first();
      if (queued?.id && !(queued.reconciliation?.status === 'FINAL' && evidence.status !== 'FINAL')) await db.pendingSales.update(queued.id, { reconciliation: evidence, synced: evidence.status === 'FINAL', serverId: response.data.saleId || undefined });
      const terminalRecord = await db.terminalCheckouts.get(response.data.localId);
      if (terminalRecord && terminalRecord.userId === response.data.cashierId && !(terminalRecord.reconciliation?.status === 'FINAL' && evidence.status !== 'FINAL')) await db.terminalCheckouts.update(terminalRecord.key, { reconciliation: evidence });
      if (terminalRecord?.paymentSessionId && terminalRecord.userId === response.data.cashierId && evidence.status === 'FINAL') await db.paymentSessions.update(terminalRecord.paymentSessionId, { status: 'FINAL', resultId: response.receiptId });
    });
  }
  const open = (record: Choice['record'], kind: Choice['kind']) => {
    setChoice({ record, kind }); setDisposition('HOLD'); setReason(''); setReference(''); setSaleId(''); setConfirmed(false); setAgeVerified(false); setResult(null);
    const queued = record as PendingSale;
    setLines((queued.originalReceipt?.items || queued.items || []).map((item: any) => ({ ...item, tax: item.tax ?? '', sku: item.sku || '', productName: item.productName || '', pointsEarned: item.pointsEarned || 0 })));
  };
  const submit = () => {
    if (!choice) return;
    const record = choice.record, queued = record as PendingSale, payload = record.payload as Record<string, any> | undefined;
    const verified = lines.map(item => ({ productId: item.productId, productName: item.productName, sku: item.sku, quantity: Number(item.quantity), price: Number(item.price), discount: Number(item.discount || 0), tax: Number(item.tax),
      total: roundMoney(lineMoney(Number(item.price), Number(item.quantity)) - Number(item.discount || 0) + Number(item.tax)), pointsEarned: Number(item.pointsEarned || 0) }));
    void operation.submit({ label: `${formatEnumLabel(disposition)}: ${formatCurrency(record.total)}`, path: '/offline/reconcile', payload: {
      localId: choice.kind === 'CASH' ? queued.localId : (record as TerminalCheckout).key, cashierId: record.userId, kind: choice.kind, disposition,
      createdAt: new Date(record.createdAt).toISOString(), total: record.total, originalShiftId: payload?.offlineShiftId || payload?.expectedShiftId,
      customerId: queued.customerId || payload?.customerId, matchedSaleId: saleId.trim() || undefined, reason: reason.trim(), reference: reference.trim(), confirmed: true,
      references: choice.kind === 'TERMINAL' ? (record as TerminalCheckout).references : [],
      ...(disposition === 'BOOK_CASH' ? { receipt: { subtotal: roundMoney(verified.reduce((sum, item) => sum + lineMoney(item.price, item.quantity), 0)),
        tax: roundMoney(verified.reduce((sum, item) => sum + item.tax, 0)), discount: roundMoney(verified.reduce((sum, item) => sum + item.discount, 0)), amountPaid: queued.amountPaid,
        changeDue: queued.changeDue, pointsEarned: verified.reduce((sum, item) => sum + item.pointsEarned, 0), ageVerified, items: verified } } : {}),
    } });
  };
  return <section className="space-y-3 border-t pt-4">
    <h3 className="font-semibold">Manager reconciliation</h3>
    <p className="text-sm text-muted-foreground">Compare original receipt, drawer and terminal records before deciding. Saved browser records remain as evidence. A hold pauses automatic cash retries. Booking cash uses verified original amounts and keeps historical cost unavailable.</p>
    <OperationRecovery operation={operation} />
    {localError && <p role="alert" className="text-destructive">{localError}</p>}
    {[...cash.map(record => ({ record, kind: 'CASH' as const })), ...terminal.map(record => ({ record, kind: 'TERMINAL' as const }))].map(item => <Button key={item.kind + ('localId' in item.record ? item.record.localId : item.record.key)} variant="outline" size="sm" disabled={operation.blocked} onClick={() => open(item.record, item.kind)}>Review {item.kind.toLowerCase()} {formatCurrency(item.record.total)} · {formatTime(item.record.createdAt)}</Button>)}
    {choice && <fieldset disabled={operation.blocked} className="space-y-3 rounded border p-3">
      <p className="font-medium">Original checkout: {formatCurrency(choice.record.total)} · {formatDateTime(choice.record.createdAt)}</p>
      <Select label="Verified outcome" aria-label="Verified outcome" value={disposition} onChange={event => setDisposition(event.target.value)}><option value="HOLD">Hold for investigation</option><option value="MATCH_RECORDED">Match a recorded sale</option>{choice.kind === 'CASH' && <><option value="BOOK_CASH">Book the verified original cash receipt</option><option value="NOT_COLLECTED">Payment was never collected</option></>}<option value="EXTERNAL_REVERSAL">Payment was reversed outside this POS</option></Select>
      {disposition === 'MATCH_RECORDED' && <Input label="Recorded sale ID (optional when checkout key matches)" value={saleId} onChange={event => setSaleId(event.target.value)} />}
      {disposition === 'EXTERNAL_REVERSAL' && <p className="text-sm">Confirm the external reversal and any stock/account effects separately. This outcome records evidence and does not send a refund or change stock.</p>}
      {disposition === 'BOOK_CASH' && <div className="space-y-3"><p className="text-sm">Verify every line against the original receipt, including discounts, tax and earned points. Zero points means none will be awarded. No current price or cost is substituted. The original closing cash count stays unchanged; expected cash and its difference reflect the late booking.</p>
        {!lines.length && <p role="alert">No original product lines are available. Hold this case for investigation.</p>}
        {lines.map((item, index) => <div key={index} className="grid grid-cols-2 gap-2 rounded border p-2"><p className="col-span-2">Line {index + 1}: {item.quantity} units</p>{[['productName', 'Original product name'], ['sku', 'Original SKU'], ['price', 'Original unit price'], ['discount', 'Original line discount'], ['tax', 'Original line tax'], ['pointsEarned', 'Original line earned points']].map(([key, label]) => <Input key={key} label={label} type={['productName', 'sku'].includes(key) ? 'text' : 'number'} min={0} step={key === 'price' ? '0.0001' : key === 'pointsEarned' ? '1' : '0.01'} value={item[key]} onChange={event => setLines(previous => previous.map((value, n) => n === index ? { ...value, [key]: event.target.value } : value))} />)}</div>)}
        <Checkbox label="Original age verification evidence was checked for any restricted products." checked={ageVerified} onChange={event => setAgeVerified(event.target.checked)} />
      </div>}
      <Input label="Reconciliation reason" value={reason} maxLength={500} onChange={event => setReason(event.target.value)} /><Input label="Original evidence reference" value={reference} maxLength={150} onChange={event => setReference(event.target.value)} />
      <Checkbox label="I checked original records, cashier, store, date and amounts. This action must not collect payment again." checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
      <Button disabled={!confirmed || !reason.trim() || !reference.trim() || (disposition === 'BOOK_CASH' && (!lines.length || lines.some(item => item.tax === '' || !item.productName || !item.sku)))} onClick={submit}>Record reviewed outcome</Button><Button variant="outline" onClick={() => setChoice(null)}>Cancel review</Button>
    </fieldset>}
    {result && <div role="status" className="rounded border p-3 text-sm"><p>{formatEnumLabel(result.disposition)}: {result.status === 'FINAL' ? 'Done' : result.status === 'HOLD' ? 'On hold' : formatEnumLabel(result.status)}</p><p className="break-all">Receipt: {result.receiptId}</p><p>{result.reason} · {result.reference}</p></div>}
    <Button variant="outline" onClick={() => setHistoryOpen(value => !value)}>{historyOpen ? 'Hide' : 'Show'} server reconciliation history</Button>
    {historyOpen && <div className="space-y-2">{history.loading && <p role="status">Loading history...</p>}{history.error && <p role="alert">{history.error}<Button onClick={history.refresh}>Retry history</Button></p>}{history.data?.records.map((receipt: any) => <div key={receipt.id} className="rounded border p-2 text-sm"><p>{receipt.result.cashierName} · {formatEnumLabel(receipt.result.disposition)} · {formatCurrency(receipt.result.amount)}</p><p className="break-all">Checkout: {receipt.result.localId}</p><p>{receipt.result.reason} · {receipt.result.reference}</p><Button variant="outline" size="sm" onClick={() => void archive({ receiptId: receipt.id, data: receipt.result }).catch(() => setLocalError('Unable to update local storage. The server receipt remains saved.'))}>Apply this receipt to local record</Button></div>)}{history.data && <Pagination page={page} totalPages={history.data.pagination.totalPages} onPageChange={setPage} />}</div>}
  </section>;
}
