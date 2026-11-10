import { useConfirm } from '@/components/ui/useConfirm';
import { formatEnumLabel } from '@/lib/utils';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useUrlFilter } from '@/hooks/useUrlFilter';
import { useLotteryDayEditor } from '@/hooks/useLotteryDayEditor';
import { PageTabs } from '@/components/common/PageTabs';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { LotteryMoneyFields, LotteryError, LotteryRecovery, LotterySection } from './LotteryFields';
import { LotteryRackTable } from './LotteryRackTable';
import { LotteryDisclosure, LotteryTerminalStage, earningsFields, ZeroRemaining } from './LotteryReportStages';
import { LotteryDayHistory } from './LotteryDayHistory';
import { lotteryMoney, manualLottery } from '@/services/lotteryWorkbench';
import { rackSold } from '@/services/lotteryRackInput';
import { friendlyDate } from '@/lib/calendarDates';

export function LotterySimpleDaily({ locationId, date, onDateChange, readOnly, onActionsChange, onNavigationChange }: {
  locationId: string; date: string; onDateChange: (date: string) => void; readOnly: boolean;
  onActionsChange: (node: ReactNode) => void; onNavigationChange: (node: ReactNode) => void;
}) {
  const navigate = useNavigate(), role = useAuthStore(state => state.user?.role), manager = role === 'ADMIN' || role === 'MANAGER';
  const [view, setView] = useUrlFilter('lotteryView', 'scratch', false), selected = view === 'scratch' ? 'scratch' : 'online';
  const [compare, setCompare] = useState(false);
  const saved = useCallback(() => undefined, []);
  const editor = useLotteryDayEditor(locationId, date, readOnly, compare, saved);
  const [confirmDay, confirmDayDialog] = useConfirm();
  const [reopening, setReopening] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const { day, report, draft, closed, operation, blocked, persist, mutate, saveReport, query, storageError } = editor;
  const conflict = !!draft && !!day && draft.version !== day.version;
  const started = !!day?.id && day.configuration.workflow === 'SIMPLE';
  const disabled = blocked || conflict || !started;
  useEffect(() => {
    onNavigationChange(<PageTabs secondary label="Daily lottery views" value={selected} onChange={setView} items={[{ id: 'scratch', label: 'Scratch Sales' }, { id: 'online', label: 'Online Sales' }]} />);
    return () => onNavigationChange(null);
  }, [selected, setView, onNavigationChange]);
  useEffect(() => {
    onActionsChange(closed && day?.canReopen && role === 'ADMIN' && !readOnly ? <Button variant="outline" disabled={operation.blocked} onClick={() => { setReopenReason(''); setReopening(true); }}>Reopen day</Button> : null);
    return () => onActionsChange(null);
  }, [closed, day?.canReopen, role, readOnly, operation.blocked, onActionsChange]);
  const scratch = report?.rackCounts ? report.rackCounts.every(row => rackSold(row) !== null) ? report.rackCounts.reduce((sum, row) => sum + rackSold(row)! * Math.round(Number(row.price) * 100), 0) / 100 : null : day?.totals?.manualSales;
  const issues = day?.readiness?.issues.filter(issue => issue.blocking) || [];
  return <div className="space-y-4">
    <div className="flex flex-wrap justify-between gap-3 items-end"><div className="w-60 max-w-full"><Input label="Business date" type="date" value={date} onChange={e => { if (e.target.value) onDateChange(e.target.value); }} /></div>
      {day?.id && <div className="text-sm"><span className="rounded-md border px-2 py-1">{closed ? 'Closed' : 'Draft'}</span><span className="ml-2 text-xs text-muted-foreground">{draft ? 'Unsaved changes retained' : 'Saved'}</span></div>}
    </div>
    <LotteryError error={query.error || storageError} retry={query.error ? () => void query.refresh() : undefined} /><LotteryRecovery operation={operation} />
    {query.loading && !day && <p role="status">Loading daily entry…</p>}
    {day && (!day.configured || day.configuration.mode === 'DISABLED') && <LotterySection title={day.upcomingDate ? "Lottery starts soon" : "Lottery isn't set up yet"}><p className="text-sm text-muted-foreground">{day.upcomingDate ? 'Lottery entry starts on ' + friendlyDate(day.upcomingDate) + '.' : role === 'SUPER_ADMIN'
          ? 'Turn it on in Admin → Stores: choose Lottery for this store, then Lottery rack or Lottery machine.'
          : "Lottery isn't set up for this store yet. Ask the platform administrator to turn it on when you're ready to sell tickets."}</p></LotterySection>}
    {day?.configured && day.configuration.mode !== 'DISABLED' && report && <>
      {!closed && !started && <LotterySection title="Daily entry"><p className="text-sm text-muted-foreground">Opening numbers come from the previous entry, or the starting number in Ticket Setup.</p>
        {!readOnly && <Button disabled={operation.blocked || !!storageError} onClick={() => void mutate('entry')}>Start daily entry</Button>}
      </LotterySection>}
      {conflict && <div role="alert" className="rounded-lg border p-3 flex flex-wrap gap-3 items-center text-sm"><span>This entry changed in another session. Your draft is retained.</span><Button variant="outline" onClick={() => setCompare(true)}>Review updated report</Button><Button variant="ghost" onClick={editor.discard}>Use saved entry</Button></div>}
      {(started || closed) && <>{selected === 'scratch' ? <div className="space-y-4">
        {manualLottery(day.configuration) && (report.rackCounts ? <><LotteryRackTable rows={report.rackCounts} profile={day.configuration.barcodeProfile} disabled={disabled}
          onChange={rackCounts => persist({ ...report, rackCounts })} /><div className="flex justify-between rounded-lg border p-4 text-sm"><span>Total scratch sales</span><strong className="text-xl tabular-nums">{lotteryMoney(scratch)}</strong></div></>
          : <LotterySection title="Scratch sales"><p className="text-xl font-semibold tabular-nums">{lotteryMoney(day.totals?.scratchSales)}</p><p className="text-xs text-muted-foreground">Saved before the daily-entry table was introduced.</p></LotterySection>)}
        {report.dispensers.map((source, index) => <LotterySection key={source.sourceId} title={report.dispensers.length === 1 ? 'Lottery machine report' : day.configuration.dispensers.find(item => item.id === source.sourceId)?.name || 'Machine report'}>
          <fieldset disabled={disabled} className="space-y-4"><Input label="Machine report reference" value={source.reference} onChange={e => persist({ ...report, dispensers: report.dispensers.map((item, i) => i === index ? { ...item, reference: e.target.value } : item) })} />
            <LotteryMoneyFields idPrefix={'machine-' + source.sourceId + '-'} fields={[[ 'grossSales', 'Scratch sales' ], [ 'cancellations', 'Cancellations' ]]} values={source}
              onChange={(key, value) => persist({ ...report, dispensers: report.dispensers.map((item, i) => i === index ? { ...item, [key]: value } : item) })} />
            <p className="text-sm">Net scratch sales <strong className="float-right tabular-nums">{source.grossSales === null || source.cancellations === null ? 'Pending' : lotteryMoney(Number(source.grossSales) - Number(source.cancellations))}</strong></p>
          </fieldset>
        </LotterySection>)}
      </div> : <div className="space-y-4">
        <LotteryTerminalStage report={report} disabled={disabled} persist={persist} />
        <LotteryDisclosure title="Lottery earnings" detail={day.totals?.earningsComplete ? lotteryMoney(day.totals.earnings) : 'Not entered'} initiallyOpen={!!report.onlineCommission || !!report.scratchCommission}>
          <p className="text-xs text-muted-foreground">Enter the commissions from the lottery report. Leaving them blank keeps profit pending.</p>
          <fieldset disabled={disabled} className="space-y-4"><LotteryMoneyFields fields={earningsFields} values={report} onChange={(key, value) => persist({ ...report, [key]: value })} /><ZeroRemaining fields={earningsFields} report={report} persist={persist} /></fieldset>
        </LotteryDisclosure>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{[['Scratch sales', day.totals?.scratchSales], ['Online sales', day.totals?.onlineSales], ['Prizes paid', day.totals?.payouts], ['Net collections', day.totals?.netCollections]].map(([label, amount]) => <div key={label} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-lg font-semibold tabular-nums">{lotteryMoney(amount)}</p></div>)}</div>
        {draft && <p className="text-xs text-muted-foreground">Summary reflects the saved entry.</p>}
        {!closed && !draft && !!issues.length && <div className="flex flex-wrap gap-2">{issues.map(issue => <Button key={issue.field} variant="outline" onClick={() => {
          if (issue.field === 'setup') { navigate('/lottery?tab=ticketTypes'); return; }
          setView(issue.stage === 'scratch' ? 'scratch' : 'online');
          setTimeout(() => { const input = document.getElementById('lottery-' + issue.field); let parent = input?.parentElement; while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; } input?.scrollIntoView({ block: 'center' }); input?.focus(); }, 50);
        }}>{issue.message}</Button>)}</div>}
      </div>}
      {!closed && !readOnly && <div className="border-t bg-background pt-3 pb-16 sm:pb-3 pr-16 flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={!draft || operation.blocked || conflict || !!storageError} onClick={() => void saveReport()}>Save draft</Button>
        {selected === 'scratch' ? <Button disabled={operation.blocked || conflict || !!storageError} onClick={async () => { if (await saveReport()) setView('online'); }}>Save & online sales</Button>
          : manager && <Button disabled={operation.blocked || conflict || !!draft || !day.readiness?.canClose} onClick={async () => {
            if (await confirmDay({ title: `Close the lottery day for ${friendlyDate(date)}?`, message: 'The entry is locked and its totals count in reports. Only the owner can reopen it.', confirmLabel: 'Close day' })) void mutate('close');
          }}>Close day</Button>}
          {!manager && selected !== 'scratch' && <p className="w-full text-right text-sm text-muted-foreground">A manager closes the day once everything is entered.</p>}
      </div>}
      {closed && (manager || readOnly) && <LotteryDayHistory locationId={locationId} date={date} version={day.version} />}
      </>}
    </>}
    {compare && day && draft && <Modal isOpen title="Review changed report" size="lg" onClose={() => setCompare(false)} footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setCompare(false)}>Cancel</Button><Button onClick={() => { editor.rebase(); setCompare(false); }}>Keep my reviewed draft</Button></div>}>
      <p className="text-sm mb-4">Compare the saved amounts with your draft before replacing them.</p>
      <table className="w-full text-sm"><thead><tr><th className="text-left">Field</th><th>Saved</th><th>Your draft</th></tr></thead><tbody>
        {Object.entries(draft.report).filter(([key, value]) => !Array.isArray(value) && value !== day.report[key as keyof typeof day.report]).map(([key, value]) => <tr key={key}><td className="py-2">{formatEnumLabel(key.replace(/([a-z])([A-Z])/g, '$1_$2'))}</td><td className="text-center">{String(day.report[key as keyof typeof day.report] ?? 'Not entered')}</td><td className="text-center">{String(value ?? 'Not entered')}</td></tr>)}
        {(day.report.rackCounts || draft.report.rackCounts)?.map(row => <tr key={row.id}><td className="py-2">Bin {row.bin}: closing / new rolls</td><td className="text-center">{row.closingNumber ?? '—'} / {row.finishedRolls}</td><td className="text-center">{draft.report.rackCounts?.find(edited => edited.id === row.id)?.closingNumber ?? 'New / uncounted'} / {draft.report.rackCounts?.find(edited => edited.id === row.id)?.finishedRolls ?? 0}</td></tr>)}
      </tbody></table>
    </Modal>}
    {confirmDayDialog}
    <Modal isOpen={reopening} onClose={() => setReopening(false)} title="Reopen this lottery day?" size="sm"
      footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setReopening(false)}>Cancel</Button>
        <Button disabled={reopenReason.trim().length < 3 || operation.blocked} onClick={() => { setReopening(false); void mutate('reopen', { reason: reopenReason.trim() }); }}>Reopen day</Button></div>}>
      <p className="mb-3 text-sm text-muted-foreground">Its totals leave reports until the day is closed again. The reason is kept in the day's history.</p>
      <Input label="Reason for reopening" value={reopenReason} maxLength={300} onChange={e => setReopenReason(e.target.value)} autoFocus />
    </Modal>
  </div>;
}
