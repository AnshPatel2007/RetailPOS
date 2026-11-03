import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { ManagementPage } from '@/components/common/Workspace';
import { Select } from '@/components/ui/Select';
import { useState } from 'react';
import { payrollService } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { OperationRecovery } from '@/components/common/OperationRecovery';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { formatCurrency } from '@/lib/utils';
import { useScopedQuery, invalidateScopedQueries } from '@/hooks/useScopedQuery';
import { useSavedOperation } from '@/hooks/useSavedOperation';
import { useUrlFilter, useUrlPage } from '@/hooks/useUrlFilter';
import toast from 'react-hot-toast';

type Action = 'APPROVE' | 'REJECT' | 'REOPEN' | 'PAY';
export function Payroll() {
  const user = useAuthStore(state => state.user);
  const [page, setPage] = useUrlPage(), [record, setRecord] = useUrlFilter('record');
  const [entryPage, setEntryPage] = useState(1), [action, setAction] = useState<Action>('APPROVE');
  const [reason, setReason] = useState(''), [reference, setReference] = useState(''), [paymentMethod, setPaymentMethod] = useState('BANK_TRANSFER');
  const [rates, setRates] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false);
  const [paidAt, setPaidAt] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  const query = useScopedQuery<any>(['payroll', page], signal => payrollService.get(user?.locationId || '', page, signal).then(response => response.data.data), user?.role === 'ADMIN', 30000, { paused: busy || Object.keys(rates).length > 0 });
  const detail = useScopedQuery<any>(['payroll-record', record, entryPage], signal => payrollService.detail(record, entryPage, signal).then(response => response.data.data), !!record && user?.role === 'ADMIN');
  const operation = useSavedOperation('payroll', '/payroll/expenses/', () => { setRecord(''); setReason(''); setReference(''); toast.success('Payroll record saved'); });
  const data = query.data, expense = detail.data?.expense;
  const chosenAction: Action = expense?.status === 'APPROVED' ? 'PAY' : expense?.status === 'REJECTED' ? 'REOPEN' : action;
  const mutate = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try { await work(); invalidateScopedQueries(); toast.success('Payroll updated'); }
    catch (error) { toast.error((error as { response?: { data?: { error?: string } } }).response?.data?.error || 'Payroll could not be updated'); }
    finally { setBusy(false); }
  };
  const selectRecord = (id: string) => { setRecord(id); setEntryPage(1); setAction('APPROVE'); setReason(''); setReference(''); };
  const recordAction = () => {
    if (!expense) return;
    void operation.submit({ label: `${expense.expenseNumber}: ${chosenAction.toLowerCase()} ${formatCurrency(expense.amount)}`,
      path: `/payroll/expenses/${expense.id}/review`, payload: { action: chosenAction, reason: reason.trim(), expectedAmount: expense.amount,
        expectedUpdatedAt: expense.updatedAt, ...(chosenAction === 'PAY' ? { paymentMethod, reference: reference.trim(), paidAt: new Date(paidAt).toISOString() } : {}) } });
  };
  const date = (value: string) => new Date(value).toLocaleDateString(undefined, { timeZone: data?.location?.timezone });
  return <ManagementPage className=" space-y-6">
    <PageHeader title="Payroll" subtitle="Review gross wages, approve obligations and record completed payments" />
    <OperationRecovery operation={operation} />
    {query.error && <div role="alert" className="space-y-2"><p>{query.error}</p><Button variant="outline" onClick={query.refresh}>Retry payroll</Button></div>}
    {query.loading && <p role="status">{data ? 'Updating payroll. Previous results are shown.' : 'Loading payroll...'}</p>}
    {data && <fieldset disabled={busy || operation.blocked || query.loading || !!query.error} className="space-y-6 min-w-0">
      <Card><CardHeader><CardTitle>{data.location.name}: Pay schedule</CardTitle></CardHeader><CardContent className="space-y-3">
        <Select aria-label="Pay frequency" className="p-2 rounded border bg-background" value={data.location.payrollFrequency} onChange={event => void mutate(() => payrollService.setSchedule(user!.locationId!, event.target.value))}><option value="WEEKLY">Weekly — Monday to Sunday</option><option value="MONTHLY">Monthly — calendar month</option></Select>
        <p className="text-sm text-muted-foreground">Periods use {data.location.timezone}. Rate and schedule changes apply to future clock-ins. Completed periods create pending obligations for owner review.</p>
        <p className="text-sm text-muted-foreground">Straight-time gross wages only. Overtime, leave, deductions, withholding and actual bank transfers require your payroll process. Recording a bank or check payment here does not send money.</p>
        <Button onClick={() => void mutate(() => payrollService.process(user!.locationId!))}>Post completed periods to Expenses</Button>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Employee hourly rates</CardTitle></CardHeader><CardContent>
        {data.staff.map((staff: any) => <div key={staff.id} className="payroll-rate-row"><div className="flex-1 min-w-40"><p className="font-medium">{staff.firstName} {staff.lastName}{!staff.isActive && ' (inactive)'}</p><p className="text-sm text-muted-foreground">{staff.email}</p></div><Input label="Hourly rate" aria-label={`Hourly rate for ${staff.firstName} ${staff.lastName}`} type="number" min="0" max="10000" step="0.01" placeholder="Not set" value={rates[staff.id] ?? (staff.hourlyRate === null ? '' : String(staff.hourlyRate))} onChange={event => setRates({ ...rates, [staff.id]: event.target.value })} /><Button disabled={busy} onClick={() => void mutate(async () => { await payrollService.setRate(staff.id, (rates[staff.id] ?? String(staff.hourlyRate ?? '')) === '' ? null : Number(rates[staff.id] ?? staff.hourlyRate)); setRates(current => { const next = { ...current }; delete next[staff.id]; return next; }); })}>Save rate</Button></div>)}
      </CardContent></Card>
      {data.unratedShifts > 0 && <p className="text-sm text-warning">{data.unratedShifts} closed shifts have no saved rate and are excluded. Historical pay is not guessed.</p>}
      <Card><CardHeader><CardTitle>Payroll obligations</CardTitle></CardHeader><CardContent>
        {!data.runs.length ? <p>No completed payroll obligations in this page.</p> : <div className="overflow-x-auto"><Table scrollLabel="Payroll records" className="w-full text-sm"><TableHeader><TableRow className="text-left border-b"><TableHead className="p-2">Employee</TableHead><TableHead className="p-2">Payroll</TableHead><TableHead numeric className="p-2">Gross wages</TableHead><TableHead className="p-2">Status</TableHead><TableHead className="p-2">Review</TableHead></TableRow></TableHeader><TableBody>{data.runs.map((run: any) => <TableRow key={run.id} className="border-b"><TableCell className="p-2">{run.user.firstName} {run.user.lastName}</TableCell><TableCell className="p-2 break-words max-w-sm">{run.description}</TableCell><TableCell className="p-2 tabular-nums">{formatCurrency(run.amount)}</TableCell><TableCell className="p-2">{run.status}</TableCell><TableCell className="p-2"><Button size="sm" variant="outline" onClick={() => selectRecord(run.id)}>Review payroll</Button></TableCell></TableRow>)}</TableBody></Table></div>}
        <Pagination page={page} totalPages={data.pagination.totalPages} totalItems={data.pagination.total} itemName="payroll obligations" onPageChange={setPage} />
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Unposted wage entries</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground mb-3">Up to 50 recent shift segments, including the current period. Post completed periods to review them above.</p>{!data.entries.length ? <p>No unposted wage entries.</p> : <div className="overflow-x-auto"><Table scrollLabel="Payroll records" className="w-full text-sm"><TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Period start</TableHead><TableHead numeric>Hours</TableHead><TableHead numeric>Gross wages</TableHead></TableRow></TableHeader><TableBody>{data.entries.map((entry: any) => <TableRow key={entry.id}><TableCell className="p-2">{entry.user.firstName} {entry.user.lastName}</TableCell><TableCell>{date(entry.periodStart)}</TableCell><TableCell numeric>{(entry.seconds / 3600).toFixed(2)}</TableCell><TableCell>{formatCurrency(entry.grossPay)}</TableCell></TableRow>)}</TableBody></Table></div>}</CardContent></Card>
    </fieldset>}
    <Modal isOpen={!!record} onClose={() => { if (!operation.busy) setRecord(''); }} title="Review Payroll" size="lg">
      <div className="space-y-4">
        {detail.loading && <p role="status">Loading wage entries...</p>}
        {detail.error && <div role="alert"><p>{detail.error}</p><Button onClick={detail.refresh}>Retry wage entries</Button></div>}
        {expense && <>
          <p className="font-semibold">{expense.user.firstName} {expense.user.lastName} — {formatCurrency(expense.amount)} — {expense.status}</p><p className="text-sm">{expense.description}</p>
          <div className="overflow-x-auto"><Table scrollLabel="Payroll records" className="w-full text-sm"><TableHeader><TableRow><TableHead>Shift</TableHead><TableHead numeric>Hours</TableHead><TableHead numeric>Saved rate</TableHead><TableHead numeric>Gross wages</TableHead></TableRow></TableHeader><TableBody>{detail.data.entries.map((entry: any) => <TableRow key={entry.id}><TableCell className="p-2">{new Date(entry.shift.clockInAt).toLocaleString()}</TableCell><TableCell numeric>{(entry.seconds / 3600).toFixed(2)}</TableCell><TableCell>{formatCurrency(entry.hourlyRate)}</TableCell><TableCell>{formatCurrency(entry.grossPay)}</TableCell></TableRow>)}</TableBody></Table></div>
          {!detail.data.entries.length && <p role="status">No recorded shift entries. Review the original wage documents for this legacy/manual obligation.</p>}
          <Pagination page={entryPage} totalPages={detail.data.pagination.totalPages} onPageChange={setEntryPage} />
          <h3 className="font-semibold">Review and payment history</h3>
          {!detail.data.history.length && <p className="text-sm">No recorded review or payment history.</p>}
          {detail.data.history.map((event: any) => <div key={event.id} className="rounded border p-3 text-sm"><p>{event.result.action} — {new Date(event.createdAt).toLocaleString()} — {event.user.firstName} {event.user.lastName}</p><p>{event.result.reason}</p>{event.result.reference && <p>{event.result.paymentMethod}: {event.result.reference}</p>}</div>)}
          {expense.status !== 'PAID' && <fieldset disabled={operation.blocked || detail.loading || !!detail.error} className="space-y-3">
            <label className="block">Action<Select aria-label="Payroll action" className="block p-2 rounded border bg-background" value={expense.status === 'APPROVED' ? 'PAY' : expense.status === 'REJECTED' ? 'REOPEN' : action} onChange={event => setAction(event.target.value as Action)}>{expense.status === 'PENDING' ? <><option value="APPROVE">Approve gross wages</option><option value="REJECT">Reject for review</option></> : expense.status === 'REJECTED' ? <option value="REOPEN">Return to review</option> : <option value="PAY">Record completed payment</option>}</Select></label>
            <Input label="Reason" value={reason} maxLength={500} onChange={event => setReason(event.target.value)} required />
            {expense.status === 'APPROVED' && <><label className="block">Payment method<Select aria-label="Payroll payment method" className="block p-2 rounded border bg-background" value={paymentMethod} onChange={event => setPaymentMethod(event.target.value)}><option value="BANK_TRANSFER">Bank transfer already completed</option><option value="CHECK">Check issued</option><option value="EXTERNAL_CASH">Cash paid outside the register</option><option value="DRAWER_CASH">Cash paid from my open drawer</option></Select></label><Input label="Payment reference" value={reference} maxLength={150} onChange={event => setReference(event.target.value)} required /><Input label="Payment time (this device)" type="datetime-local" value={paidAt} onChange={event => setPaidAt(event.target.value)} required /></>}
            <Button disabled={!reason.trim() || (expense.status === 'APPROVED' && (!reference.trim() || !paidAt))} onClick={recordAction}>{expense.status === 'APPROVED' ? 'Record payment' : 'Save review'}</Button>
          </fieldset>}
          <OperationRecovery operation={operation} />
        </>}
      </div>
    </Modal>
  </ManagementPage>;
}
