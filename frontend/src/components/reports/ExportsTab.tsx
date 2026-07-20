import React, { useState, useEffect, useCallback } from 'react';
import { financialService, reportService, categoryService } from '@/services/api';
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
import { buildCsv, downloadCsv } from '@/lib/utils';
import { Download } from 'lucide-react';
import toast from 'react-hot-toast';

/**
 * All data exports in one place: accounting journals (sales/expenses),
 * manufacturer scan-data CSVs, and the export history. Self-contained tab —
 * moved here from the Financial page during the report consolidation.
 */
export const ExportsTab: React.FC = () => {
  const [exportHistory, setExportHistory] = useState<any[]>([]);

  const loadHistory = useCallback(() => {
    financialService.getExportHistory()
      .then((res) => setExportHistory(res.data.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleExportSales = async () => {
    try {
      const response = await financialService.exportSales();
      const data = response.data.data;
      const entries = data.entries || [];
      const csv = buildCsv(
        ['Date', 'Reference', 'Description', 'Debit Account', 'Credit Account', 'Amount', 'Tax', 'Payment Method'],
        entries.map((e: any) => [
          e.date, e.reference, e.description, e.debitAccount, e.creditAccount, e.amount, e.taxAmount, e.paymentMethod,
        ])
      );
      downloadCsv(csv, `sales-journal-${new Date().toISOString().split('T')[0]}.csv`);
      toast.success(`Exported ${data.recordCount} sales records`);
      loadHistory();
    } catch {
      toast.error('Failed to export sales');
    }
  };

  const handleExportExpenses = async () => {
    try {
      const response = await financialService.exportExpenses();
      const data = response.data.data;
      const entries = data.entries || [];
      const csv = buildCsv(
        ['Date', 'Reference', 'Description', 'Debit Account', 'Credit Account', 'Amount', 'Vendor', 'Category'],
        entries.map((e: any) => [
          e.date, e.reference, e.description, e.debitAccount, e.creditAccount, e.amount, e.vendor, e.category,
        ])
      );
      downloadCsv(csv, `expenses-journal-${new Date().toISOString().split('T')[0]}.csv`);
      toast.success(`Exported ${data.recordCount} expense records`);
      loadHistory();
    } catch {
      toast.error('Failed to export expenses');
    }
  };

  // ─── Tobacco / manufacturer scan-data export ───
  const lastWeekMonday = () => {
    const d = new Date();
    const day = d.getDay() || 7; // Mon=1..Sun=7
    d.setDate(d.getDate() - day - 6); // Monday of the previous full week
    return d.toISOString().slice(0, 10);
  };
  const lastWeekSunday = () => {
    const d = new Date(lastWeekMonday() + 'T00:00:00');
    d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0, 10);
  };
  const [scanDataStart, setScanDataStart] = useState(lastWeekMonday());
  const [scanDataEnd, setScanDataEnd] = useState(lastWeekSunday());
  const [scanDataCategories, setScanDataCategories] = useState<string[]>([]);
  const [allCategories, setAllCategories] = useState<{ id: string; name: string }[]>([]);
  const [scanDataExporting, setScanDataExporting] = useState(false);

  useEffect(() => {
    categoryService.getAll().then((res) => setAllCategories(res.data.data || [])).catch(() => {});
  }, []);

  const handleExportScanData = async () => {
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
      toast.success('Scan data exported — upload it to your manufacturer portal');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to export scan data');
    } finally {
      setScanDataExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-6">
          <h3 className="font-medium mb-4">Export Sales Data</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Export sales transactions in accounting format (journal entries)
          </p>
          <Button onClick={handleExportSales}>
            <Download className="w-4 h-4 mr-2" />
            Export Sales
          </Button>
        </Card>
        <Card className="p-6">
          <h3 className="font-medium mb-4">Export Expenses Data</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Export expenses in accounting format (journal entries)
          </p>
          <Button onClick={handleExportExpenses}>
            <Download className="w-4 h-4 mr-2" />
            Export Expenses
          </Button>
        </Card>

        <Card className="p-6 col-span-2">
          <h3 className="font-medium mb-1">Tobacco / Manufacturer Scan Data</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Weekly line-item sales for scan-data programs (Altria, RJR buydown reporting) —
            upload the CSV to the manufacturer portal to get paid for your reported sales.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium mb-1 text-muted-foreground">Week start</label>
              <input
                type="date"
                value={scanDataStart}
                onChange={(e) => setScanDataStart(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-muted-foreground">Week end</label>
              <input
                type="date"
                value={scanDataEnd}
                onChange={(e) => setScanDataEnd(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-xs font-medium mb-1.5 text-muted-foreground">
              Program categories
            </label>
            <div className="flex flex-wrap gap-1.5">
              {allCategories.map((c) => (
                <button
                  key={c.id}
                  onClick={() =>
                    setScanDataCategories((prev) =>
                      prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]
                    )
                  }
                  className={`text-xs px-2 py-1 rounded-full border transition-colors ${
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
          <Button onClick={handleExportScanData} disabled={scanDataExporting || scanDataCategories.length === 0}>
            <Download className="w-4 h-4 mr-2" />
            {scanDataExporting ? 'Exporting...' : 'Export Scan Data CSV'}
          </Button>
        </Card>
      </div>

      {/* Export History */}
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
              <TableHead>Records</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {exportHistory.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No exports yet
                </TableCell>
              </TableRow>
            ) : (
              exportHistory.map((exp) => (
                <TableRow key={exp.id}>
                  <TableCell>{new Date(exp.createdAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{exp.type}</Badge>
                  </TableCell>
                  <TableCell>{exp.format}</TableCell>
                  <TableCell>
                    {new Date(exp.startDate).toLocaleDateString()} - {new Date(exp.endDate).toLocaleDateString()}
                  </TableCell>
                  <TableCell>{exp.recordCount}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};
