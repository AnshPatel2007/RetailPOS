import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/services/api';
import { formatCurrency } from '@/lib/utils';
import { ManagementPage, SummaryStrip } from '@/components/common/Workspace';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTabs } from '@/components/common/PageTabs';
import { AutoRefreshStatus } from '@/components/common/AutoRefreshStatus';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ArrowRight, Award } from 'lucide-react';

interface LocationStats {
  locationId: string;
  locationName: string;
  revenue: number;
  transactions: number;
  expenses: number;
  operatingExpenses: number;
  profit: number | null;
  margin: number | null;
  grossCollected: number;
  productCount: number;
  activeUsers: number;
  lowStockCount: number;
  activeShifts: number;
  pendingSales: number;
  refundCount: number;
  refundAmount: number;
  taxCollected: number;
  inventoryValue: number;
}

interface StoreDetails {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  phone: string;
  email: string;
  isActive: boolean;
  _count: {
    users: number;
    products: number;
    sales: number;
  };
  totalRevenue: number;
  todayRevenue: number;
}

interface DashboardData {
  locations: LocationStats[];
  totals: {
    totalRevenue: number;
    totalTransactions: number;
    totalExpenses: number;
    totalOperatingExpenses: number;
    totalProfit: number | null;
    margin: number | null;
    totalProducts: number;
    totalGrossCollected: number;
    totalUsers: number;
    totalLowStock: number;
    totalActiveShifts: number;
    totalPendingSales: number;
    totalRefunds: number;
    totalRefundAmount: number;
    totalTaxCharged: number;
    totalInventoryValue: number;
  };
  period: string;
  globalMetrics: {
    totalCustomers: number;
    newCustomers: number;
    topProducts: any[];
    cashDiscrepancies: any[];
  };
}

const PERIODS = [
  { value: '1', label: '1D', description: 'Last 24 hours' },
  { value: '7', label: '7D', description: 'Last 7 days' },
  { value: '30', label: '1M', description: 'Last 30 days' },
  { value: '90', label: '3M', description: 'Last 90 days' },
  { value: '365', label: '1Y', description: 'Last 365 days' },
  { value: 'max', label: 'MAX', description: 'All time' },
];
const displayProfit = (value: number | null) => value === null ? '\u2014' : formatCurrency(value);
const displayMargin = (value: number | null) => value === null ? '\u2014' : value.toFixed(1) + '%';

