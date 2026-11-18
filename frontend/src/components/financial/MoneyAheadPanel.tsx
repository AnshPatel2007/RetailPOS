import React, { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Plus } from 'lucide-react';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { financialService, apiErrorMessage } from '@/services/api';
import { formatCurrency } from '@/lib/utils';
import { friendlyDate } from '@/lib/calendarDates';
import { SummaryStrip } from '@/components/common/Workspace';
import { AboutNumbers } from '@/components/common/AboutNumbers';
import { EmptyState } from '@/components/common/EmptyState';
import { RowActions } from '@/components/common/RowActions';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DialogActions } from '@/components/ui/DialogActions';
import { Input } from '@/components/ui/Input';
import { LoadingState } from '@/components/ui/LoadingState';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { useConfirm } from '@/components/ui/useConfirm';
import { PlannedItemModal, WEEKDAYS, type PlannedItem } from './PlannedItemModal';
import toast from 'react-hot-toast';

interface CashEntry {
  key: string; flow: 'IN' | 'OUT'; kind: string; label: string; amount: number; estimate: boolean;
  note?: string; saleDays?: string[]; dueDate?: string; href?: string;
}
interface PlanDay { date: string; weekday: number; in: number; out: number; balance: number | null; entries: CashEntry[] }
interface Settings {
  cardDepositDays: number; cardFeePercent: number; salesTaxFrequency: 'NONE' | 'MONTHLY' | 'QUARTERLY'; salesTaxDueDay: number;
  lotterySweepWeekday: number | null; startingMoney: number | null; startingMoneyDate: string | null;
}
export interface CashPlanReport {
  plan: { today: string; learning: boolean; startingMoney: number | null; days: PlanDay[];
    totals: { in: number; out: number; lowest: { date: string; balance: number } | null }; tight: (PlanDay & { short: boolean }) | null };
  tightSentence: string | null; timezone: string; settings: Settings; notes: string[]; items: PlannedItem[]; hints: { lotteryWeekly: number | null };
}

/** "about $1,850": to the nearest $10, and the nearest $100 from $10,000 up (the alert's rounding). */
const about = (value: number) => {
  const step = Math.abs(value) < 10000 ? 10 : 100;
  return 'about ' + (value < 0 ? '-' : '') + formatCurrency(Math.round(Math.abs(value) / step) * step).replace(/\.00$/, '');
};
const shown = (value: number, estimate: boolean) => estimate ? about(value) : formatCurrency(value);
const monthDay = (day: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z'));
const weekdayShort = (day: string) => new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z'));
const listed = (parts: string[]) => parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0] ?? '';
const dayName = (day: string, today: string, tomorrow: string) => day === today ? 'Today' : day === tomorrow ? 'Tomorrow' : `${weekdayShort(day)}, ${monthDay(day)}`;

/** Where an entry comes from, in plain words. */
function entryNote(entry: CashEntry) {
  if (entry.dueDate) return 'Overdue since ' + monthDay(entry.dueDate);
  if (entry.saleDays?.length) return 'Card sales of ' + listed(entry.saleDays.map(weekdayShort));
  return entry.note ?? '';
}

function EntryLine({ entry }: { entry: CashEntry }) {
  const note = entryNote(entry);
  const name = entry.href ? <Link className="underline-offset-2 hover:underline" to={entry.href}>{entry.label}</Link> : entry.label;
  return <li className="flex flex-wrap items-baseline justify-between gap-x-3">
    <span>{entry.flow === 'IN' ? '+ ' : '− '}{name}{note && <span className="text-muted-foreground"> · {note}</span>}</span>
    <span className="tabular-nums">{shown(entry.amount, entry.estimate)}</span>
  </li>;
}

/**
 * Money Ahead (Finances, owners only): the next 14 store days of money coming in and
 * going out, from the store's records and the owner's own planned items.
 */
