import { ManagementPage } from '@/components/common/Workspace';
import { Select } from '@/components/ui/Select';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/services/api';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { useSavedOperation } from '@/hooks/useSavedOperation';
import { useUrlFilter, useUrlPage } from '@/hooks/useUrlFilter';
import { OperationRecovery } from '@/components/common/OperationRecovery';
import { Pagination } from '@/components/common/Pagination';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTabs } from '@/components/common/PageTabs';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { formatCurrency } from '@/lib/utils';

export function Reconciliation() {
  const [rawView,setView]=useUrlFilter('view','corrections',false),[page,setPage]=useUrlPage(),[record,setRecord]=useUrlFilter('record');
  const view=['corrections','legacy','history'].includes(rawView)?rawView:'corrections';
  const [kind, setKind] = useState('DRAWER'), [target, setTarget] = useState(''), [reviewedTarget, setReviewedTarget] = useState<{ kind: string; target: string } | null>(null);
  const [amount, setAmount] = useState(''), [reason, setReason] = useState(''), [reference, setReference] = useState('');
  const [legacy, setLegacy] = useState<any>(null), [reversedAt, setReversedAt] = useState(''), [method, setMethod] = useState('CASH'), [confirmed, setConfirmed] = useState(false);
  const [splitTenders,setSplitTenders]=useState<Record<string,string>>({});
  const tenderMethods=['CASH','CARD','GIFT_CARD','STORE_CREDIT','HOUSE_ACCOUNT','EBT','OTHER'];
  const receiptQuery=useScopedQuery<any>(['reconciliation-receipt',record],signal=>api.get('/financial/reconciliation/receipts/'+record,{signal}).then(response=>response.data.data),!!record);
  const receipt=receiptQuery.data;
  const operation = useSavedOperation('reconciliation', '/financial/reconciliation/', response => { setRecord(response.receiptId); setLegacy(null); setReviewedTarget(null); setReason(''); setReference(''); setAmount(''); });
  const preview = useScopedQuery<any>(['correction-preview', reviewedTarget], signal => api.post('/financial/reconciliation/corrections/preview', reviewedTarget, { signal }).then(response => response.data.data), !!reviewedTarget && view === 'corrections', 0);
  const listing = useScopedQuery<any>(['reconciliation', view, page], signal => api.get('/financial/reconciliation/' + (view === 'legacy' ? 'legacy-voids' : 'history'), { params: { page }, signal }).then(response => response.data.data), view === 'legacy' || view === 'history');
  const changeView = (next: string) => { setView(next); setReviewedTarget(null); setReason(''); setReference(''); };
  return <ManagementPage className=" space-y-6">
    <PageHeader title="Reconciliation" actions={<Link className="page-action" to="/financial">Back to Finances</Link>}
      tabs={<PageTabs label="Reconciliation views" value={view} onChange={changeView} items={[{id:'corrections',label:'Balance corrections'},{id:'legacy',label:'Legacy voids'},{id:'history',label:'History'}]} />} />
    <OperationRecovery operation={operation} />
    {view === 'corrections' && <Card><CardHeader><CardTitle>Record a balance correction</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Corrections append a signed adjustment with the reviewed balance and your evidence. They do not change merchandise sales or contact a card terminal. Drawer corrections affect your own open drawer. Account corrections do not collect cash.</p>
      <fieldset disabled={operation.blocked} className="space-y-4">
        <label className="block">Balance type<Select aria-label="Balance type" value={kind} onChange={event => { setKind(event.target.value); setTarget(''); setReviewedTarget(null); }} className="block p-2 rounded border bg-background"><option value="DRAWER">My current drawer</option><option value="GIFT_CARD">Gift card</option><option value="STORE_CREDIT">Customer store credit</option><option value="HOUSE_ACCOUNT">Customer house-account debt</option></Select></label>
        {kind !== 'DRAWER' && <Input label={kind === 'GIFT_CARD' ? 'Gift card code or ID' : 'Customer phone, email or ID'} value={target} onChange={event => { setTarget(event.target.value); setReviewedTarget(null); }} />}
        <Button variant="outline" disabled={kind !== 'DRAWER' && !target.trim()} onClick={() => setReviewedTarget({ kind, target: target.trim() })}>Review current balance</Button>
        {preview.loading && <p role="status">Loading current balance...</p>}
        {preview.error && <div role="alert"><p>{preview.error}</p><Button onClick={preview.refresh}>Retry balance</Button></div>}
        {preview.data && <><p className="font-medium">{preview.data.label}: {formatCurrency(preview.data.balance)}</p><Input label="Signed correction amount" type="number" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /><p className="text-sm text-muted-foreground">A positive amount increases this balance; a negative amount decreases it. Positive house-account amounts increase the debt owed.</p><Input label="Correction reason" value={reason} maxLength={500} onChange={event => setReason(event.target.value)} /><Input label="Evidence reference" value={reference} maxLength={150} onChange={event => setReference(event.target.value)} /><Button disabled={preview.loading || !!preview.error || !Number.isFinite(Number(amount)) || Number(amount) === 0 || !reason.trim() || !reference.trim()} onClick={() => void operation.submit({ label: `${preview.data.label}: correction ${formatCurrency(Number(amount))}`, path: '/financial/reconciliation/corrections', payload: { ...reviewedTarget, amount: Number(amount), expectedBalance: preview.data.balance, reason: reason.trim(), reference: reference.trim() } })}>Record correction</Button></>}
      </fieldset>
    </CardContent></Card>}
    {(view === 'legacy' || view === 'history') && <>
      {listing.loading && <p role="status">Loading reconciliation records...</p>}
      {listing.error && <div role="alert"><p>{listing.error}</p><Button onClick={listing.refresh}>Retry records</Button></div>}
      {listing.data && <Card><CardHeader><CardTitle>{view === 'legacy' ? 'Legacy voids without a recorded reversal date' : 'Immutable reconciliation history'}</CardTitle></CardHeader><CardContent className="space-y-3">
        {view === 'legacy' ? <><p className="text-sm text-muted-foreground">Use original records to confirm when and how the reversal actually happened. This records historical evidence and does not repeat stock restoration, points, account credits or a cash payout.</p>{!listing.data.sales.length && <p>No legacy voids need reconciliation.</p>}{listing.data.sales.map((sale: any) => <div key={sale.id} className="flex flex-wrap justify-between gap-3 rounded border p-3"><p className="break-all">{sale.saleNumber} — {formatCurrency(sale.total)}</p><Button size="sm" disabled={operation.blocked} onClick={() => { setLegacy(sale); setConfirmed(false); setReason(''); setReference(''); setReversedAt(''); setMethod('CASH');setSplitTenders({}); }}>Review legacy void</Button></div>)}</> : <>{!listing.data.records.length && <p>No reconciliation receipts recorded.</p>}{listing.data.records.map((record: any) => <div key={record.id} className="flex flex-wrap justify-between gap-3 rounded border p-3"><div><p>{record.kind.replace(/_/g, ' ')} — {new Date(record.createdAt).toLocaleString()}</p><p className="text-sm">{record.user.firstName} {record.user.lastName} — {record.result.reason}</p></div><Button variant="outline" size="sm" onClick={() => setRecord(record.id)}>View receipt</Button></div>)}</>}
        <Pagination page={page} totalPages={listing.data.pagination.totalPages} onPageChange={setPage} />
      </CardContent></Card>}
    </>}
    <Modal isOpen={!!legacy} onClose={() => { if (!operation.busy) setLegacy(null); }} title="Reconcile Legacy Void" size="md">
      {legacy && <div className="space-y-4"><p className="break-all">{legacy.saleNumber} — {formatCurrency(legacy.total)}</p><p className="text-sm">Verify the original reversal documents. No current drawer or inventory movement will be recorded. For a mixed-tender reversal, enter each verified tender amount from the original evidence. Their total must match the original sale.</p><fieldset disabled={operation.blocked} className="space-y-3"><Input label="Actual reversal time (this device)" type="datetime-local" value={reversedAt} onChange={event => setReversedAt(event.target.value)} /><label className="block">Verified refund tender<Select aria-label="Verified refund tender" className="block p-2 rounded border bg-background" value={method} onChange={event => setMethod(event.target.value)}>{[...tenderMethods,'SPLIT'].map(value=><option key={value} value={value}>{value==='SPLIT'?'Mixed tenders':value.replace(/_/g,' ')}</option>)}</Select></label>{method==='SPLIT'&&<div className="grid grid-cols-2 gap-2">{tenderMethods.map(tender=><Input key={tender} label={tender.replace(/_/g,' ')+' reversed amount'} type="number" min={0} step="0.01" value={splitTenders[tender]||''} onChange={event=>setSplitTenders(previous=>({...previous,[tender]:event.target.value}))}/>)}</div>}<Input label="Reconciliation reason" value={reason} maxLength={500} onChange={event => setReason(event.target.value)} /><Input label="Original reversal evidence reference" value={reference} maxLength={150} onChange={event => setReference(event.target.value)} /><label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>I verified that this reversal previously happened, its date and tender, and that no payout or stock restoration should be repeated.</span></label><Button disabled={!confirmed || !reversedAt || !reason.trim() || !reference.trim() || (method==='SPLIT' && Object.values(splitTenders).reduce((sum,value)=>sum+Math.round(Number(value||0)*100),0)!==Math.round(legacy.total*100))} onClick={() => void operation.submit({ label: legacy.saleNumber + ': historical void reconciliation', path: '/financial/reconciliation/legacy-voids', payload: { saleId: legacy.id, expectedAmount: legacy.total, reversedAt: new Date(reversedAt).toISOString(), reason: reason.trim(), reference: reference.trim(), confirmedPreviouslyReversed: true, tenders: legacy.total ? method==='SPLIT'?Object.fromEntries(Object.entries(splitTenders).filter(([,value])=>Number(value)>0).map(([tender,value])=>[tender,Number(value)])):{[method]:legacy.total}:{} } })}>Record verified history</Button></fieldset><OperationRecovery operation={operation} /></div>}
    </Modal>
    <Modal isOpen={!!record} onClose={() => setRecord('')} title="Reconciliation Receipt" size="md">{receiptQuery.loading&&<p role="status">Loading receipt...</p>}{receiptQuery.error&&<p role="alert">{receiptQuery.error}<Button onClick={receiptQuery.refresh}>Retry receipt</Button></p>}
      {receipt && <div className="space-y-3"><p className="font-semibold break-all">{receipt.label || receipt.saleNumber || receipt.localId}</p>{typeof receipt.amount === 'number' && <p>Amount: {formatCurrency(receipt.amount)}</p>}{typeof receipt.balanceBefore === 'number' && <p>Balance: {formatCurrency(receipt.balanceBefore)} → {formatCurrency(receipt.balanceAfter)}</p>}{receipt.reversedAt && <p>Verified historical reversal: {new Date(receipt.reversedAt).toLocaleString()}</p>}<p>Reason: {receipt.reason}</p><p>Evidence reference: {receipt.reference}</p>{receipt.tenders&&Object.entries(receipt.tenders).map(([tender,value])=><p key={tender}>{tender.replace(/_/g,' ')}: {formatCurrency(Number(value))}</p>)}{receipt.payingDrawerKnown === false && <p>No paying drawer was inferred. No payout, stock or account effect was repeated.</p>}</div>}
    </Modal>
  </ManagementPage>;
}