export const AdminDashboard: React.FC = () => {
  const [period, setPeriod] = useState('30');
  const query = useScopedQuery<{ stats: DashboardData; stores: StoreDetails[] }>(['admin-dashboard', period], async signal => {
    const [stats, stores] = await Promise.all([api.get('/locations/stats/overview', { params: { period }, signal }), api.get('/locations', { signal })]);
    return { stats: stats.data.data, stores: stores.data.data };
  });
  const data = query.data?.stats;
  const stores = query.data?.stores || [];
  const periodLabel = PERIODS.find(option => option.value === period)!.label;
  const header = <PageHeader title="Admin Dashboard" toolbar={<PageTabs label="Dashboard time period" value={period} onChange={setPeriod}
    items={PERIODS.map(option => ({ id: option.value, label: <span aria-label={option.description}>{option.label}</span> }))} />} />;

  if (query.loading) {
    return (
      <div className="space-y-6">
        {header}
        <p role="status" className="text-sm text-muted-foreground">Loading dashboard...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        {header}
        <div role="alert" className="rounded-md border p-4 space-y-3"><p>Dashboard data is unavailable.</p>
          <Button variant="outline" onClick={query.refresh} disabled={query.refreshing}>Retry</Button></div>
      </div>
    );
  }

  // Calculate additional metrics
  const avgOrderValue = data.totals.totalTransactions > 0
    ? data.totals.totalGrossCollected / data.totals.totalTransactions
    : 0;

  const profitMargin = data.totals.margin;

  const totalTodayRevenue = stores.reduce((sum, store) => sum + store.todayRevenue, 0);
  const totalProducts = data.totals.totalProducts;

  // Find top performing store
  const topStore = data.locations.length > 0
    ? data.locations.reduce((max, loc) => loc.revenue > max.revenue ? loc : max)
    : null;

  // Store cards with detailed info
  const storeCards = stores.map(store => {
    const stats = data.locations.find(l => l.locationId === store.id);
    return {
      ...store,
      periodRevenue: stats?.revenue || 0,
      periodProfit: stats?.profit ?? null,
      periodMargin: stats?.margin ?? null,
      _count: { ...store._count, products: stats?.productCount ?? store._count.products, users: stats?.activeUsers ?? store._count.users },
      periodTransactions: stats?.transactions || 0,
      periodExpenses: stats?.operatingExpenses || 0,
    };
  });

  return (
    <ManagementPage className="space-y-6">
      {header}
      <AutoRefreshStatus state={query} />

      <SummaryStrip emphasis items={[
        { label: periodLabel + ' Revenue', value: formatCurrency(data.totals.totalRevenue), detail: data.totals.totalTransactions + ' orders' },
        { label: 'Operating expenses', value: formatCurrency(data.totals.totalOperatingExpenses), detail: 'Merchandise costs are deducted through COGS' },
        { label: 'Net income', value: displayProfit(data.totals.totalProfit), detail: data.totals.totalProfit === null ? 'Cost information incomplete' : 'Net margin: ' + displayMargin(profitMargin) },
        { label: 'Stores', value: stores.length, detail: stores.filter(s => s.isActive).length + ' active' },
      ]} />
      <section aria-label="Operational activity" className="space-y-3">
        <h2>Operational activity</h2>
        <SummaryStrip items={[
          { label: 'Low Stock Alerts', value: data.totals.totalLowStock, tone: data.totals.totalLowStock > 0 ? 'warning' : 'default' },
          { label: 'Active Shifts', value: data.totals.totalActiveShifts },
          { label: 'Pending Sales', value: data.totals.totalPendingSales },
          { label: 'Refunds', value: data.totals.totalRefunds, detail: formatCurrency(data.totals.totalRefundAmount) },
        ]} />
      </section>
      <details className="rounded-lg border bg-card p-4">
        <summary className="cursor-pointer font-medium focus-visible:outline-ring">More store metrics</summary>
        <SummaryStrip className="mt-4" items={[
          { label: 'Today', value: formatCurrency(totalTodayRevenue), detail: 'Revenue' },
          { label: 'Avg Order Value', value: formatCurrency(avgOrderValue) },
          { label: 'Products', value: totalProducts },
          { label: 'Users', value: data.totals.totalUsers },
          { label: 'Top Store', value: topStore?.locationName || 'N/A' },
          { label: 'Inventory Value', value: data.totals.totalInventoryValue == null ? 'Unavailable' : formatCurrency(data.totals.totalInventoryValue) },
          { label: 'Tax Charged', value: formatCurrency(data.totals.totalTaxCharged), detail: 'Before refunds' },
          { label: 'Customers', value: data.globalMetrics?.totalCustomers || 0, detail: (data.globalMetrics?.newCustomers || 0) + ' new in this period' },
        ]} />
      </details>

      {/* Individual Store Cards */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Store Details</h2>
          <Link to="/admin/stores">
            <Button variant="outline" size="sm">
              Manage Stores <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {storeCards.map((store) => {
            const margin = store.periodMargin;

            return (
              <Card key={store.id} className={!store.isActive ? 'opacity-60' : ''}>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start gap-3">
                    <div>
                      <CardTitle className="text-lg">{store.name}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {store.city}, {store.state}
                      </p>
                    </div>
                    <Badge variant={store.isActive ? 'success' : 'secondary'}>
                      {store.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Today's Revenue */}
                  <div className="flex justify-between items-center p-2 bg-success/10 rounded">
                    <span className="text-sm text-success">Today</span>
                    <span className="font-bold text-success">
                      {formatCurrency(store.todayRevenue)}
                    </span>
                  </div>

                  {/* Period Stats */}
                  <div className="grid grid-cols-1 gap-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Revenue:</span>
                      <span className="font-medium">{formatCurrency(store.periodRevenue)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground" title="Includes recorded merchandise costs, operating expenses and other income">Net income:</span>
                      <span className="font-medium text-success">
                        {displayProfit(store.periodProfit)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Operating expenses:</span>
                      <span className="font-medium">
                        {formatCurrency(store.periodExpenses)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground" title="Net income divided by net sales before tax">Net margin:</span>
                      <span className={`font-medium ${margin === null ? 'text-muted-foreground' : margin >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {displayMargin(margin)}
                      </span>
                    </div>
                  </div>

                  {/* Counts */}
                  <div className="flex justify-between pt-2 border-t text-sm">
                    <div className="text-center">
                      <p className="font-bold">{store.periodTransactions}</p>
                      <p className="text-xs text-muted-foreground">Orders</p>
                    </div>
                    <div className="text-center">
                      <p className="font-bold">{store._count.products}</p>
                      <p className="text-xs text-muted-foreground">Products</p>
                    </div>
                    <div className="text-center">
                      <p className="font-bold">{store._count.users}</p>
                      <p className="text-xs text-muted-foreground">Users</p>
                    </div>
                    <div className="text-center">
                      <p className="font-bold">{store.totalRevenue > 0 ? formatCurrency(store.totalRevenue) : '$0'}</p>
                      <p className="text-xs text-muted-foreground">All Time</p>
                    </div>
                  </div>

                  {/* Contact Info */}
                  <div className="text-xs text-muted-foreground pt-2 border-t">
                    <p>{store.phone}</p>
                    <p>{store.email}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Performance Comparison Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Performance Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table scrollLabel="Store financial comparison" className="w-full text-sm">
              <TableHeader>
                <TableRow className="border-b">
                  <TableHead className="text-left py-3 px-4 font-medium">Store</TableHead>
                  <TableHead className="text-right py-3 px-4 font-medium">Revenue</TableHead>
                  <TableHead className="text-right py-3 px-4 font-medium">Operating expenses</TableHead>
                  <TableHead className="text-right py-3 px-4 font-medium" title="Includes recorded merchandise costs, operating expenses and other income">Net income</TableHead>
                  <TableHead className="text-right py-3 px-4 font-medium" title="Net income divided by net sales before tax">Net margin</TableHead>
                  <TableHead className="text-right py-3 px-4 font-medium">Orders</TableHead>
                  <TableHead className="text-right py-3 px-4 font-medium">Avg Order</TableHead>
                  <TableHead className="text-right py-3 px-4 font-medium">Users</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.locations.map((loc, index) => {
                  const margin = loc.margin;
                  const avgOrder = loc.transactions > 0 ? loc.grossCollected / loc.transactions : 0;

                  return (
                    <TableRow key={loc.locationId} className="border-b hover:bg-accent/50">
                      <TableCell className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          {index === 0 && <Award className="h-4 w-4 text-warning" />}
                          <span className="font-medium">{loc.locationName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right py-3 px-4 text-success font-medium">
                        {formatCurrency(loc.revenue)}
                      </TableCell>
                      <TableCell className="text-right py-3 px-4">
                        {formatCurrency(loc.operatingExpenses)}
                      </TableCell>
                      <TableCell className="text-right py-3 px-4 font-medium">
                        {displayProfit(loc.profit)}
                      </TableCell>
                      <TableCell className="text-right py-3 px-4">
                        <span className={margin === null ? 'text-muted-foreground' : margin >= 20 ? 'text-success' : margin >= 10 ? 'text-warning' : 'text-destructive'}>
                          {displayMargin(margin)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right py-3 px-4">{loc.transactions}</TableCell>
                      <TableCell className="text-right py-3 px-4">{formatCurrency(avgOrder)}</TableCell>
                      <TableCell className="text-right py-3 px-4">{loc.activeUsers}</TableCell>
                    </TableRow>
                  );
                })}
                {/* Totals Row */}
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell className="py-3 px-4">TOTAL</TableCell>
                  <TableCell className="text-right py-3 px-4 text-success">
                    {formatCurrency(data.totals.totalRevenue)}
                  </TableCell>
                  <TableCell className="text-right py-3 px-4">
                    {formatCurrency(data.totals.totalOperatingExpenses)}
                  </TableCell>
                  <TableCell className="text-right py-3 px-4">
                    {displayProfit(data.totals.totalProfit)}
                  </TableCell>
                  <TableCell className="text-right py-3 px-4">
                    {displayMargin(profitMargin)}
                  </TableCell>
                  <TableCell className="text-right py-3 px-4">{data.totals.totalTransactions}</TableCell>
                  <TableCell className="text-right py-3 px-4">{formatCurrency(avgOrderValue)}</TableCell>
                  <TableCell className="text-right py-3 px-4">{data.totals.totalUsers}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </ManagementPage>
  );
};
