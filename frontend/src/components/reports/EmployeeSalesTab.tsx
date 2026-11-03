import { reportService } from '@/services/api';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { useUrlFilter, useUrlFilterPatch } from '@/hooks/useUrlFilter';
import { Card, CardContent } from '@/components/ui/Card';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { Pagination } from '@/components/common/Pagination';
import { formatCurrency } from '@/lib/utils';
import type { SalesReportData } from '@/types';

type EmployeeRow = { user: { id: string; firstName: string; lastName: string; role: string }; totalRevenue: number; grossCollected: number; transactionCount: number; avgTransaction: number };
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
  const periodDate = (value: string) => new Date(value).toLocaleDateString(undefined, { timeZone: report?.period.timezone });
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-3 items-end">
      <DateRangePicker label="Employee sales dates" emptyLabel="Month to date" startDate={startDate} endDate={endDate} timezone={report?.period.timezone} onChange={range => patchFilters({ employeeFrom: range.startDate, employeeTo: range.endDate })} />
    </div>
    <p className="text-sm text-muted-foreground">Leave dates blank for month to date. Collections include tax, less returns and voids recorded in this period, attributed to the original seller. Order averages use original purchases.</p>
    {report && <p className="text-sm text-muted-foreground">Calendar: {report.period.timezone}. From {periodDate(report.period.start)} to {periodDate(report.period.endExclusive ? new Date(new Date(report.period.end).getTime() - 1).toISOString() : report.period.end)}.</p>}
    {error && <div role="alert" className="text-destructive">{error} <Button variant="outline" onClick={listing.refresh}>Retry</Button></div>}
    {loading && <p role="status">Loading employee activity...</p>}
    {report && <>
      {report.historyWarning && <p role="status" className="text-warning">{report.historyWarning}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card><CardContent className="p-3 text-center"><p>Employees with activity</p><p className="text-2xl font-bold">{report.data.length}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p>Net collected</p><p className="text-2xl font-bold">{formatCurrency(report.summary.netCollected)}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p>Original sales</p><p className="text-2xl font-bold">{report.summary.transactions}</p></CardContent></Card>
      </div>
      {report.data.length === 0 ? <p className="text-center py-8 text-muted-foreground">No employee activity for this period</p> : <Card><CardContent className="p-0"><Table>
        <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Role</TableHead><TableHead className="text-right">Original sales</TableHead><TableHead className="text-right">Net collected</TableHead><TableHead className="text-right">Original order average</TableHead></TableRow></TableHeader>
        <TableBody>{report.data.map(employee => <TableRow key={employee.user.id}>
          <TableCell><button className="text-primary underline text-left py-3" aria-label={`View activity for ${employee.user.firstName} ${employee.user.lastName}`} onClick={() => setEmployeeId(employee.user.id)}>{employee.user.firstName} {employee.user.lastName}</button></TableCell>
          <TableCell>{employee.user.role.replace(/_/g, ' ')}</TableCell><TableCell className="text-right tabular-nums">{employee.transactionCount}</TableCell>
          <TableCell className="text-right tabular-nums">{formatCurrency(employee.totalRevenue)}</TableCell><TableCell className="text-right tabular-nums">{formatCurrency(employee.avgTransaction)}</TableCell>
        </TableRow>)}</TableBody>
      </Table></CardContent></Card>}
    </>}
    <Modal isOpen={!!employeeId} onClose={() => setEmployeeId('')} title={selected ? `Activity - ${selected.user.firstName} ${selected.user.lastName}` : 'Employee activity'} size="lg">
      {loading && <p role="status">Loading employee...</p>}
      {!loading && !selected && !error && <p>No activity is available for this employee in the selected period.</p>}
      {error && <div role="alert">{error} <Button variant="outline" onClick={listing.refresh}>Retry employee</Button></div>}
      {detailLoading && <p role="status">Loading activity...</p>}
      {detailError && <div role="alert">{detailError} <Button variant="outline" onClick={details.refresh}>Retry details</Button></div>}
      {detail && <div className="space-y-3">
        <p>Net collected: <strong>{formatCurrency(detail.summary.totalSales)}</strong>. {detail.pagination.entryCount} sale, return and void entries.</p>
        {detail.historyWarning && <p role="status">{detail.historyWarning}</p>}
        {detail.entries.length === 0 ? <p>No activity in this period</p> : <div className="divide-y border rounded-lg">{detail.entries.map(entry => <div key={entry.kind + entry.id} className="flex justify-between gap-3 px-4 py-3 text-sm">
          <div className="min-w-0"><p className="font-medium break-all">{entry.saleNumber}</p><p className="text-muted-foreground">{entry.kind} · {new Date(entry.createdAt).toLocaleString(undefined, { timeZone: detail.period.timezone })} · {entry.method.replace(/_/g, ' ')}</p></div>
          <p className="font-bold tabular-nums shrink-0">{formatCurrency(entry.total)}</p>
        </div>)}</div>}
        <Pagination page={detail.pagination.entries.page} totalPages={detail.pagination.entries.totalPages} onPageChange={value => setPageRaw(String(value))} totalItems={detail.pagination.entryCount} itemName="entries" />
      </div>}
    </Modal>
  </div>;
}
