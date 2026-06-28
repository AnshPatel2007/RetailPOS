import React, { useState, useEffect } from 'react';
import { logger } from '../../utils/logger';
import { FileText, Calendar, DollarSign, TrendingUp, Download } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
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
}

export const DailySummary: React.FC<DailySummaryProps> = ({ locationId }) => {
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);

  useEffect(() => {
    fetchData();
  }, [locationId, startDate, endDate]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params: any = {
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate + 'T23:59:59').toISOString(),
      };
      if (locationId) {
        params.locationId = locationId;
      }

      const [transactionsRes, summaryRes] = await Promise.all([
        lotteryService.getTransactions(params),
        lotteryService.getDailySummary(params),
      ]);

      setTransactions(transactionsRes.data.data || []);
      setSummary(summaryRes.data.data);
    } catch (error) {
      logger.error('Failed to fetch lottery data:', error);
      toast.error('Failed to load lottery data');
    } finally {
      setLoading(false);
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

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card className="p-6">
        <div className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-foreground mb-1">
              Start Date
            </label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              max={endDate}
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-foreground mb-1">
              End Date
            </label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate}
              max={new Date().toISOString().split('T')[0]}
            />
          </div>
          <Button
            onClick={fetchData}
            variant="primary"
            className="flex items-center gap-2"
          >
            <Calendar className="h-4 w-4" />
            Apply
          </Button>
          <Button
            onClick={handleExport}
            variant="outline"
            disabled={transactions.length === 0}
            className="flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </Card>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Sales</p>
                <p className="text-2xl font-bold mt-1">
                  {formatCurrency(
                    (summary.totalOnlineSalesAmount || 0) +
                    (summary.totalOfflineSalesAmount || 0)
                  )}
                </p>
              </div>
              <div className="bg-blue-500/10 p-3 rounded-full">
                <DollarSign className="h-6 w-6 text-blue-500" />
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Cashout</p>
                <p className="text-2xl font-bold mt-1">
                  {formatCurrency(summary.totalCashoutAmount || 0)}
                </p>
              </div>
              <div className="bg-orange-500/10 p-3 rounded-full">
                <DollarSign className="h-6 w-6 text-orange-500" />
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
                      ? 'text-green-500'
                      : 'text-red-500'
                  }`}
                >
                  {formatCurrency(summary.totalNetAmount || 0)}
                </p>
              </div>
              <div className="bg-green-500/10 p-3 rounded-full">
                <TrendingUp className="h-6 w-6 text-green-500" />
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Tickets Sold</p>
                <p className="text-2xl font-bold mt-1">
                  {(summary.totalOnlineSalesCount || 0) +
                    (summary.totalOfflineSalesCount || 0)}
                </p>
              </div>
              <div className="bg-purple-500/10 p-3 rounded-full">
                <FileText className="h-6 w-6 text-purple-500" />
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Transactions Table */}
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
                            netAmount >= 0 ? 'text-green-500' : 'text-red-500'
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
