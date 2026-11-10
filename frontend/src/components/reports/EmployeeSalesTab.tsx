import { SummaryStrip } from '@/components/common/Workspace';
import { Alert } from '@/components/ui/Alert';
import { LoadingState } from '@/components/ui/LoadingState';
import { reportService } from '@/services/api';
import { AboutNumbers } from '@/components/common/AboutNumbers';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { useUrlFilter, useUrlFilterPatch } from '@/hooks/useUrlFilter';
import { Card, CardContent } from '@/components/ui/Card';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { Pagination } from '@/components/common/Pagination';
import { formatEnumLabel, formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import type { SalesReportData } from '@/types';

type EmployeeRow = { user: { id: string; firstName: string; lastName: string; role: string }; totalRevenue: number; grossCollected: number; transactionCount: number; avgTransaction: number | null };
type EmployeeReport = { data: EmployeeRow[]; period: { start: string; end: string; endExclusive: boolean; timezone: string }; historyWarning?: string | null; summary: { netCollected: number; transactions: number } };
export function EmployeeSalesTab({ locationId }: { locationId: string }) {
  const [startDate] = useUrlFilter('employeeFrom'), [endDate] = useUrlFilter('employeeTo');
  const patchFilters = useUrlFilterPatch();
  const [employeeId, setEmployeeId] = useUrlFilter('employee'), [pageRaw, setPageRaw] = useUrlFilter('activityPage', '1');
  const page = /^\d+$/.test(pageRaw) && Number(pageRaw) >= 1 && Number(pageRaw) <= 1_000_000_000 ? Number(pageRaw) : 1;
  const listing = useScopedQuery<EmployeeReport>(['employee-sales', locationId, startDate, endDate], async signal => (await reportService.getEmployeeSales({ locationId: locationId || undefined, startDate: startDate || undefined, endDate: endDate || undefined }, signal)).data);
  const { data: report, error, loading } = listing;
  const selected = report?.data.find(employee => employee.user.id === employeeId);
  const end = report?.period.endExclusive ? new Date(new Date(report.period.end).getTime() - 1).toISOString() : report?.period.end;
  const details = useScopedQuery<SalesReportData>(['employee-sales-details', locationId, employeeId, report?.period.start, end, page], async signal => (await reportService.getSales({ locationId: locationId || undefined, userId: employeeId, startDate: report?.period.start, endDate: end, entryPage: page }, signal)).data.data, !!selected && !!report && !error);
  const { data: detail, error: detailError, loading: detailLoading } = details;
  const periodDate = (value: string) => formatDate(value, report?.period.timezone);
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-3 items-end">
      <DateRangePicker label="Employee sales dates" emptyLabel="Month to date" startDate={startDate} endDate={endDate} timezone={report?.period.timezone} onChange={range => patchFilters({ employeeFrom: range.startDate, employeeTo: range.endDate })} />
    </div>
    {report && <p className="text-sm text-muted-foreground">From {periodDate(report.period.start)} to {periodDate(report.period.endExclusive ? new Date(new Date(report.period.end).getTime() - 1).toISOString() : report.period.end)}. Leave the dates blank for this month so far.</p>}
    <AboutNumbers timezone={report?.period.timezone}>
      <p>Sales include tax. Refunds and voids come off in the period they happen and count against the person who made the original sale.</p>
      <p>Average sale uses sales before refunds.</p>
    </AboutNumbers>
    {error && <Alert tone="error" title={error} action={<Button variant="outline" onClick={listing.refresh}>Retry</Button>} />}
    {loading && <LoadingState label="Loading employee activity…" />}
    {report && <>
      {report.historyWarning && <p role="status" className="text-warning">{report.historyWarning}</p>}
      <SummaryStrip items={[
        { label: 'Employees with activity', value: report.data.length },
        { label: 'Sales after refunds', value: formatCurrency(report.summary.netCollected) },
        { label: 'Number of sales', value: report.summary.transactions ?? '\u2014' },
      ]} />
      {report.data.length === 0 ? <p className="text-center py-8 text-muted-foreground">No employee activity for this period</p> : <Card><CardContent className="p-0"><Table>
        <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Role</TableHead><TableHead className="text-right">Number of sales</TableHead><TableHead className="text-right">Sales after refunds</TableHead><TableHead className="text-right">Average sale</TableHead></TableRow></TableHeader>
        <TableBody>{report.data.map(employee => <TableRow key={employee.user.id}>
          <TableCell><button className="text-primary underline text-left py-3" aria-label={`View activity for ${employee.user.firstName} ${employee.user.lastName}`} onClick={() => setEmployeeId(employee.user.id)}>{employee.user.firstName} {employee.user.lastName}</button></TableCell>
          <TableCell>{formatEnumLabel(employee.user.role)}</TableCell><TableCell className="text-right tabular-nums">{employee.transactionCount}</TableCell>
          <TableCell className="text-right tabular-nums">{formatCurrency(employee.totalRevenue)}</TableCell><TableCell className="text-right tabular-nums">{employee.avgTransaction == null ? '\u2014' : formatCurrency(employee.avgTransaction)}</TableCell>
        </TableRow>)}</TableBody>
      </Table></CardContent></Card>}
    </>}
    <Modal isOpen={!!employeeId} onClose={() => setEmployeeId('')} title={selected ? `Activity - ${selected.user.firstName} ${selected.user.lastName}` : 'Employee activity'} size="lg">
      {loading && <LoadingState label="Loading employee…" />}
      {!loading && !selected && !error && <p>No activity is available for this employee in the selected period.</p>}
      {error && <Alert tone="error" title={error} action={<Button variant="outline" onClick={listing.refresh}>Retry employee</Button>} />}
      {detailLoading && <LoadingState label="Loading activity…" />}
      {detailError && <Alert tone="error" title={detailError} action={<Button variant="outline" onClick={details.refresh}>Retry details</Button>} />}
      {detail && <div className="space-y-3">
        <p>Sales after refunds: <strong>{formatCurrency(detail.summary.totalSales)}</strong>. {detail.pagination.entryCount} {detail.pagination.entryCount === 1 ? 'entry' : 'entries'} (sales, refunds and voids).</p>
        {detail.historyWarning && <p role="status">{detail.historyWarning}</p>}
        {detail.entries.length === 0 ? <p>No activity in this period</p> : <div className="divide-y border rounded-lg">{detail.entries.map(entry => <div key={entry.kind + entry.id} className="flex justify-between gap-3 px-4 py-3 text-sm">
          <div className="min-w-0"><p className="font-medium break-all">{entry.saleNumber}</p><p className="text-muted-foreground">{formatEnumLabel(entry.kind)} · {formatDateTime(entry.createdAt, detail.period.timezone)} · {formatEnumLabel(entry.method)}</p></div>
          <p className="font-bold tabular-nums shrink-0">{formatCurrency(entry.total)}</p>
        </div>)}</div>}
        <Pagination page={detail.pagination.entries.page} totalPages={detail.pagination.entries.totalPages} onPageChange={value => setPageRaw(String(value))} totalItems={detail.pagination.entryCount} itemName="entries" />
      </div>}
    </Modal>
  </div>;
}
