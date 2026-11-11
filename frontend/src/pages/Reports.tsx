import { useCalendarTimezone } from '@/hooks/useCalendarTimezone';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { FilterChips } from '@/components/common/FilterChips';
import { useUrlFilter, useUrlPage, useUrlObject } from '@/hooks/useUrlFilter';
import { InventoryPurchaseSummary } from '@/components/financial/InventoryPurchaseSummary';
import { DigestDeliveryControls } from '@/components/reports/DigestDeliveryControls';
import { EmployeeSalesTab } from '@/components/reports/EmployeeSalesTab';
import { Badge } from '@/components/ui/Badge';
import { AboutNumbers } from '@/components/common/AboutNumbers';
import { presetRange } from '@/lib/calendarDates';
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { reportService, saleService } from '@/services/api';
import { formatCurrency, formatChartCurrency, formatEnumLabel, CHART_COLORS, formatDateTime } from '@/lib/utils';
import toast from 'react-hot-toast';

import { today } from '@internationalized/date';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
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
  Search,
  Filter,
  Eye,
  DollarSign,
  Users,
  Package,
  ShoppingCart,
  AlertTriangle,
  CreditCard,
  Wallet,
  Target,
  Activity,
  ArrowRight,
  Download,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar, ReferenceLine } from 'recharts';
import type { SalesReportData, Sale } from '@/types';
import { SalesFilters } from '@/components/reports/SalesFilters';
import { SaleDetailsModal } from '@/components/reports/SaleDetailsModal';
import { SalesBulkActions } from '@/components/reports/SalesBulkActions';
import { BulkRefundActions } from '@/components/reports/BulkRefundActions';
import { FilterDropdown } from '@/components/common/FilterDropdown';
import { ExportPreviewModal } from '@/components/reports/ExportPreviewModal';
import { DataVisualizationCard } from '@/components/reports/DataVisualizationCard';
import { StockHealthTab } from '@/components/reports/StockHealthTab';
import { ExportsTab } from '@/components/reports/ExportsTab';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTabs } from '@/components/common/PageTabs';
import { ManagementPage, SummaryStrip } from '@/components/common/Workspace';
import { AutoRefreshStatus } from '@/components/common/AutoRefreshStatus';
import { Pagination } from '@/components/common/Pagination';
import { EmptyState } from '@/components/common/EmptyState';
import { StoreFilterSelect } from '@/components/common/StoreFilterSelect';
import { useAuthStore } from '@/store/authStore';
import { invalidateScopedQueries, useScopedQuery } from '@/hooks/useScopedQuery';
import { Spinner } from '@/components/ui/LoadingState';

/** A missing figure reads as a dash, never as $0.00. */
const money = (value: number | null | undefined) => value == null ? '\u2014' : formatCurrency(value);