export function MoneyAheadPanel({ onActions }: { onActions?: (actions: React.ReactNode) => void }) {
  const [confirm, confirmDialog] = useConfirm();
  const query = useScopedQuery<CashPlanReport>(['cash-plan'], async signal => (await financialService.getCashPlan(signal)).data.data);
  const report = query.data;
  const [moneyOpen, setMoneyOpen] = useState(false), [settingsOpen, setSettingsOpen] = useState(false);
  const [itemOpen, setItemOpen] = useState(false), [editing, setEditing] = useState<PlannedItem | null>(null);

  useEffect(() => {
    onActions?.(<>
      <Button variant="outline" onClick={() => setSettingsOpen(true)} disabled={!report}>Settings</Button>
      <Button variant="outline" onClick={() => { setEditing(null); setItemOpen(true); }} disabled={!report}><Plus className="h-4 w-4 mr-2" />Add Planned Item</Button>
      <Button variant="primary" onClick={() => setMoneyOpen(true)} disabled={!report}>Update Money Today</Button>
    </>);
    return () => onActions?.(null);
  }, [onActions, report]);

  if (query.loading && !report) return <LoadingState label="Working out the next 14 days…" />;
  if (!report) return <Alert tone="error" title="Money Ahead could not be loaded." action={<Button variant="outline" onClick={() => void query.refresh()}>Retry</Button>}>{query.error}</Alert>;

  const { plan, settings } = report;
  const tomorrow = plan.days[1]?.date ?? '';
  const moneyCurrent = plan.startingMoney !== null;
  const anyEstimate = (flow: 'IN' | 'OUT', days = plan.days) => days.some(day => day.entries.some(entry => entry.flow === flow && entry.estimate));
  // A day's balance is "about" once any estimate has gone into it, that day or before.
  let estimated = false;
  const balanceEstimated = plan.days.map(day => (estimated = estimated || day.entries.some(entry => entry.estimate)));
  const lowestIndex = plan.totals.lowest ? plan.days.findIndex(day => day.date === plan.totals.lowest!.date) : -1;
  const remove = async (item: PlannedItem) => {
    if (!await confirm({ title: `Remove ${item.label}?`, message: 'It leaves the plan. Nothing else changes.', confirmLabel: 'Remove', destructive: true })) return;
    try { await financialService.deleteCashPlanItem(item.id); toast.success('Planned item removed'); void query.refresh(); }
    catch (error) { toast.error(apiErrorMessage(error, 'The planned item could not be removed.')); }
  };
  const when = (item: PlannedItem) => item.repeat === 'ONCE' ? 'Once, ' + friendlyDate(item.date ?? '')
    : (item.repeat === 'WEEKLY' ? `Every ${WEEKDAYS[item.weekday ?? 0]}` : `Monthly on day ${item.dayOfMonth}`) + (item.endsOn ? `, until ${friendlyDate(item.endsOn)}` : '');

  return <div className="space-y-6">
    {confirmDialog}
    {plan.learning && <Alert tone="info" title="Still learning this store's sales.">
      Money Ahead needs four weeks of sales to expect each weekday's takings. Bills, deliveries, payroll and planned items are already in the plan.
    </Alert>}
    {report.tightSentence && <Alert tone={plan.tight?.short ? 'error' : 'warning'} title={report.tightSentence} />}
    <SummaryStrip items={[
      { label: 'Money today', value: moneyCurrent ? formatCurrency(plan.startingMoney!) : 'Not entered',
        detail: moneyCurrent ? 'This morning, bank and safe' : settings.startingMoneyDate ? 'Last entered ' + friendlyDate(settings.startingMoneyDate) : 'Enter it to see what is left each day',
        action: <Button variant="ghost" onClick={() => setMoneyOpen(true)}>{moneyCurrent ? 'Change' : 'Enter'}</Button> },
      { label: 'Lowest point', value: plan.totals.lowest ? shown(plan.totals.lowest.balance, balanceEstimated[lowestIndex]) : '—', tone: plan.totals.lowest && plan.totals.lowest.balance < 0 ? 'danger' : 'default',
        detail: plan.totals.lowest ? dayName(plan.totals.lowest.date, plan.today, tomorrow) : 'Needs money today' },
      { label: 'Going out, 14 days', value: shown(plan.totals.out, anyEstimate('OUT')) },
      { label: 'Coming in, 14 days', value: shown(plan.totals.in, anyEstimate('IN')), detail: plan.learning ? 'Sales are counted once the store is learned' : undefined },
    ]} />

    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Day</TableHead>
            <TableHead className="text-right">Coming in</TableHead>
            <TableHead className="text-right">Going out</TableHead>
            <TableHead className="text-right">Left at day's end</TableHead>
            <TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plan.days.map((day, index) => <TableRow key={day.date} className={plan.tight?.date === day.date ? 'bg-warning/10' : undefined}>
            <TableCell className="font-medium">{dayName(day.date, plan.today, tomorrow)}</TableCell>
            <TableCell className="text-right tabular-nums">{day.in ? shown(day.in, anyEstimate('IN', [day])) : '—'}</TableCell>
            <TableCell className="text-right tabular-nums">{day.out ? shown(day.out, anyEstimate('OUT', [day])) : '—'}</TableCell>
            <TableCell className={`text-right tabular-nums${day.balance !== null && day.balance < 0 ? ' text-destructive font-semibold' : ''}`}>
              {day.balance === null ? '—' : shown(day.balance, balanceEstimated[index])}</TableCell>
            <TableCell>
              {day.entries.length ? <details>
                <summary className="cursor-pointer text-sm">{day.entries.length} {day.entries.length === 1 ? 'item' : 'items'}</summary>
                <ul className="mt-2 min-w-[16rem] space-y-1 text-sm">{day.entries.map(entry => <EntryLine key={entry.key} entry={entry} />)}</ul>
              </details> : <span className="text-sm text-muted-foreground">Nothing planned</span>}
            </TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </Card>

    <Card>
      <div className="flex items-center justify-between gap-2 border-b p-4"><h3 className="font-medium">Planned Items</h3></div>
      {report.items.length === 0 ? <EmptyState icon={Calendar} title="No planned items"
        hint="Add money the records cannot show: a loan payment, an owner draw, an insurance bill paid by the bank." /> :
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Money</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>When</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {report.items.map(item => <TableRow key={item.id}>
              <TableCell className="font-medium">{item.label}</TableCell>
              <TableCell>{item.direction === 'IN' ? 'Comes in' : 'Goes out'}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCurrency(item.amount)}</TableCell>
              <TableCell>{when(item)}</TableCell>
              <TableCell><RowActions name={item.label} primary={{ label: 'Edit', onAction: () => { setEditing(item); setItemOpen(true); } }}
                items={[{ id: 'remove', label: 'Remove', destructive: true, onAction: () => void remove(item) }]} /></TableCell>
            </TableRow>)}
          </TableBody>
        </Table>}
    </Card>

    <AboutNumbers timezone={report.timezone}>
      <p>Coming in: each weekday&apos;s usual sales after refunds (the middle of the last six such days), split by how customers usually pay. Cash counts the same day; card money arrives {settings.cardDepositDays === 0 ? 'the same day' : `${settings.cardDepositDays} business ${settings.cardDepositDays === 1 ? 'day' : 'days'} later`}{settings.cardFeePercent ? `, less a ${settings.cardFeePercent}% card fee` : ''}. Gift cards, store credit and house accounts bring no new money.</p>
      <p>Going out: unpaid bills on their due date (overdue ones today), recurring expenses, payroll at the end of each pay period (about the last three periods), supplier deliveries on their delivery days (an open order&apos;s own amount, or about the last four deliveries; paid on delivery unless the supplier&apos;s terms say &quot;net&quot; days), sales tax when its schedule is set, and your planned items. Deliveries already received count only once their bill is entered in Expenses.</p>
      <p>{settings.lotterySweepWeekday === null ? 'The lottery is left out. If the lottery takes its money from the bank each week, choose the day in Settings.' : `Lottery sales come in each day, and on ${WEEKDAYS[settings.lotterySweepWeekday]}s the lottery takes about the last seven days of them.`} &quot;About&quot; marks an estimate from the store&apos;s history; every other amount is a record.</p>
      {report.notes.map(note => <p key={note}>{note}</p>)}
    </AboutNumbers>

    <MoneyTodayModal isOpen={moneyOpen} current={moneyCurrent ? plan.startingMoney : null} onClose={() => setMoneyOpen(false)} onSaved={() => void query.refresh()} />
    <PlanSettingsModal isOpen={settingsOpen} settings={settings} lotteryWeekly={report.hints.lotteryWeekly} onClose={() => setSettingsOpen(false)} onSaved={() => void query.refresh()} />
    <PlannedItemModal isOpen={itemOpen} item={editing} onClose={() => setItemOpen(false)} onSaved={() => void query.refresh()} />
  </div>;
}

