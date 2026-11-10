import { presetRange, previousFullWeek } from '@/lib/calendarDates';
import { useCalendarTimezone } from '@/hooks/useCalendarTimezone';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { api, financialService, reportService } from '@/services/api';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { AutoRefreshStatus } from '@/components/common/AutoRefreshStatus';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { buildCsv, downloadCsv, formatDate, formatDateTime, formatEnumLabel } from '@/lib/utils';
import { apiErrorMessage } from '@/services/api';
import { Alert } from '@/components/ui/Alert';
import { LoadingState } from '@/components/ui/LoadingState';
import { Download } from 'lucide-react';
import toast from 'react-hot-toast';

/**
 * All data exports in one place: accounting journals (sales/expenses),
 * manufacturer scan-data CSVs, and the export history. Self-contained tab —
 * moved here from the Financial page during the report consolidation.
 */
export const ExportsTab: React.FC<{ onActions?: (actions: React.ReactNode) => void }> = ({ onActions }) => {
  const role = useAuthStore(state=>state.user?.role);
  const history = useScopedQuery<any[]>(['export-history'], async signal => (await api.get('/financial/exports', { signal })).data.data || []);
  const exportHistory = history.data || [];
  const loadHistory = history.refresh;
  const [busy, setBusy] = useState(false);
  // The accounting journals export exactly the store days chosen here.
  const timezone = useCalendarTimezone();
  const [journalStart, setJournalStart] = useState(() => presetRange('thisMonth', timezone)!.startDate);
  const [journalEnd, setJournalEnd] = useState(() => presetRange('thisMonth', timezone)!.endDate);
  const journalPeriod = { startDate: journalStart, endDate: journalEnd };
  const journalFile = (name: string) => `${name}-${journalStart}-to-${journalEnd}.csv`;

  const handleExportSales = useCallback(async () => {
    setBusy(true);
    try {
      const response = await financialService.exportSales({ startDate: journalStart, endDate: journalEnd });
      const data = response.data.data;
      const entries = data.entries || [];
      const csv = buildCsv(
        ['Date', 'Reference', 'Description', 'Debit Account', 'Credit Account', 'Amount', 'Tax', 'Payment Method'],
        entries.map((e: any) => [
          e.date, e.reference, e.description, e.debitAccount, e.creditAccount, e.amount, e.taxAmount, e.paymentMethod,
        ])
      );
      downloadCsv(csv, journalFile('sales-journal'));
      toast.success(`Exported ${data.recordCount} sales records`);
      loadHistory();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to export sales'));
    } finally { setBusy(false); }
  }, [loadHistory, journalStart, journalEnd]);

  const handleExportExpenses = useCallback(async () => {
    setBusy(true);
    try {
      const response = await financialService.exportExpenses({ startDate: journalStart, endDate: journalEnd });
      const data = response.data.data;
      const entries = data.entries || [];
      const csv = buildCsv(
        ['Date', 'Reference', 'Description', 'Debit Account', 'Credit Account', 'Amount', 'Vendor', 'Category'],
        entries.map((e: any) => [
          e.date, e.reference, e.description, e.debitAccount, e.creditAccount, e.amount, e.vendor, e.category,
        ])
      );
      downloadCsv(csv, journalFile('expenses-journal'));
      toast.success(`Exported ${data.recordCount} expense records`);
      loadHistory();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to export expenses'));
    } finally { setBusy(false); }
  }, [loadHistory, journalStart, journalEnd]);

  // ─── Tobacco / manufacturer scan-data export ───
  const [scanDataStart, setScanDataStart] = useState(() => previousFullWeek(timezone).startDate);
  const [scanDataEnd, setScanDataEnd] = useState(() => previousFullWeek(timezone).endDate);
  const [scanDataCategories, setScanDataCategories] = useState<string[]>([]);
  const categories = useScopedQuery<{ id: string; name: string }[]>(['export-categories'], async signal => (await api.get('/categories', { signal })).data.data || []);
  const allCategories = categories.data || [];
  const [scanDataExporting, setScanDataExporting] = useState(false);


  const handleExportScanData = useCallback(async () => {
    if (scanDataCategories.length === 0) {
      toast.error('Select at least one category (e.g. Tobacco, Cigarettes)');
      return;
    }
    setScanDataExporting(true);
    try {
      const res = await reportService.exportScanDataCSV({
        startDate: scanDataStart,
        endDate: scanDataEnd,
        categoryIds: scanDataCategories.join(','),
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `scan-data-${scanDataStart}-to-${scanDataEnd}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Scan data exported — upload it to your manufacturer portal');
    } catch (error: any) {
      toast.error(apiErrorMessage(error, 'Failed to export scan data'));
    } finally {
      setScanDataExporting(false);
    }
  }, [scanDataStart, scanDataEnd, scanDataCategories]);

  useEffect(() => {
    onActions?.(<>
      {role === 'ADMIN' && <Link className="page-action" to="/settings/jobs">Saved exports</Link>}
      <Button variant="outline" onClick={() => void handleExportSales()} disabled={busy || scanDataExporting}><Download />Export Sales</Button>
      <Button variant="outline" onClick={() => void handleExportExpenses()} disabled={busy || scanDataExporting}><Download />Export Expenses</Button>
      <Button variant="primary" onClick={() => void handleExportScanData()} disabled={busy || scanDataExporting || !scanDataCategories.length}><Download />{scanDataExporting ? 'Exporting...' : 'Export Scan Data CSV'}</Button>
    </>);
    return () => onActions?.(null);
  }, [onActions, role, busy, scanDataExporting, scanDataCategories.length, handleExportSales, handleExportExpenses, handleExportScanData]);

  return (
    <div className="space-y-6">
      <AutoRefreshStatus state={history} />
      <AutoRefreshStatus state={categories} />
      {categories.error && !categories.data && <Alert tone="error" title="Categories are unavailable." action={<Button variant="outline" onClick={categories.refresh}>Retry categories</Button>} />}
        <Card className="p-4">
          <h3 className="font-medium mb-1">Accounting Journals</h3>
          <p className="text-sm text-muted-foreground mb-4">Export Sales and Export Expenses cover these store days.</p>
          <DateRangePicker label="Journal dates" startDate={journalPeriod.startDate} endDate={journalPeriod.endDate} allowOpenRange={false}
            onChange={range => { setJournalStart(range.startDate); setJournalEnd(range.endDate); }} />
        </Card>
        <Card className="p-4">
          <h3 className="font-medium mb-1">Tobacco / Manufacturer Scan Data</h3>
          <p className="text-sm text-muted-foreground mb-4">Choose store dates and program categories.</p>
          <div className="mb-4"><DateRangePicker label="Scan data dates" startDate={scanDataStart} endDate={scanDataEnd} allowOpenRange={false} onChange={range => { setScanDataStart(range.startDate); setScanDataEnd(range.endDate); }} /></div>
          <div className="mb-4">
            <label className="block text-xs font-medium mb-1.5 text-muted-foreground">
              Program categories
            </label>
            <div className="flex flex-wrap gap-1.5">
              {allCategories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={scanDataCategories.includes(c.id)}
                  onClick={() =>
                    setScanDataCategories((prev) =>
                      prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]
                    )
                  }
                  className={`page-tab inline-flex items-center px-3 text-sm rounded-md border transition-colors ${
                    scanDataCategories.includes(c.id)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background hover:bg-muted border-input'
                  }`}
                >
                  {c.name}
                </button>
              ))}
              {allCategories.length === 0 && (
                <span className="text-xs text-muted-foreground">No categories found</span>
              )}
            </div>
          </div>
        </Card>

      {/* Export History */}
      {history.loading && <LoadingState label="Loading export history…" />}
      {history.error && !history.data && <Alert tone="error" title="Export history is unavailable." action={<Button variant="outline" onClick={history.refresh}>Retry history</Button>} />}
      <Card>
        <div className="p-4 border-b">
          <h3 className="font-medium">Export History</h3>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Format</TableHead>
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Records</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.data && exportHistory.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No exports yet
                </TableCell>
              </TableRow>
            ) : (
              exportHistory.map((exp) => (
                <TableRow key={exp.id}>
                  <TableCell>{formatDateTime(exp.createdAt, timezone)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{formatEnumLabel(exp.type)}</Badge>
                  </TableCell>
                  <TableCell>{exp.format}</TableCell>
                  <TableCell>
                    {formatDate(exp.startDate, timezone)} – {formatDate(exp.endDate, timezone)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{exp.recordCount}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};
