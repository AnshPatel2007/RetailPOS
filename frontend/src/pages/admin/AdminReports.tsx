import React, { useState, useEffect } from 'react';
import { locationService } from '@/services/api';
import { formatCurrency } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ExportPreviewModal } from '@/components/reports/ExportPreviewModal';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  Store,
  RefreshCw,
  Download,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import toast from 'react-hot-toast';

interface LocationStats {
  locationId: string;
  locationName: string;
  revenue: number;
  transactions: number;
  expenses: number;
  profit: number;
  activeUsers: number;
}

interface CrossLocationData {
  locations: LocationStats[];
  totals: {
    totalRevenue: number;
    totalTransactions: number;
    totalExpenses: number;
    totalProfit: number;
    totalUsers: number;
  };
  period: number;
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

export const AdminReports: React.FC = () => {
  const [data, setData] = useState<CrossLocationData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [period, setPeriod] = useState(30);
  const [showExportPreview, setShowExportPreview] = useState(false);

  useEffect(() => {
    loadData();
  }, [period]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const response = await locationService.getCrossLocationStats(period);
      setData(response.data.data);
    } catch (error) {
      console.error('Failed to load cross-location stats:', error);
      toast.error('Failed to load reports');
    } finally {
      setIsLoading(false);
    }
  };

  const exportToCSV = () => {
    if (!data) return;

    const headers = ['Store', 'Revenue', 'Transactions', 'Expenses', 'Profit', 'Users'];
    const rows = data.locations.map(loc => [
      loc.locationName,
      loc.revenue.toFixed(2),
      loc.transactions.toString(),
      loc.expenses.toFixed(2),
      loc.profit.toFixed(2),
      loc.activeUsers.toString(),
    ]);

    // Add totals row
    rows.push([
      'TOTAL',
      data.totals.totalRevenue.toFixed(2),
      data.totals.totalTransactions.toString(),
      data.totals.totalExpenses.toFixed(2),
      data.totals.totalProfit.toFixed(2),
      data.totals.totalUsers.toString(),
    ]);

    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cross-location-report-${period}days.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Report exported');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">No data available</h3>
        <Button onClick={loadData}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  // Prepare chart data
  const revenueChartData = data.locations.map(loc => ({
    name: loc.locationName,
    revenue: loc.revenue,
    profit: loc.profit,
  }));

  const pieChartData = data.locations.map(loc => ({
    name: loc.locationName,
    value: loc.revenue,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Cross-Location Reports</h1>
          <p className="text-muted-foreground">
            Compare performance across all stores
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(parseInt(e.target.value))}
            className="px-3 py-2 border border-input rounded-md bg-background text-foreground"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
          <Button variant="outline" onClick={loadData}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={() => setShowExportPreview(true)}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <DollarSign className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Revenue</p>
                <p className="text-xl font-bold">{formatCurrency(data.totals.totalRevenue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <BarChart3 className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Transactions</p>
                <p className="text-xl font-bold">{data.totals.totalTransactions}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-500/10 rounded-lg">
                <TrendingDown className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Expenses</p>
                <p className="text-xl font-bold">{formatCurrency(data.totals.totalExpenses)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-500/10 rounded-lg">
                <TrendingUp className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Profit</p>
                <p className="text-xl font-bold">{formatCurrency(data.totals.totalProfit)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/10 rounded-lg">
                <Users className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Active Users</p>
                <p className="text-xl font-bold">{data.totals.totalUsers}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue by Store */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue & Profit by Store</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Bar dataKey="revenue" fill="#3B82F6" name="Revenue" />
                  <Bar dataKey="profit" fill="#10B981" name="Profit" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Revenue Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieChartData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                  >
                    {pieChartData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Table */}
      <Card>
        <CardHeader>
          <CardTitle>Store Performance Comparison</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Store</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Transactions</TableHead>
              <TableHead className="text-right">Avg. Order</TableHead>
              <TableHead className="text-right">Expenses</TableHead>
              <TableHead className="text-right">Profit</TableHead>
              <TableHead className="text-right">Margin</TableHead>
              <TableHead className="text-right">Users</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.locations.map((location) => {
              const avgOrder = location.transactions > 0
                ? location.revenue / location.transactions
                : 0;
              const margin = location.revenue > 0
                ? (location.profit / location.revenue) * 100
                : 0;

              return (
                <TableRow key={location.locationId}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Store className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{location.locationName}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(location.revenue)}
                  </TableCell>
                  <TableCell className="text-right">{location.transactions}</TableCell>
                  <TableCell className="text-right">{formatCurrency(avgOrder)}</TableCell>
                  <TableCell className="text-right text-red-500">
                    {formatCurrency(location.expenses)}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={location.profit >= 0 ? 'text-green-500' : 'text-red-500'}>
                      {formatCurrency(location.profit)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={margin >= 0 ? 'text-green-500' : 'text-red-500'}>
                      {margin.toFixed(1)}%
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{location.activeUsers}</TableCell>
                </TableRow>
              );
            })}
            {/* Totals Row */}
            <TableRow className="bg-muted/50 font-bold">
              <TableCell>TOTAL</TableCell>
              <TableCell className="text-right">{formatCurrency(data.totals.totalRevenue)}</TableCell>
              <TableCell className="text-right">{data.totals.totalTransactions}</TableCell>
              <TableCell className="text-right">
                {formatCurrency(
                  data.totals.totalTransactions > 0
                    ? data.totals.totalRevenue / data.totals.totalTransactions
                    : 0
                )}
              </TableCell>
              <TableCell className="text-right text-red-500">
                {formatCurrency(data.totals.totalExpenses)}
              </TableCell>
              <TableCell className="text-right">
                <span className={data.totals.totalProfit >= 0 ? 'text-green-500' : 'text-red-500'}>
                  {formatCurrency(data.totals.totalProfit)}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <span className={data.totals.totalProfit >= 0 ? 'text-green-500' : 'text-red-500'}>
                  {data.totals.totalRevenue > 0
                    ? ((data.totals.totalProfit / data.totals.totalRevenue) * 100).toFixed(1)
                    : 0}%
                </span>
              </TableCell>
              <TableCell className="text-right">{data.totals.totalUsers}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      {/* Export Preview Modal */}
      {showExportPreview && data && (
        <ExportPreviewModal
          isOpen={showExportPreview}
          onClose={() => setShowExportPreview(false)}
          type="locations"
          data={data.locations}
          onExportCSV={async () => {
            exportToCSV();
            setShowExportPreview(false);
          }}
          onExportPDF={async () => {
            exportToCSV();
            setShowExportPreview(false);
          }}
        />
      )}
    </div>
  );
};