function MoneyTodayModal({ isOpen, current, onClose, onSaved }: { isOpen: boolean; current: number | null; onClose: () => void; onSaved: () => void }) {
  const formId = useId();
  const [value, setValue] = useState(''), [saving, setSaving] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (isOpen) { setValue(current === null ? '' : current.toFixed(2)); setError(''); } }, [isOpen, current]);
  const save = async (amount: number | null) => {
    setSaving(true); setError('');
    try { await financialService.updateCashPlanSettings({ startingMoney: amount }); onSaved(); onClose(); toast.success(amount === null ? 'Money today cleared' : 'Money today saved'); }
    catch (failure) { setError(apiErrorMessage(failure, 'Money today could not be saved. Try again.')); }
    finally { setSaving(false); }
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^-?\d+(\.\d{1,2})?$/.test(value.trim())) { setError('Enter the amount to the cent, like 8200.00.'); return; }
    void save(Number(value));
  };
  return <Modal isOpen={isOpen} onClose={() => { if (!saving) onClose(); }} title="Update Money Today" size="sm"
    description="What the business has this morning, so each day shows what is left."
    footer={<DialogActions form={formId} confirmLabel="Save" loading={saving} onCancel={onClose}
      remove={current !== null ? { label: 'Clear', onClick: () => void save(null), disabled: saving } : undefined} />}>
    <form id={formId} onSubmit={submit} className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <Input label="Money this morning" type="number" inputMode="decimal" step="0.01" value={value} onChange={event => setValue(event.target.value)} autoFocus
        description="The bank account and the safe. Leave out the cash in the registers' drawers." />
      <p className="text-sm text-muted-foreground">It counts for today only: enter it again on another day to keep the plan&apos;s balance up to date.</p>
    </form>
  </Modal>;
}

