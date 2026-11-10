import { friendlyDate } from '@/lib/calendarDates';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Plus, LockKeyhole } from 'lucide-react';
import { api } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { useLotteryDayEditor } from '@/hooks/useLotteryDayEditor';
import { useUrlFilter } from '@/hooks/useUrlFilter';
import { PageTabs } from '@/components/common/PageTabs';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { LotteryIssue, LotteryStage, LotteryCorrectionInput, lotteryMoney, manualLottery, lotteryError } from '@/services/lotteryWorkbench';
import { LotterySection, LotteryMoneyFields, LotteryError, LotteryRecovery } from './LotteryFields';
import { LotteryBookDialog } from './LotteryBookDialog';
import { BookDialogSelection, LotteryScratchStage } from './LotteryScratchStage';
import { LotteryDisclosure, LotteryReviewStage, LotteryTerminalStage, lotteryFieldLabel } from './LotteryReportStages';
import { LotteryDayHistory } from './LotteryDayHistory';

const correctionFields = [['scratchSales', 'Scratch sales correction'], ['onlineSales', 'Online sales correction'], ['payouts', 'Payout correction'], ['netCollections', 'Collections correction'], ['netCash', 'Cash correction'], ['earnings', 'Earnings correction']] as const;
const stages = [{ id: 'scratch', label: 'Scratch Sales' }, { id: 'online', label: 'Terminal Report' }, { id: 'reconcile', label: 'Review & Close' }] as const;
function reviewValue(value: unknown): string {
  if (value == null || value === '') return 'Not reported';
  if (Array.isArray(value)) return value.length ? value.map(reviewValue).join(' · ') : 'None';
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => lotteryFieldLabel(key) + ': ' + reviewValue(item)).join('; ');
  return String(value);
}
export function LotteryDailyWorkbench({ locationId, date, onDateChange, readOnly, onActionsChange, onNavigationChange }: {
  locationId: string; date: string; onDateChange: (date: string) => void; readOnly: boolean; onActionsChange: (node: ReactNode) => void; onNavigationChange: (node: ReactNode) => void;
}) {
  const user = useAuthStore(state => state.user), owner = user?.role === 'ADMIN', manager = owner || user?.role === 'MANAGER';
  const [view, setView] = useUrlFilter('lotteryView', '', false);
  const [dialog, setDialog] = useState<BookDialogSelection | null>(null);
  const [confirm, setConfirm] = useState<'close' | 'reopen' | 'correction' | null>(null), [reason, setReason] = useState('');
  const [reviewConflict, setReviewConflict] = useState(false), [focusTarget, setFocusTarget] = useState('');
  const [correction, setCorrection] = useState<LotteryCorrectionInput>({ scratchSales: '0', onlineSales: '0', payouts: '0', netCollections: '0', netCash: '0', earnings: '0', tickets: null, reason: '', reference: '' });
  const [scan, setScan] = useState(''), [scanError, setScanError] = useState(''), [scanStatus, setScanStatus] = useState(''), [scanning, setScanning] = useState(false), [lastBook, setLastBook] = useState('');
  const scanner = useRef<HTMLInputElement>(null), alive = useRef(true), flight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const saved = useCallback(() => { setDialog(null); setConfirm(null); }, []);
  const editor = useLotteryDayEditor(locationId, date, readOnly, !!dialog || !!confirm || reviewConflict || scanning, saved);
  const { day, draft, report, closed, blocked, storageError, operation, query, persist, mutate, saveReport } = editor;
  const conflict = !!draft && !!day && draft.version !== day.version;
  const countsBlocked = blocked || scanning || conflict;
  const selectedView: LotteryStage = view === 'scratch' || view === 'online' || view === 'reconcile' ? view : closed ? 'reconcile' : 'scratch';
  const index = stages.findIndex(stage => stage.id === selectedView);
  useEffect(() => {
    if (!focusTarget) return;
    const element = document.getElementById('lottery-' + focusTarget);
    if (!element) return;
    let ancestor = element.parentElement;
    while (ancestor) { if (ancestor instanceof HTMLDetailsElement) ancestor.open = true; ancestor = ancestor.parentElement; }
    const frame = requestAnimationFrame(() => { element.scrollIntoView({ block: 'center' }); (element.matches('input,textarea,button') ? element : element.querySelector<HTMLElement>('button,input'))?.focus(); setFocusTarget(''); });
    return () => cancelAnimationFrame(frame);
  }, [focusTarget, selectedView, day]);
  useEffect(() => {
    const enabled = day?.configured && day.configuration.mode !== 'DISABLED';
    onNavigationChange(enabled ? <PageTabs secondary label="Daily lottery stages" value={selectedView} onChange={setView} items={stages.map((stage, i) => ({
      id: stage.id, label: <span className="relative inline-flex items-center gap-2"><span aria-hidden="true" className="inline-flex size-5 items-center justify-center rounded-full border text-xs">{day?.id && day.readiness?.stages[stage.id].complete ? <Check size={13} /> : i + 1}</span>{stage.label}<span className="sr-only"> — {day?.id && day.readiness?.stages[stage.id].complete ? 'Saved stage complete' : 'Not complete'}</span></span>,
    }))} /> : null);
    return () => onNavigationChange(null);
  }, [day, selectedView, setView, onNavigationChange]);
  useEffect(() => {
    onActionsChange(day?.id && !closed && manager && !readOnly && manualLottery(day.configuration) && selectedView === 'scratch'
      ? <Button disabled={countsBlocked} onClick={() => setDialog({ kind: 'new' })}><Plus />Add book</Button>
      : closed && owner && !readOnly ? <ActionMenu label="Day actions" items={[
        ...(day?.canReopen ? [{ id: 'reopen', label: 'Reopen counts', onAction: () => { setReason(''); setConfirm('reopen'); } }] : []),
        { id: 'correct', label: 'Record correction', onAction: () => setConfirm('correction') },
      ]} /> : null);
    return () => onActionsChange(null);
  }, [day, closed, manager, owner, readOnly, countsBlocked, selectedView, onActionsChange]);
  const submitScan = async () => {
    if (flight.current || countsBlocked || !day || !scan.trim()) return;
    flight.current = true; setScanning(true); setScanError(''); setScanStatus('');
    try {
      const preview = (await api.post('/lottery/v2/days/' + date + '/scan-preview', { raw: scan })).data.data as { bookId: string | null; game: string; book: string; ticket: string };
      if (!alive.current) return;
      const checkpoint = day.checkpoints.find(row => row.bookId === preview.bookId);
      if (!checkpoint) throw new Error('Game ' + preview.game + ', book ' + preview.book + ' is not on this day’s rack. Ask a manager to add or review it.');
      const duplicate = checkpoint.openingVerified && checkpoint.closingTicket === preview.ticket;
      const result = await mutate('checkpoint', { bookId: checkpoint.bookId, raw: scan, opening: !checkpoint.openingVerified });
      if (result && alive.current) {
        setLastBook(checkpoint.bookId); setScan('');
        setScanStatus('Bin ' + checkpoint.slot + ' · ' + checkpoint.book.name + ' · ' + preview.ticket + (duplicate ? ' already counted; number unchanged' : checkpoint.openingVerified ? ' closing saved' : ' opening verified'));
      }
    } catch (error) { if (alive.current) setScanError(error instanceof Error && !('response' in error) ? error.message : lotteryError(error)); }
    finally { flight.current = false; if (alive.current) { setScanning(false); requestAnimationFrame(() => scanner.current?.focus()); } }
  };
  const goToIssue = (issue: LotteryIssue) => {
    setView(issue.stage);
    if (issue.bookId) {
      const checkpoint = day?.checkpoints.find(row => row.bookId === issue.bookId);
      if (checkpoint && !countsBlocked) setDialog({ kind: 'checkpoint', checkpoint });
    } else setFocusTarget(issue.field);
  };
  const continueStage = async () => {
    const result = await saveReport();
    if (result && alive.current && index < stages.length - 1) setView(stages[index + 1].id);
  };
  const totals = day?.totals, issues = day?.readiness?.issues || [];
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3"><div className="w-60 max-w-full"><Input label="Business date" type="date" value={date} onChange={e => { if (e.target.value) onDateChange(e.target.value); }} /></div>
      {day?.configured && day.configuration.mode !== 'DISABLED' && <div className="flex flex-wrap items-center gap-2 text-sm pb-1"><span className="rounded-md border px-2 py-1">{closed ? 'Closed' : day.id ? 'In progress' : 'Not started'}</span><span className="text-muted-foreground">{day.configuration.cashMode === 'SHARED' ? 'Shared checkout cash' : 'Separate lottery cash'}</span>{day.id && <span className="text-xs text-muted-foreground">{draft ? 'Unsaved changes retained' : 'Changes saved'}</span>}
        {!day.id && !readOnly && <Button disabled={operation.blocked || !!storageError} onClick={() => void mutate('open')}>Start daily entry</Button>}
      </div>}
    </div>
    <LotteryError error={query.error} retry={() => void query.refresh()} /><LotteryError error={storageError} /><LotteryRecovery operation={operation} />
    {query.loading && !day && <p role="status" className="text-sm">Loading lottery day…</p>}
    {day && !day.configured && <LotterySection title="Lottery setup pending"><p className="text-sm text-muted-foreground">{day.upcomingDate ? 'Tracking starts ' + day.upcomingDate + '. Previous entries are available under Reports → Earlier records.' : 'The platform administrator needs to confirm this store’s equipment and starting date. Previous entries are available under Reports → Earlier records.'}</p></LotterySection>}
    {day?.configured && day.configuration.mode === 'DISABLED' && <LotterySection title="Lottery disabled"><p className="text-sm text-muted-foreground">Lottery tracking is disabled for this business date.</p></LotterySection>}
    {day?.configured && day.configuration.mode !== 'DISABLED' && <>
      {conflict && <div className="rounded-md border p-3 flex flex-wrap items-center justify-between gap-3 text-sm" role="status">
        <p>This report changed in another session. Your draft is retained.</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={operation.blocked || !!closed} onClick={() => setReviewConflict(true)}>Review updated report</Button><Button variant="outline" disabled={operation.busy} onClick={editor.discard}>Discard draft</Button></div>
      </div>}
      {!day.id && <LotterySection title="Start this day’s lottery entry"><p className="text-sm text-muted-foreground">Confirm scratch sales, enter the terminal report, then review cash and close the day. Starting creates a draft; it does not post sales or earnings.</p></LotterySection>}
      {day.id && report && <>
        {selectedView === 'scratch' && <LotteryScratchStage day={day} report={report} blocked={blocked} countsBlocked={countsBlocked} manager={manager} readOnly={readOnly}
          persist={persist} openBook={setDialog} scanner={scanner} scan={scan} setScan={setScan} scanError={scanError} scanStatus={scanStatus} lastBook={lastBook} submitScan={submitScan} />}
        {selectedView === 'online' && <LotteryTerminalStage report={report} disabled={blocked} persist={persist} />}
        {selectedView === 'reconcile' && <>
          <LotteryReviewStage day={day} report={report} disabled={blocked} persist={persist} dirty={!!draft} />
          {!closed && !!issues.length && <LotterySection title="Before closing" description={draft ? 'Checks reflect saved entries. Save your draft to update them.' : undefined}>
            <div className="grid gap-2 sm:grid-cols-2">{issues.map((issue, i) => <Button key={i} variant="outline" className="justify-between text-left h-auto min-h-9 whitespace-normal" onClick={() => goToIssue(issue)}><span>{issue.message}{!issue.blocking && <span className="ml-2 text-xs text-muted-foreground">Optional review</span>}</span><ChevronRight size={16} className="shrink-0" /></Button>)}</div>
          </LotterySection>}
          {closed && <LotteryDisclosure title="Source reports and book counts">
            <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setView('scratch')}>View scratch sales</Button><Button variant="outline" onClick={() => setView('online')}>View terminal report</Button></div>
          </LotteryDisclosure>}
          {(manager || readOnly) && <LotteryDayHistory locationId={locationId} date={date} version={day.version} />}
        </>}
        {!closed && !readOnly && <div className="sticky bottom-0 z-10 border-t bg-background pt-3 pb-16 sm:pb-3 sm:pr-16 flex flex-wrap items-center justify-between gap-3" aria-label="Daily entry actions">
          <Button variant="outline" disabled={index === 0 || operation.busy} onClick={() => setView(stages[index - 1].id)}>Back</Button>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!draft || operation.blocked || conflict || !!storageError} onClick={() => void saveReport()}>Save draft</Button>
            {index < stages.length - 1 || draft ? <Button disabled={operation.blocked || conflict || !!storageError} onClick={() => void continueStage()}>{index === 2 ? 'Save & review' : 'Save & continue'}<ChevronRight /></Button>
              : manager ? <Button disabled={countsBlocked || !day.readiness?.canClose} onClick={() => setConfirm('close')}><LockKeyhole />Close day</Button>
              : <span className="self-center text-sm text-muted-foreground">A manager closes the day.</span>}
          </div>
        </div>}
      </>}
    </>}
    {dialog && <LotteryBookDialog locationId={locationId} date={date} barcodeEnabled={!!day?.configuration.barcodeProfile} {...dialog} owner={owner} blocked={operation.blocked} error={operation.error}
      onClose={() => setDialog(null)} onSubmit={mutate} />}
    {reviewConflict && draft && day && <Modal isOpen title="Review changed report" size="xl" onClose={() => setReviewConflict(false)} footer={<div className="flex justify-end gap-2">
      <Button variant="outline" onClick={() => setReviewConflict(false)}>Cancel</Button><Button onClick={() => { editor.rebase(); setReviewConflict(false); }}>Keep my reviewed draft</Button>
    </div>}><p className="text-sm text-muted-foreground mb-4">Compare saved figures with your draft before saving. Book counts stay unchanged.</p>
      <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Field</TableHead><TableHead>Saved report</TableHead><TableHead>Your draft</TableHead></TableRow></TableHeader><TableBody>
        {Object.keys(draft.report).filter(key => JSON.stringify(draft.report[key as keyof typeof draft.report]) !== JSON.stringify(day.report[key as keyof typeof day.report])).map(key =>
          <TableRow key={key}><TableCell>{lotteryFieldLabel(key)}</TableCell><TableCell className="max-w-80 whitespace-normal break-words">{reviewValue(day.report[key as keyof typeof day.report])}</TableCell><TableCell className="max-w-80 whitespace-normal break-words">{reviewValue(draft.report[key as keyof typeof draft.report])}</TableCell></TableRow>)}
      </TableBody></Table></div>
    </Modal>}
    {confirm && <Modal isOpen title={confirm === 'close' ? 'Close lottery day' : confirm === 'reopen' ? 'Reopen lottery counts' : 'Correct a closed lottery day'} size={confirm === 'correction' ? 'lg' : 'md'} onClose={() => { if (!operation.busy) setConfirm(null); }}
      footer={<div className="flex justify-end gap-2"><Button variant="outline" disabled={operation.busy} onClick={() => setConfirm(null)}>Cancel</Button><Button disabled={operation.blocked || (confirm === 'reopen' && reason.trim().length < 3)} onClick={() => void mutate(confirm, confirm === 'reopen' ? { reason } : confirm === 'correction' ? { correction } : {})}>Confirm {confirm === 'close' ? 'close' : confirm === 'reopen' ? 'reopening' : 'correction'}</Button></div>}>
      <div className="space-y-4"><LotteryRecovery operation={operation} />
        {confirm === 'close' && <><p className="text-sm">Close {friendlyDate(date)} with the saved book counts and report totals.</p><dl className="space-y-2 text-sm">{[['Scratch sales', totals?.scratchSales], ['Online sales', totals?.onlineSales], ['Prizes paid', totals?.payouts], ['Net collections', totals?.netCollections], ['Lottery earnings', totals?.earnings]].map(([label, value]) => <div className="flex justify-between gap-3" key={label}><dt>{label}</dt><dd className="font-medium tabular-nums">{lotteryMoney(value)}</dd></div>)}</dl>{!totals?.earningsComplete && <p className="text-sm text-muted-foreground">Earnings remain pending. Net income stays incomplete until the missing information is confirmed.</p>}</>}
        {confirm === 'reopen' && <><p className="text-sm">Reverses this day’s earnings and restores opening numbers for review. The original close remains in history.</p><Input label="Reopening reason" value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} /></>}
        {confirm === 'correction' && <><p className="text-sm text-muted-foreground">Enter differences, not replacement totals. This correction is linked to {date} and recorded today. Later book counts stay unchanged. Use the settlement to correct settled earnings.</p>
          <LotteryMoneyFields fields={correctionFields} values={correction} onChange={(key, value) => setCorrection({ ...correction, [key]: value ?? '' })} />
          <Input label="Ticket count difference (optional)" type="number" step="1" value={correction.tickets ?? ''} onChange={e => setCorrection({ ...correction, tickets: e.target.value === '' ? null : Number(e.target.value) })} />
          <Input label="Correction reference" value={correction.reference} maxLength={150} onChange={e => setCorrection({ ...correction, reference: e.target.value })} /><Input label="Correction reason" value={correction.reason} maxLength={2000} onChange={e => setCorrection({ ...correction, reason: e.target.value })} /></>}
      </div>
    </Modal>}
  </div>;
}