export type ReportView = 'overall' | 'sales' | 'employee' | 'stock-health' | 'exports';
export const Reports: React.FC<{ view?: ReportView }> = ({ view }) => {
  const scopeUser = useAuthStore(state => state.user);
  const reportToday = today(useCalendarTimezone());
  const [exportActions, setExportActions] = useState<React.ReactNode>(null);
  const [selectedTab, setActiveTab] = useState<ReportView>('sales');
  const activeTab = view || selectedTab;
  const [salesPage, setSalesPage] = useUrlPage();
  const [refundPageRaw, setRefundPageRaw] = useUrlFilter('refundPage', '1');
  const [voidPageRaw, setVoidPageRaw] = useUrlFilter('voidPage', '1');
  const boundedPage = (value: string) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 1_000_000_000 ? Number(value) : 1;
  const refundPage = boundedPage(refundPageRaw), voidPage = boundedPage(voidPageRaw);
  const [locationId, setLocationId] = useState('');

  // Sales-specific state
  const [saleRecord, setSaleRecord] = useUrlFilter('record');
  const [showSalesFilters, setShowSalesFilters] = useState(false);
  const [salesSearchQuery, setSalesSearchQuery] = useUrlFilter('search');
  const [selectedSaleIds, setSelectedSaleIds] = useState<string[]>([]);
  const [salesFilters, setSalesFilters] = useUrlObject('salesFilters', {
    paymentMethod: [] as string[],
    status: [] as string[],
    employeeId: [] as string[],
    customerId: '',
    startDate: reportToday.subtract({ days: 30 }).toString(),
    endDate: reportToday.toString(),
    minAmount: '',
    maxAmount: '',
    showCharts: false as boolean,
  });

  // Export preview state
  const [showExportPreview, setShowExportPreview] = useState<'sales' | null>(null);


  const salesParams = () => ({ startDate: salesFilters.startDate, endDate: salesFilters.endDate,
    paymentMethod: salesFilters.paymentMethod.join(',') || undefined,
    status: salesFilters.status.join(',') || undefined, userId: salesFilters.employeeId.join(',') || undefined,
    customerId: salesFilters.customerId || undefined, minAmount: salesFilters.minAmount || undefined,
    maxAmount: salesFilters.maxAmount || undefined, search: salesSearchQuery || undefined, locationId: locationId || undefined });
  const [readySearch, setReadySearch] = useState(salesSearchQuery);
  useEffect(() => { const timer = setTimeout(() => setReadySearch(salesSearchQuery), 200); return () => clearTimeout(timer); }, [salesSearchQuery]);
  const params = activeTab === 'sales' ? { ...salesParams(), search: readySearch || undefined, page: salesPage, refundPage, voidPage } : { locationId: locationId || undefined };
  const reportQuery = useScopedQuery<any>(['reports', activeTab, params], async signal => {
    if (activeTab === 'sales') return (await reportService.getSales(params, signal)).data.data;
    return (await reportService.getOverall(params, signal)).data.data;
  }, ['sales', 'overall'].includes(activeTab));
  const salesData: SalesReportData | null = activeTab === 'sales' ? reportQuery.data : null;
  const overallData = activeTab === 'overall' ? reportQuery.data : null;
  const isLoading = reportQuery.loading || (activeTab === 'sales' && readySearch !== salesSearchQuery);
  const reportError = reportQuery.stale ? '' : reportQuery.error;
  const saleDetail = useScopedQuery<Sale>(['report-sale', saleRecord, locationId], async signal => (await saleService.getById(saleRecord, signal)).data.data, activeTab === 'sales' && !!saleRecord);
  const loadReports = () => { invalidateScopedQueries(); };
  useEffect(() => { setSelectedSaleIds([]); }, [activeTab, salesPage, salesFilters, salesSearchQuery, locationId, scopeUser?.id, scopeUser?.locationId]);
  useEffect(() => { setShowExportPreview(null); }, [activeTab, locationId, scopeUser?.id, scopeUser?.locationId]);

  // Sales helper functions
  const handleSalesExport = async (format: 'csv' | 'pdf') => {
    try {
      const params = salesParams();

      const response =
        format === 'csv'
          ? await reportService.exportSalesCSV(params)
          : await reportService.exportSalesPDF(params);

      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `sales-export.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success(`Exported sales as ${format.toUpperCase()}`);
    } catch (error) {
      console.error(`Failed to export ${format}:`, error);
      toast.error(`Failed to export ${format}`);
      throw error;
    }
  };

  const toggleSaleSelection = (id: string) => {
    setSelectedSaleIds((prev) =>
      prev.includes(id) ? prev.filter((saleId) => saleId !== id) : [...prev, id]
    );
  };

  const toggleSelectAllSales = () => {
    const ids = visibleSales.filter(sale => sale.sourceType !== 'DAILY_SUMMARY').map(sale => sale.id);
    setSelectedSaleIds(previous => ids.every(id => previous.includes(id))
      ? previous.filter(id => !ids.includes(id)) : [...new Set([...previous, ...ids])]);
  };

  // The same server filters drive rows, totals and exports.
  const filteredSales = salesData?.sales || [];
  const visibleSales = filteredSales;
  const salesEmployees = salesData?.employees || [];

  // The platform administrator picks a store above; Stock Health and Exports work
  // inside a store, so they stay in store preview for that role.
  const tabs = [
    { id: 'sales', label: 'Transactions & Refunds' },
    { id: 'stock-health', label: 'Stock Health' },
    { id: 'overall', label: 'Overall Report' },
    { id: 'employee', label: 'Employee Sales' },
    { id: 'exports', label: 'Exports' },
  ].filter(tab => view || scopeUser?.role !== 'SUPER_ADMIN' || !['stock-health', 'exports'].includes(tab.id));

  // Chart colors

  return (
    <ManagementPage>
      <PageHeader
        title={view ? tabs.find(tab => tab.id === view)?.label || 'Reports' : 'Reports'}
        actions={
          <>
            {activeTab === 'exports' && exportActions}
            {activeTab === 'overall' && scopeUser?.role === 'ADMIN' && scopeUser.locationId && <DigestDeliveryControls key={scopeUser.id + scopeUser.locationId} userId={scopeUser.id} storeId={scopeUser.locationId} />}
            {activeTab === 'sales' && (
              <Button variant="outline" disabled={isLoading || !!reportError || !salesData || salesData.pagination.entryCount > 5000} onClick={() => setShowExportPreview('sales')}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            )}
          </>
        }
        tabs={!view && <PageTabs label="Report views" items={tabs} value={activeTab} onChange={id => setActiveTab(id as ReportView)} />}
        toolbar={!view && scopeUser?.role === 'SUPER_ADMIN' ? <StoreFilterSelect value={locationId} onChange={setLocationId} /> : undefined}
      />

      <AutoRefreshStatus state={reportQuery} />
      {/* Overall Report */}
      {activeTab === 'overall' && overallData && (
        <div className="space-y-6">
          <AboutNumbers timezone={overallData.period?.timezone}>
            <p>The last 7 and 30 days include today up to now. Sales include tax; refunds and voids come off on the day they happen.</p>
            <p>Payment totals count each tender a sale used; refunds come off the tender they were paid back to. Top customers are ranked by lifetime spend.</p>
          </AboutNumbers>
          {overallData.historyWarning && <p role="status" className="text-sm text-warning">{overallData.historyWarning}</p>}
          {/* Revenue Overview */}
          <div>
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-success" />
              Sales Overview
            </h2>
            <SummaryStrip emphasis items={[
              { label: 'Sales today', value: money(overallData.revenue?.today?.total), detail: `${overallData.revenue?.today?.transactions ?? 'Unknown'} ${overallData.revenue?.today?.transactions === 1 ? 'sale' : 'sales'}` },
              { label: 'Last 7 Days', value: money(overallData.revenue?.week?.total), detail: overallData.revenue?.week?.growth == null ? 'Comparison unavailable' : `${overallData.revenue.week.growth >= 0 ? '+' : '−'}${Math.abs(overallData.revenue.week.growth).toFixed(1)}% vs preceding 7 days` },
              { label: 'Last 30 Days', value: money(overallData.revenue?.month?.total), detail: overallData.revenue?.month?.growth == null ? 'Comparison unavailable' : `${overallData.revenue.month.growth >= 0 ? '+' : '−'}${Math.abs(overallData.revenue.month.growth).toFixed(1)}% vs preceding 30 days` },
              { label: 'Last 365 Days', value: money(overallData.revenue?.year?.total), detail: `${overallData.revenue?.year?.transactions ?? 'Unknown'} transactions` },
            ]} />
          </div>

          {overallData.profitability?.unavailableReason && <div className="report-notice"><p role="status">{overallData.profitability.unavailableReason}</p><Link className="page-action" to="/financial?tab=inventory&costTab=missing">Review costs</Link></div>}
          {overallData.profitability?.provisionalReason && <div className="report-notice"><p role="status">Profit is not final. {overallData.profitability.provisionalReason}</p><Link className="page-action" to="/inventory/stock-control/exceptions">Resolve stock exceptions</Link></div>}
          {/* Profitability */}
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                Profitability (Last 30 Days)
              </h2>
              <Link
                to={'/financial?tab=pnl&pnlMonth=' + presetRange('thisMonth', overallData.period?.timezone || 'UTC')!.startDate.slice(0, 7)}
                className="text-sm text-primary hover:underline flex items-center gap-1"
              >
                This Month's P&amp;L
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <SummaryStrip items={[
              { label: 'Gross Profit', value: overallData.profitability?.grossProfit == null ? 'Unavailable' : formatCurrency(overallData.profitability.grossProfit), detail: overallData.profitability?.grossMargin == null ? 'Margin unavailable' : overallData.profitability.grossMargin.toFixed(1) + '% margin' + (overallData.profitability.provisionalReason ? ' · not final' : '') },
              { label: 'Net Profit', value: overallData.profitability?.netProfit == null ? 'Unavailable' : formatCurrency(overallData.profitability.netProfit), detail: overallData.profitability?.netMargin == null ? 'Margin unavailable' : overallData.profitability.netMargin.toFixed(1) + '% margin' + (overallData.profitability.provisionalReason ? ' · not final' : '') },
              { label: 'Cost of Goods Sold', value: overallData.profitability?.costOfGoodsSold == null ? 'Unavailable' : formatCurrency(overallData.profitability.costOfGoodsSold), detail: overallData.profitability?.provisionalReason ? 'Includes estimated costs awaiting review' : undefined },
              { label: 'Operating Expenses', value: money(overallData.profitability?.totalExpenses) },
            ]} />
            <div className="mt-4 space-y-2">
              {!!overallData.profitability?.otherIncome && <div className="flex justify-between text-sm"><span>Other income included in net profit</span><span>{formatCurrency(overallData.profitability.otherIncome)}</span></div>}
              <InventoryPurchaseSummary received={overallData.profitability?.receivedInventoryPurchases} purchaseEntries={overallData.profitability?.inventoryPurchases} />
            </div>
          </div>

          {/* Sales Trend Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Daily Sales (Last 30 Days)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={overallData.trends?.dailySales || []}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      minTickGap={32}
                      dataKey="date"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value: string) => `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`}
                    />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      tickFormatter={formatChartCurrency}
                    />
                    <Tooltip
                      formatter={(value: any) => [formatCurrency(value), 'Sales after refunds']}
                      labelFormatter={(label) => String(label)}
                    />
                    <Line
                      type="monotone"
                      dataKey="sales"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Customer & Inventory Overview */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Customer Insights */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Customer Insights
                </CardTitle>
                <Link
                  to="/customers"
                  className="text-sm text-primary hover:underline flex items-center gap-1"
                >
                  View All
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Customers</p>
                    <p className="text-xl font-bold">{overallData.customers?.total ?? '\u2014'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">New in Last 30 Days</p>
                    <p className="text-xl font-bold text-success">{overallData.customers?.new ?? '\u2014'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Returning</p>
                    <p className="text-xl font-bold">{overallData.customers?.returning ?? '\u2014'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Average Spent per Customer</p>
                    <p className="text-xl font-bold">{money(overallData.customers?.avgLifetimeValue)}</p>
                  </div>
                </div>
                <div className="pt-4 border-t">
                  <p className="text-sm font-medium mb-2">Top Customers (All Time)</p>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {(overallData.customers?.topCustomers || []).slice(0, 5).map((customer: any, index: number) => (
                      <div key={customer.id} className="flex justify-between items-center text-sm">
                        <span className="truncate">
                          {index + 1}. {customer.firstName} {customer.lastName}
                        </span>
                        <span className="font-medium">{formatCurrency(customer.totalSpent)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Inventory Health */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  Inventory Health
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Products</p>
                    <p className="text-xl font-bold">{overallData.inventory?.totalProducts ?? '\u2014'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Inventory Value</p>
                    <p className="text-xl font-bold">{overallData.inventory?.inventoryValue == null ? 'Unavailable' : formatCurrency(overallData.inventory.inventoryValue)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Low Stock</p>
                    <p className="text-xl font-bold text-warning">{overallData.inventory?.lowStockCount ?? '\u2014'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Out of Stock</p>
                    <p className="text-xl font-bold text-destructive">{overallData.inventory?.outOfStockCount ?? '\u2014'}</p>
                  </div>
                </div>
                {(overallData.inventory?.lowStockItems?.length > 0 || overallData.inventory?.outOfStockItems?.length > 0) && (
                  <div className="pt-4 border-t">
                    <p className="text-sm font-medium mb-2 flex items-center gap-1">
                      <AlertTriangle className="h-4 w-4 text-warning" />
                      Items Needing Attention
                    </p>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {(overallData.inventory?.outOfStockItems || []).slice(0, 3).map((item: any) => (
                        <div key={item.id} className="flex justify-between items-center text-sm">
                          <span className="truncate">{item.name}</span>
                          <span className="text-destructive font-medium">Out of Stock</span>
                        </div>
                      ))}
                      {(overallData.inventory?.lowStockItems || []).slice(0, 3).map((item: any) => (
                        <div key={item.id} className="flex justify-between items-center text-sm">
                          <span className="truncate">{item.name}</span>
                          <span className="text-warning font-medium">{item.stock} left</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Top Products & Categories */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top Selling Products */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5" />
                  Top Selling Products (Last 30 Days)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(overallData.topProducts || []).slice(0, 10).map((product: any, index: number) => (
                      <TableRow key={product.productId || index}>
                        <TableCell className="truncate max-w-[200px]">{product.name}</TableCell>
                        <TableCell className="text-right">{product.quantitySold}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(product.revenue)}</TableCell>
                      </TableRow>
                    ))}
                    {(!overallData.topProducts || overallData.topProducts.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground">
                          No sales data available
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Sales by Category */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Sales by Category
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(overallData.salesByCategory && overallData.salesByCategory.length > 0) ? (
                  <div className="h-64" role="img" aria-label={'Sales by category: ' + overallData.salesByCategory.map((entry: { name: string; revenue: number }) => `${entry.name} ${formatCurrency(entry.revenue)}`).join(', ')}>
                    <div aria-hidden="true" className="h-full">
                    <ResponsiveContainer width="100%" height="100%">
                      {overallData.salesByCategory.some((entry: { revenue: number }) => entry.revenue < 0) || overallData.salesByCategory.reduce((sum: number, entry: { revenue: number }) => sum + entry.revenue, 0) <= 0 ?
                        <BarChart data={overallData.salesByCategory} accessibilityLayer={false}><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis /><ReferenceLine y={0} stroke="currentColor" /><Tooltip formatter={(value: number) => formatCurrency(value)} /><Bar dataKey="revenue" fill="hsl(var(--primary))" isAnimationActive={false} /></BarChart> : <PieChart accessibilityLayer={false}>
                        <Pie
                          rootTabIndex={-1}
                          data={overallData.salesByCategory}
                          dataKey="revenue"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          label={(entry) => entry.name}
                        >
                          {overallData.salesByCategory.map((_entry: any, index: number) => (
                            <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value) => formatCurrency(value as number)} />
                      </PieChart>}
                    </ResponsiveContainer>
                    </div>
                  </div>
                ) : (
                  <div className="h-64 flex items-center justify-center text-muted-foreground">
                    No category data available
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-2">{overallData.categoryBasis}</p>
              </CardContent>
            </Card>
          </div>

          {/* Payment Methods & Employee Performance */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Payment Methods */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5" />
                  Payments (Last 30 Days)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-3">Each tender a sale used, less refunds paid back to it.</p>
                <div className="space-y-3">
                  {(overallData.paymentMethods || []).map((pm: any) => (
                    <div key={pm.method} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {pm.method === 'CASH' && <Wallet className="h-4 w-4" />}
                        {pm.method === 'CARD' && <CreditCard className="h-4 w-4" />}
                        {!['CASH', 'CARD'].includes(pm.method) && <DollarSign className="h-4 w-4" />}
                        <span className="text-sm">{formatEnumLabel(pm.method)}</span>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{formatCurrency(pm.total)}</p>
                        <p className="text-xs text-muted-foreground">{pm.count} sales ({pm.percentage == null ? 'share unavailable' : pm.percentage.toFixed(1) + '%'})</p>
                      </div>
                    </div>
                  ))}
                  {(!overallData.paymentMethods || overallData.paymentMethods.length === 0) && (
                    <p className="text-center text-muted-foreground">No payment data available</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Employee Performance */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Employee Performance (Last 30 Days)
                </CardTitle>
                <Link
                  to="/insights/reports/staff"
                  className="text-sm text-primary hover:underline flex items-center gap-1"
                >
                  View Details
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead className="text-right">Sales</TableHead>
                      <TableHead className="text-right">Average Sale</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(overallData.employeePerformance || []).slice(0, 5).map((emp: any) => (
                      <TableRow key={emp.id}>
                        <TableCell className="truncate max-w-[150px]">{emp.name}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(emp.totalSales)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{formatCurrency(emp.avgOrderValue)}</TableCell>
                      </TableRow>
                    ))}
                    {(!overallData.employeePerformance || overallData.employeePerformance.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground">
                          No employee data available
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          {/* Expense Breakdown & Average Order Value */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Expense Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="h-5 w-5" />
                  Expense Breakdown (Last 30 Days)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {(overallData.expenses?.breakdown || []).map((exp: any) => (
                    <div key={exp.category} className="flex items-center justify-between">
                      <span className="text-sm">{formatEnumLabel(exp.category)}</span>
                      <div className="text-right">
                        <p className="font-medium">{formatCurrency(exp.total)}</p>
                        <p className="text-xs text-muted-foreground">{exp.percentage.toFixed(1)}%</p>
                      </div>
                    </div>
                  ))}
                  {(!overallData.expenses?.breakdown || overallData.expenses.breakdown.length === 0) && (
                    <p className="text-center text-muted-foreground">No expense data available</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Average Order Value & Refunds */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  Key Metrics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Average Sale (Before Refunds)</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div className="text-center p-2 bg-muted rounded">
                        <p className="text-xs text-muted-foreground">Today</p>
                        <p className="font-medium">{overallData.averageOrderValue?.today == null ? 'Unavailable' : formatCurrency(overallData.averageOrderValue.today)}</p>
                      </div>
                      <div className="text-center p-2 bg-muted rounded">
                        <p className="text-xs text-muted-foreground">Last 7 Days</p>
                        <p className="font-medium">{overallData.averageOrderValue?.week == null ? 'Unavailable' : formatCurrency(overallData.averageOrderValue.week)}</p>
                      </div>
                      <div className="text-center p-2 bg-muted rounded">
                        <p className="text-xs text-muted-foreground">Last 30 Days</p>
                        <p className="font-medium">{overallData.averageOrderValue?.month == null ? 'Unavailable' : formatCurrency(overallData.averageOrderValue.month)}</p>
                      </div>
                    </div>
                  </div>
                  <div className="pt-4 border-t">
                    <p className="text-sm text-muted-foreground mb-2">Refunds & Voids (Last 30 Days)</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Refunds</p>
                        <p className="font-medium text-destructive">
                          {formatCurrency(overallData.refundsAndVoids?.refunds?.total || 0)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {overallData.refundsAndVoids?.refunds?.count || 0} transactions
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Voids</p>
                        <p className="font-medium text-destructive">
                          {formatCurrency(overallData.refundsAndVoids?.voids?.total || 0)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {overallData.refundsAndVoids?.voids?.count || 0} transactions
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Sales Report */}
      {reportError && <div role="alert" className="mb-4 rounded border border-destructive p-4">{reportError} <Button variant="outline" onClick={loadReports}>Retry</Button></div>}
      {activeTab === 'sales' && (
        <>
          {/* Search & Filter Bar */}
          <div className="report-filter-toolbar flex flex-wrap items-center gap-2 mb-3">
            <DateRangePicker label="Sales dates" startDate={salesFilters.startDate} endDate={salesFilters.endDate} timezone={salesData?.period.timezone} onChange={range => setSalesFilters({ ...salesFilters, ...range })} />
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by sale #, customer name, email, or phone..."
                value={salesSearchQuery}
                onChange={(e) => setSalesSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button
              variant={salesFilters.showCharts ? 'default' : 'outline'}
              onClick={() => setSalesFilters({ ...salesFilters, showCharts: !salesFilters.showCharts })}
              title="Toggle charts visualization"
            >
              <BarChart3 className="h-4 w-4 mr-2" />
              Charts
            </Button>
            <div className="relative">
              <Button
                variant={showSalesFilters ? 'default' : 'outline'}
                onClick={() => setShowSalesFilters(!showSalesFilters)}
              >
                <Filter className="h-4 w-4 mr-2" />
                Filters
                {(salesFilters.paymentMethod.length > 0 ||
                  salesFilters.status.length > 0 ||
                  salesFilters.employeeId.length > 0) && (
                  <span className="ml-2 bg-primary-foreground text-primary rounded-full px-2 py-0.5 text-xs">
                    {salesFilters.paymentMethod.length + salesFilters.status.length + salesFilters.employeeId.length}
                  </span>
                )}
              </Button>

              {/* Filters Dropdown */}
              <FilterDropdown
                isOpen={showSalesFilters}
                onClose={() => setShowSalesFilters(false)}
                title="Sales Filters"
              >
                <SalesFilters
                  filters={salesFilters}
                  onFilterChange={setSalesFilters}
                  onClear={() =>
                    setSalesFilters({
                      paymentMethod: [],
                      status: [],
                      employeeId: [],
                      customerId: '',
                      startDate: reportToday.subtract({ days: 30 }).toString(),
                      endDate: reportToday.toString(),
                      minAmount: '',
                      maxAmount: '',
                      showCharts: false as boolean,
                    })
                  }
                  employees={salesEmployees}
                />
              </FilterDropdown>
            </div>
          </div>
          <FilterChips filters={salesFilters} onChange={setSalesFilters} count={salesData?.pagination?.sales.total} lookup={Object.fromEntries(salesEmployees.map(employee => [employee.id, employee.firstName + " " + employee.lastName]))} />

        </>
      )}
      {activeTab === 'sales' && (
        <>
          <SalesBulkActions
            key={`${scopeUser?.id}:${scopeUser?.locationId}`}
            selectedSales={(!isLoading && !reportError ? salesData?.sales || [] : []).filter(sale => selectedSaleIds.includes(sale.id) && sale.sourceType !== 'DAILY_SUMMARY')}
            onClearSelection={() => setSelectedSaleIds([])}
            onSuccess={loadReports}
          />
          <BulkRefundActions key={`refund:${scopeUser?.id}:${scopeUser?.locationId}`} selectedSales={(!isLoading && !reportError ? salesData?.sales || [] : []).filter(sale => selectedSaleIds.includes(sale.id) && sale.sourceType !== 'DAILY_SUMMARY')} onSuccess={() => { setSelectedSaleIds([]); void loadReports(); }} />
        </>
      )}

      {activeTab === 'sales' && salesData && !reportError && (
        <fieldset disabled={isLoading} className="min-w-0">
          {isLoading && <p role="status" className="mb-3 text-sm text-muted-foreground">Updating report. These are the previous results.</p>}

          <SummaryStrip className="mb-4" items={[
            { label: 'Sales after refunds (incl. tax)', value: formatCurrency(salesData.summary?.totalSales || 0) },
            { label: 'Transactions', value: salesData.summary?.totalTransactions ?? 'Unavailable' },
            { label: 'Average sale', value: salesData.summary?.averageOrderValue == null ? 'Unavailable' : formatCurrency(salesData.summary.averageOrderValue) },
            { label: 'Total Discount', value: salesData.summary?.totalDiscount == null ? 'Unavailable' : formatCurrency(salesData.summary.totalDiscount) },
          ]} />

          <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span>Refunds issued: <span className="tabular-nums text-foreground">{formatCurrency(salesData.summary.refunds)}</span> ({salesData.summary.refundCount})</span>
            <span>Voids recorded: <span className="tabular-nums text-foreground">{formatCurrency(salesData.summary.voids)}</span> ({salesData.summary.voidCount})</span>
            <span>Net sales before tax: <span className="tabular-nums text-foreground">{salesData.summary.netSales === null ? 'Unavailable' : formatCurrency(salesData.summary.netSales)}</span></span>
            <details className="w-full"><summary className="inline-flex min-h-9 cursor-pointer items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">About these numbers</summary>
              <p className="mt-1 max-w-3xl text-sm leading-6">Store time: {salesData.period.timezone}. Filters pick sales by the sale itself; refunds and voids count on the day they happened. The payment filter matches each sale's main payment type. The payment chart uses the actual split payments and where each refund went.</p>
            </details>
          </div>
          {salesData.pagination.entryCount > 5000 && <p role="status" className="mb-4 text-sm">Direct CSV and PDF downloads support up to 5,000 entries. Narrow the dates or filters.{scopeUser?.role === 'ADMIN' && <> For a full store CSV, <Link to="/settings/jobs" className="underline text-primary">queue a saved export</Link>.</>}</p>}
          {salesData.historyWarning && <p role="status" className="mb-4 text-warning">{salesData.historyWarning}</p>}
          {salesData.voids.length > 0 && <Card className="mb-6"><CardHeader><CardTitle>Voids recorded in this period</CardTitle></CardHeader><CardContent>
            <Table><TableHeader><TableRow><TableHead>Original sale</TableHead><TableHead>Void date</TableHead><TableHead>Reason</TableHead><TableHead className="text-right">Reversed</TableHead></TableRow></TableHeader>
              <TableBody>{salesData.voids.map(event => <TableRow key={event.id}>
                <TableCell><button className="text-primary underline" onClick={() => setSaleRecord(event.sale.id)}>{event.sale.saleNumber}</button></TableCell>
                <TableCell>{formatDateTime(event.createdAt, salesData.period.timezone)}</TableCell><TableCell>{event.reason}</TableCell><TableCell className="text-right tabular-nums">{formatCurrency(event.amount)}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
            <nav aria-label="Void pages"><Pagination page={salesData.pagination.voids.page} totalPages={salesData.pagination.voids.totalPages} totalItems={salesData.pagination.voids.total} itemName="voids" onPageChange={value => setVoidPageRaw(String(value))} /></nav>
          </CardContent></Card>}
          {salesData.refunds.length > 0 && <Card className="mb-6"><CardHeader><CardTitle>Returns issued in this period</CardTitle></CardHeader><CardContent>
            <Table><TableHeader><TableRow><TableHead>Original sale</TableHead><TableHead>Return date</TableHead><TableHead>Tender</TableHead><TableHead className="text-right">Returned</TableHead></TableRow></TableHeader>
              <TableBody>{salesData.refunds.map(refund => <TableRow key={refund.id}>
                <TableCell><button className="text-primary underline" onClick={() => setSaleRecord(refund.sale.id)}>{refund.sale.saleNumber}</button></TableCell>
                <TableCell>{formatDateTime(refund.createdAt, salesData.period.timezone)}</TableCell><TableCell>{refund.tenders?.length ? refund.tenders.map((part, index) => <p key={index}>{formatEnumLabel(part.method)}: {formatCurrency(part.amount)}{part.reference ? ` (${part.reference})` : ''}</p>) : refund.method || 'Unavailable'}</TableCell><TableCell className="text-right tabular-nums">{formatCurrency(refund.amount)}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
            <nav aria-label="Return pages"><Pagination page={salesData.pagination.refunds.page} totalPages={salesData.pagination.refunds.totalPages} totalItems={salesData.pagination.refunds.total} itemName="returns" onPageChange={value => setRefundPageRaw(String(value))} /></nav>
          </CardContent></Card>}

          {/* Payment Method Breakdown */}
          {salesFilters.showCharts && salesData.paymentBreakdown && Object.keys(salesData.paymentBreakdown).length > 0 && (
            <div className="mb-6">
              <DataVisualizationCard
                title="Sales after refunds, by payment type"
                data={Object.entries(salesData.paymentBreakdown).map(([method, data]: [string, any]) => ({
                  name: formatEnumLabel(method),
                  value: data.total,
                  count: data.count,
                }))}
              />
            </div>
          )}

          {/* Employee Performance Breakdown */}
          {salesFilters.showCharts && salesData.employeeBreakdown && Object.keys(salesData.employeeBreakdown).length > 0 && (
            <div className="mb-6">
              <DataVisualizationCard
                title="Sales after refunds, by cashier"
                data={Object.values(salesData.employeeBreakdown).map((data: any) => ({
                  name: data.name,
                  value: data.total,
                  count: data.count,
                }))}
              />
            </div>
          )}

          {/* Sales Table */}
          <Card>
            <CardHeader>
              <CardTitle>
                {salesSearchQuery ||
                salesFilters.paymentMethod.length > 0 ||
                salesFilters.status.length > 0 ||
                salesFilters.employeeId.length > 0
                  ? `Filtered Sales (${salesData.pagination.sales.total})`
                  : 'All Sales'}
              </CardTitle>
              <p className="text-sm text-muted-foreground">Showing {visibleSales.length} of {salesData.pagination.sales.total} sales. Totals and charts cover everything that matches the filters.</p>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <input
                      type="checkbox"
                      aria-label="Select all sales on this page"
                      checked={
                        visibleSales.length > 0 &&
                        visibleSales.every(sale => selectedSaleIds.includes(sale.id) && sale.sourceType !== 'DAILY_SUMMARY')
                      }
                      onChange={toggleSelectAllSales}
                      className="cursor-pointer"
                    />
                  </TableHead>
                  <TableHead>Sale #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Primary tender</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSales.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9}>
                      <EmptyState
                        icon={ShoppingCart}
                        title="No sales found"
                        hint="Try widening the date range or clearing filters"
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleSales.map((sale) => (
                    <TableRow
                      key={sale.id}
                      className="cursor-pointer hover:bg-accent"
                      onClick={(e) => {
                        if (
                          (e.target as HTMLElement).tagName === 'INPUT' ||
                          (e.target as HTMLElement).closest('button')
                        ) {
                          return;
                        }
                        setSaleRecord(sale.id);
                      }}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          disabled={sale.sourceType === 'DAILY_SUMMARY'} aria-label={`Select sale ${sale.saleNumber}`}
                          checked={selectedSaleIds.includes(sale.id)}
                          onChange={() => toggleSaleSelection(sale.id)}
                          className="cursor-pointer"
                        />
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-sm">{sale.saleNumber}</span>{sale.sourceType === 'DAILY_SUMMARY' && <p className="text-xs text-muted-foreground">Daily summary</p>}
                      </TableCell>
                      <TableCell>{sale.sourceType === 'DAILY_SUMMARY' ? sale.sourceData?.businessDate : formatDateTime(sale.createdAt, salesData.period.timezone)}</TableCell>
                      <TableCell>
                        {sale.sourceType === 'DAILY_SUMMARY' ? 'Not supplied' : sale.customer
                          ? `${sale.customer.firstName} ${sale.customer.lastName}`
                          : 'Walk-in'}
                      </TableCell>
                      <TableCell>
                        {sale.sourceType === 'DAILY_SUMMARY' ? 'Not supplied' : sale.user ? `${sale.user.firstName} ${sale.user.lastName}` : '\u2014'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {sale.sourceType === 'DAILY_SUMMARY' ? 'Recorded totals' : formatEnumLabel(sale.paymentMethod)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={sale.status === 'COMPLETED' ? 'success' : sale.status === 'PENDING' ? 'warning' : sale.status === 'HOLD' ? 'default' : 'destructive'}>
                          {formatEnumLabel(sale.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(sale.total)}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => {
                            setSaleRecord(sale.id);
                          }}
                          className="p-1 hover:bg-accent rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          title="View details"
                          aria-label={`View sale ${sale.saleNumber}`}
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>

          <nav aria-label="Sale pages"><Pagination page={salesData.pagination.sales.page} totalPages={salesData.pagination.sales.totalPages} onPageChange={setSalesPage} totalItems={salesData.pagination.sales.total} itemName="sales" /></nav>
        </fieldset>
      )}

      {activeTab === 'sales' && saleRecord && (!saleDetail.data || saleDetail.error) && <Modal isOpen onClose={() => setSaleRecord('')} title="Sale Details" size="md">
        {saleDetail.loading && <p role="status">Loading sale...</p>}
        {saleDetail.error && <div role="alert"><p>{saleDetail.error}</p><Button onClick={saleDetail.refresh}>Retry sale</Button></div>}
      </Modal>}
      <SaleDetailsModal isOpen={activeTab === 'sales' && !!saleRecord && !!saleDetail.data && !saleDetail.error} onClose={() => setSaleRecord('')} sale={saleDetail.data} refreshing={saleDetail.loading || saleDetail.refreshing} onSuccess={loadReports} />

      {/* Employee Sales Tab */}
      {activeTab === 'employee' && (
        <EmployeeSalesTab key={`${scopeUser?.id}:${scopeUser?.role}:${scopeUser?.locationId}:${locationId}`} locationId={locationId} />
      )}

      {/* Stock Health Tab (self-loading) */}
      {activeTab === 'stock-health' && (
        <StockHealthTab />
      )}

      {/* Exports Tab (self-loading — journals, scan data, history) */}
      {activeTab === 'exports' && (
        <ExportsTab onActions={setExportActions} />
      )}

      {isLoading && !['employee', 'stock-health', 'exports'].includes(activeTab) && (
        <div className="flex justify-center p-12">
          <Spinner size="lg" />
        </div>
      )}

      {/* Export Preview Modal */}
      {showExportPreview && (
        <ExportPreviewModal
          isOpen={!!showExportPreview}
          onClose={() => setShowExportPreview(null)}
          type="sales"
          data={salesData?.entries || []}
          totalItems={salesData?.pagination.entryCount}
          onExportCSV={async () => { await handleSalesExport('csv'); setShowExportPreview(null); }}
          onExportPDF={async () => { await handleSalesExport('pdf'); setShowExportPreview(null); }}
        />
      )}
    </ManagementPage>
  );
};