function PlanSettingsModal({ isOpen, settings, lotteryWeekly, onClose, onSaved }: { isOpen: boolean; settings: Settings; lotteryWeekly: number | null; onClose: () => void; onSaved: () => void }) {
  const formId = useId();
  const initial = () => ({ cardDepositDays: String(settings.cardDepositDays), cardFeePercent: String(settings.cardFeePercent), salesTaxFrequency: settings.salesTaxFrequency,
    salesTaxDueDay: String(settings.salesTaxDueDay), lotterySweepWeekday: settings.lotterySweepWeekday === null ? '' : String(settings.lotterySweepWeekday) });
  const [form, setForm] = useState(initial), [saving, setSaving] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (isOpen) { setForm(initial()); setError(''); } }, [isOpen]);
  const change = (field: keyof ReturnType<typeof initial>) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(current => ({ ...current, [field]: event.target.value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const fee = Number(form.cardFeePercent);
    if (!/^\d+(\.\d{1,2})?$/.test(form.cardFeePercent.trim()) || fee > 10) { setError('Enter the card fee as a percent from 0 to 10, like 2.75.'); return; }
    setSaving(true); setError('');
    try {
      await financialService.updateCashPlanSettings({ cardDepositDays: Number(form.cardDepositDays), cardFeePercent: fee, salesTaxFrequency: form.salesTaxFrequency,
        salesTaxDueDay: Number(form.salesTaxDueDay), lotterySweepWeekday: form.lotterySweepWeekday === '' ? null : Number(form.lotterySweepWeekday) });
      onSaved(); onClose(); toast.success('Money Ahead settings saved');
    } catch (failure) { setError(apiErrorMessage(failure, 'The settings could not be saved. Try again.')); }
    finally { setSaving(false); }
  };
  return <Modal isOpen={isOpen} onClose={() => { if (!saving) onClose(); }} title="Money Ahead Settings" size="sm"
    description="How money reaches and leaves this store's bank account."
    footer={<DialogActions form={formId} confirmLabel="Save Settings" loading={saving} onCancel={onClose} />}>
    <form id={formId} onSubmit={submit} className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <Select label="Card money reaches the bank" value={form.cardDepositDays} onChange={change('cardDepositDays')}>
        <option value="0">The same day</option>
        {[1, 2, 3, 4, 5].map(days => <option key={days} value={String(days)}>{days} business {days === 1 ? 'day' : 'days'} later</option>)}
      </Select>
      <Input label="Card fee (%)" type="number" inputMode="decimal" min="0" max="10" step="0.01" value={form.cardFeePercent} onChange={change('cardFeePercent')}
        description="What the card processor keeps from each deposit, if it is taken out before the money arrives." />
      <Select label="Sales tax" value={form.salesTaxFrequency} onChange={change('salesTaxFrequency')}>
        <option value="NONE">Leave it out</option>
        <option value="MONTHLY">Paid every month</option>
        <option value="QUARTERLY">Paid every quarter</option>
      </Select>
      {form.salesTaxFrequency !== 'NONE' && <Select label="Paid on day" value={form.salesTaxDueDay} onChange={change('salesTaxDueDay')}
        description={form.salesTaxFrequency === 'MONTHLY' ? 'Of the following month.' : 'Of January, April, July and October.'}>
        {Array.from({ length: 28 }, (_, index) => <option key={index} value={String(index + 1)}>{index + 1}</option>)}
      </Select>}
      <Select label="The lottery takes its money on" value={form.lotterySweepWeekday} onChange={change('lotterySweepWeekday')}
        description={lotteryWeekly !== null ? `Closed lottery days brought in ${about(lotteryWeekly)} a week lately.` : 'Lottery money is planned once a week of lottery days has been closed.'}>
        <option value="">Leave the lottery out</option>
        {WEEKDAYS.map((name, index) => <option key={name} value={String(index)}>{name}</option>)}
      </Select>
    </form>
  </Modal>;
}
