import { useCalendarTimezone } from '@/hooks/useCalendarTimezone';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { FilterChips } from '@/components/common/FilterChips';
import { useUrlFilter, useUrlPage, useUrlObject } from '@/hooks/useUrlFilter';
import { InventoryPurchaseSummary } from '@/components/financial/InventoryPurchaseSummary';
import { DigestDeliveryControls } from '@/components/reports/DigestDeliveryControls';
import { EmployeeSalesTab } from '@/components/reports/EmployeeSalesTab';
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { reportService, saleService } from '@/services/api';
import { formatCurrency, formatChartCurrency, formatEnumLabel, CHART_COLORS } from '@/lib/utils';
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
import { InventoryFilters } from '@/components/reports/InventoryFilters';
import { InventoryDetailsModal } from '@/components/reports/InventoryDetailsModal';
import { InventoryBulkActions } from '@/components/reports/InventoryBulkActions';
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

export type ReportView = 'overall' | 'sales' | 'inventory' | 'employee' | 'stock-health' | 'exports';
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
  const [showExportPreview, setShowExportPreview] = useState<'sales' | 'inventory' | null>(null);

  // Inventory-specific state
  const [showProductDetails, setShowProductDetails] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [showInventoryFilters, setShowInventoryFilters] = useState(false);
  const [inventorySearchQuery, setInventorySearchQuery] = useUrlFilter('stockSearch');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [inventoryFilters, setInventoryFilters] = useUrlObject('stockFilters', {
    category: [] as string[],
    stockStatus: [] as string[],
    minPrice: '',
    maxPrice: '',
    trackInventory: null as boolean | null,
    isActive: null as boolean | null,
    startDate: reportToday.subtract({ days: 30 }).toString(),
    endDate: reportToday.toString(),
    showCharts: false as boolean,
  });


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
    if (activeTab === 'overall') return (await reportService.getOverall(params, signal)).data.data;
    return (await reportService.getInventory(params, signal)).data.data;
  }, ['sales', 'overall', 'inventory'].includes(activeTab));
  const salesData: SalesReportData | null = activeTab === 'sales' ? reportQuery.data : null;
  const overallData = activeTab === 'overall' ? reportQuery.data : null;
  const inventoryData = activeTab === 'inventory' ? reportQuery.data : null;
  const isLoading = reportQuery.loading || (activeTab === 'sales' && readySearch !== salesSearchQuery);
  const reportError = reportQuery.stale ? '' : reportQuery.error;
  const saleDetail = useScopedQuery<Sale>(['report-sale', saleRecord, locationId], async signal => (await saleService.getById(saleRecord, signal)).data.data, activeTab === 'sales' && !!saleRecord);
  const loadReports = () => { invalidateScopedQueries(); };
  useEffect(() => { setSelectedSaleIds([]); setSelectedProductIds([]); }, [activeTab, salesPage, salesFilters, salesSearchQuery, inventoryFilters, locationId, scopeUser?.id, scopeUser?.locationId]);
  useEffect(() => { setShowExportPreview(null); setSelectedProduct(null); setShowProductDetails(false); }, [activeTab, locationId, scopeUser?.id, scopeUser?.locationId]);

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

  // Inventory helper functions
  const handleInventoryExport = async (format: 'csv' | 'pdf') => {
    try {
      const params = {
        ...inventoryFilters,
        category: inventoryFilters.category.join(','),
        stockStatus: inventoryFilters.stockStatus.join(','),
        locationId: locationId || undefined,
      };

      const response =
        format === 'csv'
          ? await reportService.exportInventoryCSV(params)
          : await reportService.exportInventoryPDF(params);

      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `inventory-export.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success(`Exported inventory as ${format.toUpperCase()}`);
    } catch (error) {
      console.error(`Failed to export ${format}:`, error);
      toast.error(`Failed to export ${format}`);
    }
  };

  const toggleProductSelection = (id: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(id) ? prev.filter((productId) => productId !== id) : [...prev, id]
    );
  };

  const toggleSelectAllProducts = () => {
    if (selectedProductIds.length === filteredProducts.length) {
      setSelectedProductIds([]);
    } else {
      setSelectedProductIds(filteredProducts.map((product) => product.id));
    }
  };

  // Filter and search inventory
  const filteredProducts = React.useMemo(() => {
    if (!inventoryData?.products) return [];

    let filtered = [...inventoryData.products];

    // Apply search
    if (inventorySearchQuery) {
      const query = inventorySearchQuery.toLowerCase();
      filtered = filtered.filter(
        (product: any) =>
          product.sku.toLowerCase().includes(query) ||
          product.name.toLowerCase().includes(query) ||
          product.barcode?.toLowerCase().includes(query)
      );
    }

    // Apply filters
    if (inventoryFilters.category.length > 0) {
      filtered = filtered.filter((product: any) =>
        inventoryFilters.category.includes(product.categoryId)
      );
    }
    if (inventoryFilters.minPrice) {
      filtered = filtered.filter((product: any) =>
        product.price >= parseFloat(inventoryFilters.minPrice)
      );
    }
    if (inventoryFilters.maxPrice) {
      filtered = filtered.filter((product: any) =>
        product.price <= parseFloat(inventoryFilters.maxPrice)
      );
    }
    if (inventoryFilters.trackInventory !== null) {
      filtered = filtered.filter((product: any) =>
        product.trackInventory === inventoryFilters.trackInventory
      );
    }
    if (inventoryFilters.isActive !== null) {
      filtered = filtered.filter((product: any) =>
        product.isActive === inventoryFilters.isActive
      );
    }
    if (inventoryFilters.stockStatus.length > 0) {
      filtered = filtered.filter((product: any) => {
        if (!product.trackInventory) return inventoryFilters.stockStatus.includes('Not Tracked');
        if (product.stockQuantity === 0) return inventoryFilters.stockStatus.includes('Out of Stock');
        if (product.stockQuantity <= product.lowStockAlert) return inventoryFilters.stockStatus.includes('Low Stock');
        return inventoryFilters.stockStatus.includes('In Stock');
      });
    }

    // Apply date range filter (defensive client-side filtering based on updatedAt)
    if (inventoryFilters.startDate || inventoryFilters.endDate) {
      filtered = filtered.filter((product: any) => {
        if (!product.updatedAt) return false;
        const productDate = new Date(product.updatedAt);
        const productTime = productDate.getTime();

        if (inventoryFilters.startDate) {
          const startDate = new Date(inventoryFilters.startDate + 'T00:00:00');
          if (productTime < startDate.getTime()) return false;
        }

        if (inventoryFilters.endDate) {
          const endDate = new Date(inventoryFilters.endDate + 'T23:59:59.999');
          if (productTime > endDate.getTime()) return false;
        }

        return true;
      });
    }

    return filtered;
  }, [inventoryData?.products, inventorySearchQuery, inventoryFilters]);

  // Get unique categories from inventory data
  const inventoryCategories = React.useMemo(() => {
    if (!inventoryData?.products) return [];
    const categoryMap = new Map();
    inventoryData.products.forEach((product: any) => {
      if (product.category && !categoryMap.has(product.categoryId)) {
        categoryMap.set(product.categoryId, {
          id: product.categoryId,
          name: product.category.name,
        });
      }
    });
    return Array.from(categoryMap.values());
  }, [inventoryData?.products]);

  const tabs = [
    { id: 'sales', label: 'Sales Reports' },
    { id: 'inventory', label: 'Inventory Reports' },
    { id: 'stock-health', label: 'Stock Health' },
    { id: 'overall', label: 'Overall Report' },
    { id: 'employee', label: 'Employee Sales' },
    { id: 'exports', label: 'Exports' },
  ];

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
            {activeTab === 'inventory' && filteredProducts.length > 0 && (
              <Button variant="outline" onClick={() => setShowExportPreview('inventory')}>
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
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2 text-xs text-muted-foreground"><p>Calendar: {overallData.period?.timezone}.</p><details className="max-w-xl"><summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">About these figures</summary><p className="mt-2 text-sm leading-5">Rolling periods include today through the report time. Collections include tax and deduct returns and voids when recorded.</p></details></div>
          {overallData.historyWarning && <p role="status" className="text-sm text-warning">{overallData.historyWarning}</p>}
          {/* Revenue Overview */}
          <div>
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-success" />
              Net Collections Overview
            </h2>
            <SummaryStrip emphasis items={[
              { label: "Today's Net Collections", value: formatCurrency(overallData.revenue?.today?.total || 0), detail: `${overallData.revenue?.today?.transactions ?? 'Unknown'} transactions` },
              { label: 'Last 7 Days', value: formatCurrency(overallData.revenue?.week?.total || 0), detail: overallData.revenue?.week?.growth == null ? 'Comparison unavailable' : `${overallData.revenue.week.growth >= 0 ? '+' : '−'}${Math.abs(overallData.revenue.week.growth).toFixed(1)}% vs preceding 7 days` },
              { label: 'Last 30 Days', value: formatCurrency(overallData.revenue?.month?.total || 0), detail: overallData.revenue?.month?.growth == null ? 'Comparison unavailable' : `${overallData.revenue.month.growth >= 0 ? '+' : '−'}${Math.abs(overallData.revenue.month.growth).toFixed(1)}% vs preceding 30 days` },
              { label: 'Last 365 Days', value: formatCurrency(overallData.revenue?.year?.total || 0), detail: `${overallData.revenue?.year?.transactions ?? 'Unknown'} transactions` },
            ]} />
          </div>

          {overallData.profitability?.unavailableReason && <div className="report-notice"><p role="status">{overallData.profitability.unavailableReason}</p><Link className="page-action" to="/financial?tab=inventory&costTab=missing">Review costs</Link></div>}
          {/* Profitability */}
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                Profitability (Last 30 Days)
              </h2>
              <Link
                to="/financial?tab=pnl"
                className="text-sm text-primary hover:underline flex items-center gap-1"
              >
                View Full P&L
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <SummaryStrip items={[
              { label: 'Gross Profit', value: overallData.profitability?.grossProfit == null ? 'Unavailable' : formatCurrency(overallData.profitability.grossProfit), detail: overallData.profitability?.grossMargin == null ? 'Margin unavailable' : overallData.profitability.grossMargin.toFixed(1) + '% margin' },
              { label: 'Net Profit', value: overallData.profitability?.netProfit == null ? 'Unavailable' : formatCurrency(overallData.profitability.netProfit), detail: overallData.profitability?.netMargin == null ? 'Margin unavailable' : overallData.profitability.netMargin.toFixed(1) + '% margin' },
              { label: 'Cost of Goods Sold', value: overallData.profitability?.costOfGoodsSold == null ? 'Unavailable' : formatCurrency(overallData.profitability.costOfGoodsSold) },
              { label: 'Operating Expenses', value: formatCurrency(overallData.profitability?.totalExpenses || 0) },
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
                Daily Net Collections (Last 30 Days)
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
                      formatter={(value: any) => [formatCurrency(value), 'Net collected']}
                      labelFormatter={(label) => String(label)}
                    />
                    <Line
                      type="monotone"
                      dataKey="sales"
                      stroke="#3b82f6"
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
                    <p className="text-xl font-bold">{overallData.customers?.total || 0}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">New in Last 30 Days</p>
                    <p className="text-xl font-bold text-success">{overallData.customers?.new || 0}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Returning</p>
                    <p className="text-xl font-bold">{overallData.customers?.returning || 0}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Avg Lifetime Value</p>
                    <p className="text-xl font-bold">{formatCurrency(overallData.customers?.avgLifetimeValue || 0)}</p>
                  </div>
                </div>
                <div className="pt-4 border-t">
                  <p className="text-sm font-medium mb-2">Top Customers</p>
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
                    <p className="text-xl font-bold">{overallData.inventory?.totalProducts || 0}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Inventory Value</p>
                    <p className="text-xl font-bold">{overallData.inventory?.inventoryValue == null ? 'Unavailable' : formatCurrency(overallData.inventory.inventoryValue)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Low Stock</p>
                    <p className="text-xl font-bold text-warning">{overallData.inventory?.lowStockCount || 0}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Out of Stock</p>
                    <p className="text-xl font-bold text-destructive">{overallData.inventory?.outOfStockCount || 0}</p>
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
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      {overallData.salesByCategory.some((entry: { revenue: number }) => entry.revenue < 0) || overallData.salesByCategory.reduce((sum: number, entry: { revenue: number }) => sum + entry.revenue, 0) <= 0 ?
                        <BarChart data={overallData.salesByCategory}><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis /><ReferenceLine y={0} stroke="currentColor" /><Tooltip formatter={(value: number) => formatCurrency(value)} /><Bar dataKey="revenue" fill="#3b82f6" isAnimationActive={false} /></BarChart> : <PieChart>
                        <Pie
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
                  Payment Labels (Last 30 Days)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-3">Original sale labels and refund methods; split-tender settlement is separate.</p>
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
                  to="/analytics"
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
                      <TableHead className="text-right">AOV</TableHead>
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
                    <p className="text-sm text-muted-foreground mb-2">Average Original Order Value</p>
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
            { label: 'Net collected (including tax)', value: formatCurrency(salesData.summary?.totalSales || 0) },
            { label: 'Transactions', value: salesData.summary?.totalTransactions ?? 'Unavailable' },
            { label: 'Avg Order Value', value: salesData.summary?.averageOrderValue == null ? 'Unavailable' : formatCurrency(salesData.summary.averageOrderValue) },
            { label: 'Total Discount', value: salesData.summary?.totalDiscount == null ? 'Unavailable' : formatCurrency(salesData.summary.totalDiscount) },
          ]} />

          <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span>Refunds issued: <span className="tabular-nums text-foreground">{formatCurrency(salesData.summary.refunds)}</span> ({salesData.summary.refundCount})</span>
            <span>Voids recorded: <span className="tabular-nums text-foreground">{formatCurrency(salesData.summary.voids)}</span> ({salesData.summary.voidCount})</span>
            <span>Net sales before tax: <span className="tabular-nums text-foreground">{salesData.summary.netSales === null ? 'Unavailable' : formatCurrency(salesData.summary.netSales)}</span></span>
            <details className="w-full"><summary className="inline-flex min-h-9 cursor-pointer items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">About these figures</summary>
              <p className="mt-1 max-w-3xl text-sm leading-6">Calendar: {salesData.period.timezone}. Filters apply to the original sale; returns and voids use their reversal date. Tender filters match the original sale's primary tender label. The payment chart uses recorded split-tender amounts and actual refund destinations.</p>
            </details>
          </div>
          {salesData.pagination.entryCount > 5000 && <p role="status" className="mb-4 text-sm">Direct CSV and PDF downloads support up to 5,000 entries. Narrow the dates or filters.{scopeUser?.role === 'ADMIN' && <> For a full store CSV, <Link to="/settings/jobs" className="underline text-primary">queue a saved export</Link>.</>}</p>}
          {salesData.historyWarning && <p role="status" className="mb-4 text-warning">{salesData.historyWarning}</p>}
          {salesData.voids.length > 0 && <Card className="mb-6"><CardHeader><CardTitle>Voids recorded in this period</CardTitle></CardHeader><CardContent>
            <Table><TableHeader><TableRow><TableHead>Original sale</TableHead><TableHead>Void date</TableHead><TableHead>Reason</TableHead><TableHead className="text-right">Reversed</TableHead></TableRow></TableHeader>
              <TableBody>{salesData.voids.map(event => <TableRow key={event.id}>
                <TableCell><button className="text-primary underline" onClick={() => setSaleRecord(event.sale.id)}>{event.sale.saleNumber}</button></TableCell>
                <TableCell>{new Date(event.createdAt).toLocaleString(undefined, { timeZone: salesData.period.timezone })}</TableCell><TableCell>{event.reason}</TableCell><TableCell className="text-right tabular-nums">{formatCurrency(event.amount)}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
            <div aria-label="Void pages"><Pagination page={salesData.pagination.voids.page} totalPages={salesData.pagination.voids.totalPages} totalItems={salesData.pagination.voids.total} itemName="voids" onPageChange={value => setVoidPageRaw(String(value))} /></div>
          </CardContent></Card>}
          {salesData.refunds.length > 0 && <Card className="mb-6"><CardHeader><CardTitle>Returns issued in this period</CardTitle></CardHeader><CardContent>
            <Table><TableHeader><TableRow><TableHead>Original sale</TableHead><TableHead>Return date</TableHead><TableHead>Tender</TableHead><TableHead className="text-right">Returned</TableHead></TableRow></TableHeader>
              <TableBody>{salesData.refunds.map(refund => <TableRow key={refund.id}>
                <TableCell><button className="text-primary underline" onClick={() => setSaleRecord(refund.sale.id)}>{refund.sale.saleNumber}</button></TableCell>
                <TableCell>{new Date(refund.createdAt).toLocaleString(undefined, { timeZone: salesData.period.timezone })}</TableCell><TableCell>{refund.tenders?.length ? refund.tenders.map((part, index) => <p key={index}>{part.method.replace(/_/g, ' ')}: {formatCurrency(part.amount)}{part.reference ? ` (${part.reference})` : ''}</p>) : refund.method || 'Unavailable'}</TableCell><TableCell className="text-right tabular-nums">{formatCurrency(refund.amount)}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
            <div aria-label="Return pages"><Pagination page={salesData.pagination.refunds.page} totalPages={salesData.pagination.refunds.totalPages} totalItems={salesData.pagination.refunds.total} itemName="returns" onPageChange={value => setRefundPageRaw(String(value))} /></div>
          </CardContent></Card>}

          {/* Payment Method Breakdown */}
          {salesFilters.showCharts && salesData.paymentBreakdown && Object.keys(salesData.paymentBreakdown).length > 0 && (
            <div className="mb-6">
              <DataVisualizationCard
                title="Net collected by payment method"
                data={Object.entries(salesData.paymentBreakdown).map(([method, data]: [string, any]) => ({
                  name: method.replace(/_/g, ' '),
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
                title="Net collected by original cashier"
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
              <p className="text-sm text-muted-foreground">Showing {visibleSales.length} of {salesData.pagination.sales.total} original sales. Totals and charts cover the entire filtered range.</p>
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
                      <TableCell>{sale.sourceType === 'DAILY_SUMMARY' ? sale.sourceData?.businessDate : new Date(sale.createdAt).toLocaleString(undefined, { timeZone: salesData.period.timezone })}</TableCell>
                      <TableCell>
                        {sale.sourceType === 'DAILY_SUMMARY' ? 'Not supplied' : sale.customer
                          ? `${sale.customer.firstName} ${sale.customer.lastName}`
                          : 'Walk-in'}
                      </TableCell>
                      <TableCell>
                        {sale.sourceType === 'DAILY_SUMMARY' ? 'Not supplied' : sale.user ? `${sale.user.firstName} ${sale.user.lastName}` : 'N/A'}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs px-2 py-1 rounded bg-muted">
                          {sale.sourceType === 'DAILY_SUMMARY' ? 'Recorded totals' : sale.paymentMethod.replace(/_/g, ' ')}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`text-xs px-2 py-1 rounded ${
                            sale.status === 'COMPLETED'
                              ? 'bg-success/10 text-success'
                              : sale.status === 'PENDING'
                              ? 'bg-warning/10 text-warning'
                              : sale.status === 'HOLD'
                              ? 'bg-primary/10 text-primary'
                              : 'bg-destructive/10 text-destructive'
                          }`}
                        >
                          {sale.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(sale.total)}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => {
                            setSaleRecord(sale.id);
                          }}
                          className="p-1 hover:bg-accent rounded"
                          title="View details"
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

          <div aria-label="Sale pages"><Pagination page={salesData.pagination.sales.page} totalPages={salesData.pagination.sales.totalPages} onPageChange={setSalesPage} totalItems={salesData.pagination.sales.total} itemName="sales" /></div>
        </fieldset>
      )}

      {activeTab === 'sales' && saleRecord && (!saleDetail.data || saleDetail.error) && <Modal isOpen onClose={() => setSaleRecord('')} title="Sale Details" size="md">
        {saleDetail.loading && <p role="status">Loading sale...</p>}
        {saleDetail.error && <div role="alert"><p>{saleDetail.error}</p><Button onClick={saleDetail.refresh}>Retry sale</Button></div>}
      </Modal>}
      <SaleDetailsModal isOpen={activeTab === 'sales' && !!saleRecord && !!saleDetail.data && !saleDetail.error} onClose={() => setSaleRecord('')} sale={saleDetail.data} refreshing={saleDetail.loading || saleDetail.refreshing} onSuccess={loadReports} />

      {/* Inventory Report */}
      {activeTab === 'inventory' && inventoryData && (
        <>
          {/* Search & Filter Bar */}
          <div className="report-filter-toolbar flex flex-wrap items-center gap-2 mb-3">
            <DateRangePicker label="Product creation dates" startDate={inventoryFilters.startDate} endDate={inventoryFilters.endDate} timezone={inventoryData?.period?.timezone} onChange={range => setInventoryFilters({ ...inventoryFilters, ...range })} />
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by SKU, product name, or barcode..."
                value={inventorySearchQuery}
                onChange={(e) => setInventorySearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button
              variant={inventoryFilters.showCharts ? 'default' : 'outline'}
              onClick={() => setInventoryFilters({ ...inventoryFilters, showCharts: !inventoryFilters.showCharts })}
              title="Toggle charts visualization"
            >
              <BarChart3 className="h-4 w-4 mr-2" />
              Charts
            </Button>
            <div className="relative">
              <Button
                variant={showInventoryFilters ? 'default' : 'outline'}
                onClick={() => setShowInventoryFilters(!showInventoryFilters)}
              >
                <Filter className="h-4 w-4 mr-2" />
                Filters
                {(inventoryFilters.category.length > 0 ||
                  inventoryFilters.stockStatus.length > 0 ||
                  inventoryFilters.trackInventory !== null ||
                  inventoryFilters.isActive !== null) && (
                  <span className="ml-2 bg-primary-foreground text-primary rounded-full px-2 py-0.5 text-xs">
                    {inventoryFilters.category.length +
                      inventoryFilters.stockStatus.length +
                      (inventoryFilters.trackInventory !== null ? 1 : 0) +
                      (inventoryFilters.isActive !== null ? 1 : 0)}
                  </span>
                )}
              </Button>

              {/* Filters Dropdown */}
              <FilterDropdown
                isOpen={showInventoryFilters}
                onClose={() => setShowInventoryFilters(false)}
                title="Inventory Filters"
              >
                <InventoryFilters
                  filters={inventoryFilters}
                  onFilterChange={setInventoryFilters}
                  onClear={() =>
                    setInventoryFilters({
                      category: [],
                      stockStatus: [],
                      minPrice: '',
                      maxPrice: '',
                      trackInventory: null,
                      isActive: null,
                      startDate: reportToday.subtract({ days: 30 }).toString(),
                      endDate: reportToday.toString(),
                      showCharts: false as boolean,
                    })
                  }
                  categories={inventoryCategories}
                />
              </FilterDropdown>
            </div>
          </div>
          <FilterChips filters={inventoryFilters} onChange={setInventoryFilters} count={filteredProducts.length} lookup={Object.fromEntries(inventoryCategories.map((category: { id: string; name: string }) => [category.id, category.name]))} />

          {/* Bulk Actions Toolbar */}
          <InventoryBulkActions
            selectedIds={selectedProductIds}
            onClearSelection={() => setSelectedProductIds([])}
            onSuccess={loadReports}
            categories={inventoryCategories}
          />

          <SummaryStrip className="mb-4" items={[
            { label: 'Total Products', value: inventoryData.summary?.totalProducts || 0 },
            { label: 'Inventory Value', value: inventoryData.summary?.totalInventoryValue == null ? 'Unavailable' : formatCurrency(inventoryData.summary.totalInventoryValue) },
            { label: 'Retail Value', value: formatCurrency(inventoryData.summary?.totalRetailValue || 0) },
            { label: 'Potential Profit', value: formatCurrency(inventoryData.summary?.potentialProfit || 0) },
          ]} />

          {/* Inventory Table */}
          <Card>
            <CardHeader>
              <CardTitle>
                {inventorySearchQuery ||
                inventoryFilters.category.length > 0 ||
                inventoryFilters.stockStatus.length > 0 ||
                inventoryFilters.trackInventory !== null ||
                inventoryFilters.isActive !== null
                  ? `Filtered Products (${filteredProducts.length})`
                  : 'All Products'}
              </CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <input
                      type="checkbox"
                      checked={
                        filteredProducts.length > 0 &&
                        selectedProductIds.length === filteredProducts.length
                      }
                      onChange={toggleSelectAllProducts}
                      className="cursor-pointer"
                    />
                  </TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10}>
                      <EmptyState
                        icon={Package}
                        title="No products found"
                        hint="Try adjusting your search or filters"
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredProducts.slice(0, 50).map((product: any) => {
                    const stockStatus = !product.trackInventory
                      ? { label: 'N/T', color: 'text-muted-foreground' }
                      : product.stockQuantity === 0
                      ? { label: 'Out', color: 'text-destructive' }
                      : product.stockQuantity <= product.lowStockAlert
                      ? { label: 'Low', color: 'text-warning' }
                      : { label: 'OK', color: 'text-success' };

                    return (
                      <TableRow
                        key={product.id}
                        className="cursor-pointer hover:bg-accent"
                        onClick={(e) => {
                          if (
                            (e.target as HTMLElement).tagName === 'INPUT' ||
                            (e.target as HTMLElement).closest('button')
                          ) {
                            return;
                          }
                          setSelectedProduct(product);
                          setShowProductDetails(true);
                        }}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedProductIds.includes(product.id)}
                            onChange={() => toggleProductSelection(product.id)}
                            className="cursor-pointer"
                          />
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-sm">{product.sku}</span>
                        </TableCell>
                        <TableCell className="font-medium max-w-xs truncate">
                          {product.name}
                        </TableCell>
                        <TableCell>{product.category?.name || '-'}</TableCell>
                        <TableCell>
                          <span className={stockStatus.color + ' font-medium'}>
                            {product.trackInventory ? product.stockQuantity : 'N/A'}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {formatCurrency(product.cost)}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {formatCurrency(product.price)}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <span
                              className={`text-xs px-2 py-1 rounded ${
                                product.isActive
                                  ? 'bg-success/10 text-success'
                                  : 'bg-destructive/10 text-destructive'
                              }`}
                            >
                              {product.isActive ? 'Active' : 'Inactive'}
                            </span>
                            <span
                              className={`text-xs px-2 py-1 rounded bg-muted ${stockStatus.color}`}
                            >
                              {stockStatus.label}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium font-mono">
                          {formatCurrency(product.cost * product.stockQuantity)}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => {
                              setSelectedProduct(product);
                              setShowProductDetails(true);
                            }}
                            className="p-1 hover:bg-accent rounded"
                            title="View details"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </Card>

          {filteredProducts.length > 50 && (
            <p className="text-sm text-muted-foreground text-center mt-2">
              Showing 50 of {filteredProducts.length} products. Use filters or export to view all.
            </p>
          )}

          {/* Product Details Modal */}
          <InventoryDetailsModal
            isOpen={showProductDetails}
            onClose={() => {
              setShowProductDetails(false);
              setSelectedProduct(null);
            }}
            product={selectedProduct}
          />
        </>
      )}

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
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
        </div>
      )}

      {/* Export Preview Modal */}
      {showExportPreview && (
        <ExportPreviewModal
          isOpen={!!showExportPreview}
          onClose={() => setShowExportPreview(null)}
          type={showExportPreview}
          data={showExportPreview === 'sales' ? salesData?.entries || [] : filteredProducts}
          totalItems={showExportPreview === 'sales' ? salesData?.pagination.entryCount : undefined}
          onExportCSV={async () => {
            if (showExportPreview === 'sales') await handleSalesExport('csv');
            else await handleInventoryExport('csv');
            setShowExportPreview(null);
          }}
          onExportPDF={async () => {
            if (showExportPreview === 'sales') await handleSalesExport('pdf');
            else await handleInventoryExport('pdf');
            setShowExportPreview(null);
          }}
        />
      )}
    </ManagementPage>
  );
};
