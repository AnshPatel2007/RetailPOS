import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { today } from '@internationalized/date';
import { useCalendarTimezone } from '@/hooks/useCalendarTimezone';
import React, { useState, useEffect } from 'react';
import { logger } from '../../utils/logger';
import { FileText, DollarSign, TrendingUp, Download } from 'lucide-react';
import { useLegacyPageRefresh } from '@/hooks/useLegacyPageRefresh';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import {
  Table,
  TableBody,
  TableRow,
  TableHeader,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { lotteryService } from '@/services/api';
import toast from 'react-hot-toast';

interface DailySummaryProps {
  locationId?: string;
  onActionsChange?: (actions: React.ReactNode) => void;
}

export const DailySummary: React.FC<DailySummaryProps> = ({ locationId, onActionsChange }) => {
  const timezone = useCalendarTimezone();
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(
    today(timezone).subtract({ days: 7 }).toString()
  );
  const [endDate, setEndDate] = useState(today(timezone).toString());
  const [transactions, setTransactions] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetchData(false, () => !controller.signal.aborted, controller.signal);
    return () => controller.abort();
  }, [locationId, startDate, endDate]);

  const fetchData = async (quiet = false, active: () => boolean = () => true, signal?: AbortSignal) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const params: any = {
        startDate,
        endDate,
      };
      if (locationId) {
        params.locationId = locationId;
      }

      const [transactionsRes, summaryRes] = await Promise.all([
        lotteryService.getTransactions(params, signal),
        lotteryService.getDailySummary(params, signal),
      ]);

      if (!active()) return;
      setError('');
      setTransactions(transactionsRes.data.data || []);
      setSummary(summaryRes.data.data);
    } catch (error) {
      if (quiet) throw error;
      if (!active()) return;
      setError('Lottery reports could not be loaded. Try again.');
      logger.error('Failed to fetch lottery data:', error);
      toast.error('Failed to load lottery data');
    } finally {
      if (active()) setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value || 0);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString();
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      OPEN: 'warning',
      CLOSED: 'success',
      RECONCILED: 'secondary',
    };

    return (
      <Badge variant={variants[status] as any || 'secondary'}>
        {status}
      </Badge>
    );
  };

  const handleExport = () => {
    // Create CSV content
    const headers = [
      'Date',
      'Online Sales Count',
      'Online Sales Amount',
      'Offline Sales Count',
      'Offline Sales Amount',
      'Total Sales',
      'Cashout',
      'Net Amount',
      'Status',
    ];

    const rows = transactions.map((tx) => [
      formatDate(tx.transactionDate),
      tx.onlineSalesCount || 0,
      tx.onlineSalesAmount || 0,
      tx.offlineSalesCount || 0,
      tx.offlineSalesAmount || 0,
      (tx.onlineSalesAmount || 0) + (tx.offlineSalesAmount || 0),
      tx.cashoutAmount || 0,
      tx.netAmount || 0,
      tx.status,
    ]);
    for (const day of summary?.historicalNetDaily || []) rows.push([day.date, '', '', '', '', '', '', day.netAmount, 'Historical net summary']);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.join(',')),
    ].join('\n');

    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lottery-report-${startDate}-to-${endDate}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    toast.success('Report exported successfully');
  };

  useEffect(() => {
    onActionsChange?.(<Button onClick={handleExport} variant="outline" disabled={loading || !!error || (!transactions.length && !summary?.historicalDays)}><Download className="h-4 w-4 mr-2" />Export CSV</Button>);
    return () => onActionsChange?.(null);
  }, [onActionsChange, transactions, summary, loading, error]);
  const updates = useLegacyPageRefresh((current, signal) => fetchData(true, current, signal), { key: JSON.stringify([locationId, startDate, endDate]), paused: loading });

  return (
    <div className="space-y-4">
      {updates.notice}
      {error && <div role="alert"><p>{error}</p><Button variant="outline" onClick={() => void fetchData()}>Retry</Button></div>}
      <DateRangePicker label="Lottery dates" startDate={startDate} endDate={endDate} allowOpenRange={false} onChange={range => { setStartDate(range.startDate); setEndDate(range.endDate); }} />

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Sales</p>
                <p className="text-2xl font-bold mt-1">
                  {summary.historicalDays ? 'Unavailable' : formatCurrency(
                    (summary.totalOnlineSalesAmount || 0) +
                    (summary.totalOfflineSalesAmount || 0)
                  )}
                </p>
              </div>
              <div className="bg-info/10 p-3 rounded-full">
                <DollarSign className="h-6 w-6 text-info" />
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Cashout</p>
                <p className="text-2xl font-bold mt-1">
                  {summary.historicalDays ? 'Unavailable' : formatCurrency(summary.totalCashoutAmount || 0)}
                </p>
              </div>
              <div className="bg-warning/10 p-3 rounded-full">
                <DollarSign className="h-6 w-6 text-warning" />
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Net Amount</p>
                <p
                  className={`text-2xl font-bold mt-1 ${
                    (summary.totalNetAmount || 0) >= 0
                      ? 'text-success'
                      : 'text-destructive'
                  }`}
                >
                  {summary.totalNetAmount === null ? 'Unavailable' : formatCurrency(summary.totalNetAmount || 0)}
                </p>
              </div>
              <div className="bg-success/10 p-3 rounded-full">
                <TrendingUp className="h-6 w-6 text-success" />
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Tickets Sold</p>
                <p className="text-2xl font-bold mt-1">
                  {summary.historicalDays ? 'Unavailable' : (summary.totalOnlineSalesCount || 0) +
                    (summary.totalOfflineSalesCount || 0)}
                </p>
              </div>
              <div className="bg-primary/10 p-3 rounded-full">
                <FileText className="h-6 w-6 text-primary" />
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Transactions Table */}
      {!!summary?.historicalDays && <Card className="p-4 space-y-3">
        <h3 className="text-lg font-semibold">Historical lottery net</h3>
        <p className="text-sm text-muted-foreground">Sales minus payouts, as supplied. Ticket sales, payout totals and ticket counts are unknown. This is separate from commission income.</p>
        {!!summary.missingNetDays && <p className="text-sm text-muted-foreground">Lottery figures were not supplied for {summary.missingNetDays} days. The period total is unavailable.</p>}
        <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead className="text-right">Net after payouts</TableHead></TableRow></TableHeader><TableBody>
          {summary.historicalNetDaily.map((day: { id: string; date: string; netAmount: number }) => <TableRow key={day.id}><TableCell>{day.date}</TableCell><TableCell className="text-right">{formatCurrency(day.netAmount)}</TableCell></TableRow>)}
        </TableBody></Table>
      </Card>}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Daily Transactions
        </h3>

        {loading ? (
          <div className="text-center py-8">Loading...</div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No transactions found for the selected date range.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Online Sales</TableHead>
                  <TableHead>Offline Sales</TableHead>
                  <TableHead>Total Sales</TableHead>
                  <TableHead>Cashout</TableHead>
                  <TableHead>Net Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => {
                  const totalSales =
                    (tx.onlineSalesAmount || 0) + (tx.offlineSalesAmount || 0);
                  const netAmount = tx.netAmount || 0;

                  return (
                    <TableRow key={tx.id}>
                      <TableCell className="font-medium">
                        {formatDate(tx.transactionDate)}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">
                            {formatCurrency(tx.onlineSalesAmount || 0)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {tx.onlineSalesCount || 0} sales
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">
                            {formatCurrency(tx.offlineSalesAmount || 0)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {tx.offlineSalesCount || 0} tickets
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">
                        {formatCurrency(totalSales)}
                      </TableCell>
                      <TableCell>{formatCurrency(tx.cashoutAmount || 0)}</TableCell>
                      <TableCell>
                        <span
                          className={`font-medium ${
                            netAmount >= 0 ? 'text-success' : 'text-destructive'
                          }`}
                        >
                          {formatCurrency(netAmount)}
                        </span>
                      </TableCell>
                      <TableCell>{getStatusBadge(tx.status)}</TableCell>
                    </TableRow>
                  );
                })}

                {/* Totals Row */}
                {transactions.length > 0 && (
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell>
                      {formatCurrency(
                        transactions.reduce(
                          (sum, tx) => sum + (tx.onlineSalesAmount || 0),
                          0
                        )
                      )}
                    </TableCell>
                    <TableCell>
                      {formatCurrency(
                        transactions.reduce(
                          (sum, tx) => sum + (tx.offlineSalesAmount || 0),
                          0
                        )
                      )}
                    </TableCell>
                    <TableCell>
                      {formatCurrency(
                        transactions.reduce(
                          (sum, tx) =>
                            sum +
                            (tx.onlineSalesAmount || 0) +
                            (tx.offlineSalesAmount || 0),
                          0
                        )
                      )}
                    </TableCell>
                    <TableCell>
                      {formatCurrency(
                        transactions.reduce(
                          (sum, tx) => sum + (tx.cashoutAmount || 0),
                          0
                        )
                      )}
                    </TableCell>
                    <TableCell>
                      {formatCurrency(
                        transactions.reduce((sum, tx) => sum + (tx.netAmount || 0), 0)
                      )}
                    </TableCell>
                    <TableCell>-</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
};
