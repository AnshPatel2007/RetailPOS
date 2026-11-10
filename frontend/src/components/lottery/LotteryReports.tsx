import { friendlyDate } from '@/lib/calendarDates';
import { ReactNode, useEffect } from 'react';
import { today } from '@internationalized/date';
import { useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import { useCalendarTimezone } from '@/hooks/useCalendarTimezone';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { useUrlFilter, useUrlFilterPatch } from '@/hooks/useUrlFilter';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { Button } from '@/components/ui/Button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { LotteryReports as Report, lotteryRead, lotteryMoney } from '@/services/lotteryWorkbench';
import { LotteryError } from './LotteryFields';

const csvCell = (value: unknown) => { const text = value == null ? '' : String(value); return '"' + (/^[=+@\t\r]/.test(text) || /^-[^\d]/.test(text) ? "'" : '') + text.replace(/"/g, '""') + '"'; };
export function LotteryReports({ locationId, onActionsChange }: { locationId: string; readOnly: boolean; onActionsChange: (node: ReactNode) => void }) {
  const timezone = useCalendarTimezone(), navigate = useNavigate();
  const [start] = useUrlFilter('lotteryFrom', today(timezone).set({ day: 1 }).toString()), [end] = useUrlFilter('lotteryTo', today(timezone).toString()), patch = useUrlFilterPatch();
  const [, setHistory] = useUrlFilter('history', '', false);
  const query = useScopedQuery<Report>(['lottery-reports', locationId, start, end], signal => lotteryRead('/reports', locationId, signal, { start, end }));
  const data = query.data, closed = data?.days.filter(day => day.status === 'CLOSED') || [];
  const sum = (key: 'scratchSales' | 'onlineSales' | 'payouts' | 'netCollections') => closed.reduce((total, day) => total + Number(day.totals?.[key] || 0), 0) + (data?.corrections.reduce((total, event) => total + Number(event.details[key] || 0), 0) || 0);
  const exportReport = () => {
    if (!data) return;
    const rows: unknown[][] = [['Date', 'Status', 'Scratch sales', 'Online sales', 'Prizes paid', 'Net collections', 'Tickets sold', 'Lottery earnings']];
    data.days.forEach(day => rows.push([day.businessDate, day.status, day.totals?.scratchSales, day.totals?.onlineSales, day.totals?.payouts, day.totals?.netCollections, day.totals?.totalScratchTickets, day.earningsPending ? 'Pending' : day.totals?.earnings ?? 'See recorded earnings']));
    if (data.corrections.length) { rows.push([], ['Correction date', 'Original date', 'Reference', 'Scratch sales change', 'Online sales change', 'Payout change', 'Collections change', 'Earnings change', 'Reason']); data.corrections.forEach(event => rows.push([event.details.postingDate, event.details.businessDate, event.details.reference, event.details.scratchSales, event.details.onlineSales, event.details.payouts, event.details.netCollections, event.details.earnings, event.details.reason])); }
    rows.push([], ['Recorded earnings', 'Date', 'Amount']); data.earnings.forEach(entry => rows.push([entry.reason, new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(entry.recognizedAt)), entry.amount]));
    const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'Lottery-' + start + '-' + end + '.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  useEffect(() => { onActionsChange(<Button variant="outline" disabled={!data || !!query.error} onClick={exportReport}><Download />Export</Button>); return () => onActionsChange(null); }, [onActionsChange, data, query.error, start, end, timezone]);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3"><DateRangePicker startDate={start} endDate={end} allowOpenRange={false} maxDays={367} onChange={range => patch({ lotteryFrom: range.startDate, lotteryTo: range.endDate })} /><span className="text-sm text-muted-foreground">{closed.length} closed days</span><Button variant="ghost" className="sm:ml-auto" onClick={() => setHistory('legacy')}>Earlier records</Button></div>
    <LotteryError error={query.error} retry={() => void query.refresh()} />{query.loading && !data && <p role="status">Loading daily reports…</p>}
    {data && <><div className="grid gap-3 grid-cols-2 lg:grid-cols-4">{[['Scratch sales', sum('scratchSales')], ['Online sales', sum('onlineSales')], ['Prizes paid', sum('payouts')], ['Net collections', sum('netCollections')]].map(([label, amount]) => <div key={label} className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-semibold tabular-nums">{lotteryMoney(amount)}</p></div>)}</div>
      <p className="text-xs text-muted-foreground">Period totals include closed days and recorded corrections.</p>
      <div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Scratch sales</TableHead><TableHead className="text-right">Online sales</TableHead><TableHead className="text-right">Prizes paid</TableHead><TableHead className="text-right">Collections</TableHead><TableHead className="text-right">Lottery earnings</TableHead></TableRow></TableHeader><TableBody>
        {data.days.map(day => <TableRow key={day.id}><TableCell><Button variant="ghost" onClick={() => navigate('/lottery?tab=daily&date=' + day.businessDate + '&lotteryView=online')}>{friendlyDate(day.businessDate)}</Button></TableCell><TableCell>{day.status === 'CLOSED' ? 'Closed' : 'Draft'}</TableCell>
          {(['scratchSales', 'onlineSales', 'payouts', 'netCollections'] as const).map(key => <TableCell key={key} className="text-right tabular-nums">{lotteryMoney(day.totals?.[key])}</TableCell>)}<TableCell className="text-right tabular-nums">{day.earningsPending ? 'Pending' : day.earningsIncomplete ? 'Recorded separately' : lotteryMoney(day.totals?.earnings)}</TableCell></TableRow>)}
        {!data.days.length && <TableRow><TableCell colSpan={7}>No daily entries in this period.</TableCell></TableRow>}
      </TableBody></Table></div>
    </>}
  </div>;
}
