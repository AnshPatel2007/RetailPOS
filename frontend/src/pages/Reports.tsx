import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { reportService } from '@/services/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';

// Helper to get local date in YYYY-MM-DD format (avoids timezone issues with toISOString)
const getLocalDateString = (date: Date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
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
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  Package,
  ShoppingCart,
  AlertTriangle,
  RefreshCw,
  CreditCard,
  Wallet,
  Target,
  Activity,
  ArrowRight,
  Download,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import type { SalesReportData, Sale } from '@/types';
import { SalesFilters } from '@/components/reports/SalesFilters';
import { SaleDetailsModal } from '@/components/reports/SaleDetailsModal';
import { SalesBulkActions } from '@/components/reports/SalesBulkActions';
import { InventoryFilters } from '@/components/reports/InventoryFilters';
import { InventoryDetailsModal } from '@/components/reports/InventoryDetailsModal';
import { InventoryBulkActions } from '@/components/reports/InventoryBulkActions';
import { FilterDropdown } from '@/components/common/FilterDropdown';
import { ExportPreviewModal } from '@/components/reports/ExportPreviewModal';
import { DataVisualizationCard } from '@/components/reports/DataVisualizationCard';

export const Reports: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'overall' | 'sales' | 'inventory'>('sales');
  const [overallData, setOverallData] = useState<any>(null);
  const [salesData, setSalesData] = useState<SalesReportData | null>(null);
  const [inventoryData, setInventoryData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Sales-specific state
  const [showSaleDetails, setShowSaleDetails] = useState(false);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [showSalesFilters, setShowSalesFilters] = useState(false);
  const [salesSearchQuery, setSalesSearchQuery] = useState('');
  const [selectedSaleIds, setSelectedSaleIds] = useState<string[]>([]);
  const [salesFilters, setSalesFilters] = useState({
    paymentMethod: [] as string[],
    status: [] as string[],
    employeeId: [] as string[],
    customerId: '',
    startDate: getLocalDateString(new Date(new Date().setDate(new Date().getDate() - 30))),
    endDate: getLocalDateString(),
    minAmount: '',
    maxAmount: '',
    showCharts: false,
  });

  // Export preview state
  const [showExportPreview, setShowExportPreview] = useState<'sales' | 'inventory' | null>(null);

  // Inventory-specific state
  const [showProductDetails, setShowProductDetails] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [showInventoryFilters, setShowInventoryFilters] = useState(false);
  const [inventorySearchQuery, setInventorySearchQuery] = useState('');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [inventoryFilters, setInventoryFilters] = useState({
    category: [] as string[],
    stockStatus: [] as string[],
    minPrice: '',
    maxPrice: '',
    trackInventory: null as boolean | null,
    isActive: null as boolean | null,
    startDate: getLocalDateString(new Date(new Date().setDate(new Date().getDate() - 30))),
    endDate: getLocalDateString(),
    showCharts: false,
  });

  useEffect(() => {
    loadReports();
  }, [activeTab, salesFilters.startDate, salesFilters.endDate, inventoryFilters.startDate, inventoryFilters.endDate]);

  const loadReports = async () => {
    setIsLoading(true);
    try {
      if (activeTab === 'overall') {
        const response = await reportService.getOverall();
        setOverallData(response.data.data);
      } else if (activeTab === 'sales') {
        const response = await reportService.getSales({
          startDate: salesFilters.startDate,
          endDate: salesFilters.endDate,
        });
        setSalesData(response.data.data);
      } else if (activeTab === 'inventory') {
        const response = await reportService.getInventory();
        setInventoryData(response.data.data);
      }
    } catch (error) {
      console.error('Failed to load reports:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Sales helper functions
  const handleSalesExport = async (format: 'csv' | 'pdf') => {
    try {
      const params = {
        ...salesFilters,
        paymentMethod: salesFilters.paymentMethod.join(','),
        status: salesFilters.status.join(','),
        employeeId: salesFilters.employeeId.join(','),
      };

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
      toast.success(`Exported sales as ${format.toUpperCase()}`);
    } catch (error) {
      console.error(`Failed to export ${format}:`, error);
      toast.error(`Failed to export ${format}`);
    }
  };

  const toggleSaleSelection = (id: string) => {
    setSelectedSaleIds((prev) =>
      prev.includes(id) ? prev.filter((saleId) => saleId !== id) : [...prev, id]
    );
  };

  const toggleSelectAllSales = () => {
    if (selectedSaleIds.length === filteredSales.length) {
      setSelectedSaleIds([]);
    } else {
      setSelectedSaleIds(filteredSales.map((sale) => sale.id));
    }
  };

  // Filter and search sales
  const filteredSales = React.useMemo(() => {
    if (!salesData?.sales) return [];

    let filtered = [...salesData.sales];

    // Apply search
    if (salesSearchQuery) {
      const query = salesSearchQuery.toLowerCase();
      filtered = filtered.filter(
        (sale) =>
          sale.saleNumber.toLowerCase().includes(query) ||
          (sale.customer &&
            (`${sale.customer.firstName} ${sale.customer.lastName}`.toLowerCase().includes(query) ||
             sale.customer.email?.toLowerCase().includes(query) ||
             sale.customer.phone?.toLowerCase().includes(query)))
      );
    }

    // Apply filters
    if (salesFilters.paymentMethod.length > 0) {
      filtered = filtered.filter((sale) => salesFilters.paymentMethod.includes(sale.paymentMethod));
    }
    if (salesFilters.status.length > 0) {
      filtered = filtered.filter((sale) => salesFilters.status.includes(sale.status));
    }
    if (salesFilters.employeeId.length > 0) {
      filtered = filtered.filter((sale) => salesFilters.employeeId.includes(sale.userId));
    }
    if (salesFilters.customerId) {
      filtered = filtered.filter((sale) => sale.customerId === salesFilters.customerId);
    }
    if (salesFilters.minAmount) {
      filtered = filtered.filter((sale) => sale.total >= parseFloat(salesFilters.minAmount));
    }
    if (salesFilters.maxAmount) {
      filtered = filtered.filter((sale) => sale.total <= parseFloat(salesFilters.maxAmount));
    }

    // Apply date range filter (defensive client-side filtering)
    if (salesFilters.startDate || salesFilters.endDate) {
      filtered = filtered.filter((sale) => {
        const saleDate = new Date(sale.createdAt);
        const saleTime = saleDate.getTime();

        if (salesFilters.startDate) {
          const startDate = new Date(salesFilters.startDate + 'T00:00:00');
          if (saleTime < startDate.getTime()) return false;
        }

        if (salesFilters.endDate) {
          const endDate = new Date(salesFilters.endDate + 'T23:59:59.999');
          if (saleTime > endDate.getTime()) return false;
        }

        return true;
      });
    }

    return filtered;
  }, [salesData?.sales, salesSearchQuery, salesFilters]);

  // Get unique employees from sales data
  const salesEmployees = React.useMemo(() => {
    if (!salesData?.sales) return [];
    const employeeMap = new Map();
    salesData.sales.forEach((sale: any) => {
      if (sale.user && !employeeMap.has(sale.userId)) {
        employeeMap.set(sale.userId, {
          id: sale.userId,
          firstName: sale.user.firstName,
          lastName: sale.user.lastName,
        });
      }
    });
    return Array.from(employeeMap.values());
  }, [salesData?.sales]);

  // Inventory helper functions
  const handleInventoryExport = async (format: 'csv' | 'pdf') => {
    try {
      const params = {
        ...inventoryFilters,
        category: inventoryFilters.category.join(','),
        stockStatus: inventoryFilters.stockStatus.join(','),
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
    { id: 'overall', label: 'Overall Report' },
  ];

  // Chart colors
  const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16'];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Reports</h1>
          <p className="text-muted-foreground">
            Track performance and gain business insights
          </p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'overall' && (
            <Button variant="outline" onClick={loadReports} title="Refresh data">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          )}
          {activeTab === 'sales' && filteredSales.length > 0 && (
            <Button variant="outline" onClick={() => setShowExportPreview('sales')}>
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
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-2 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2 rounded-md font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overall Report */}
      {activeTab === 'overall' && overallData && (
        <div className="space-y-6">
          {/* Revenue Overview */}
          <div>
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-success" />
              Revenue Overview
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-6">
                  <p className="text-sm text-muted-foreground mb-1">Today's Revenue</p>
                  <p className="text-2xl font-bold text-success">
                    {formatCurrency(overallData.revenue?.today?.total || 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {overallData.revenue?.today?.transactions || 0} transactions
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <p className="text-sm text-muted-foreground mb-1">This Week</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(overallData.revenue?.week?.total || 0)}
                  </p>
                  <div className="flex items-center gap-1 mt-1">
                    {(overallData.revenue?.week?.growth || 0) >= 0 ? (
                      <TrendingUp className="h-3 w-3 text-success" />
                    ) : (
                      <TrendingDown className="h-3 w-3 text-destructive" />
                    )}
                    <span className={`text-xs ${(overallData.revenue?.week?.growth || 0) >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {Math.abs(overallData.revenue?.week?.growth || 0).toFixed(1)}% vs last week
                    </span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <p className="text-sm text-muted-foreground mb-1">This Month</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(overallData.revenue?.month?.total || 0)}
                  </p>
                  <div className="flex items-center gap-1 mt-1">
                    {(overallData.revenue?.month?.growth || 0) >= 0 ? (
                      <TrendingUp className="h-3 w-3 text-success" />
                    ) : (
                      <TrendingDown className="h-3 w-3 text-destructive" />
                    )}
                    <span className={`text-xs ${(overallData.revenue?.month?.growth || 0) >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {Math.abs(overallData.revenue?.month?.growth || 0).toFixed(1)}% vs last month
                    </span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <p className="text-sm text-muted-foreground mb-1">This Year</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(overallData.revenue?.year?.total || 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {overallData.revenue?.year?.transactions || 0} transactions
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Profitability */}
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                Profitability (This Month)
              </h2>
              <Link
                to="/financial"
                className="text-sm text-primary hover:underline flex items-center gap-1"
              >
                View Full P&L
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-6">
                  <p className="text-sm text-muted-foreground mb-1">Gross Profit</p>
                  <p className="text-2xl font-bold text-success">
                    {formatCurrency(overallData.profitability?.grossProfit || 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {overallData.profitability?.grossMargin?.toFixed(1) || 0}% margin
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <p className="text-sm text-muted-foreground mb-1">Net Profit</p>
                  <p className={`text-2xl font-bold ${(overallData.profitability?.netProfit || 0) >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {formatCurrency(overallData.profitability?.netProfit || 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {overallData.profitability?.netMargin?.toFixed(1) || 0}% margin
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <p className="text-sm text-muted-foreground mb-1">Cost of Goods Sold</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(overallData.profitability?.costOfGoodsSold || 0)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <p className="text-sm text-muted-foreground mb-1">Total Expenses</p>
                  <p className="text-2xl font-bold text-destructive">
                    {formatCurrency(overallData.profitability?.totalExpenses || 0)}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Sales Trend Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Daily Sales Trend (Last 30 Days)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={overallData.trends?.dailySales || []}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(value) => {
                        const date = new Date(value);
                        return `${date.getMonth() + 1}/${date.getDate()}`;
                      }}
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      formatter={(value: any) => [formatCurrency(value), 'Sales']}
                      labelFormatter={(label) => formatDate(label)}
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
                    <p className="text-sm text-muted-foreground">New This Month</p>
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
                    <p className="text-xl font-bold">{formatCurrency(overallData.inventory?.inventoryValue || 0)}</p>
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
                  Top Selling Products (This Month)
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
                      <PieChart>
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
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-64 flex items-center justify-center text-muted-foreground">
                    No category data available
                  </div>
                )}
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
                  Payment Methods (This Month)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {(overallData.paymentMethods || []).map((pm: any) => (
                    <div key={pm.method} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {pm.method === 'CASH' && <Wallet className="h-4 w-4" />}
                        {pm.method === 'CARD' && <CreditCard className="h-4 w-4" />}
                        {!['CASH', 'CARD'].includes(pm.method) && <DollarSign className="h-4 w-4" />}
                        <span className="text-sm">{pm.method.replace(/_/g, ' ')}</span>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{formatCurrency(pm.total)}</p>
                        <p className="text-xs text-muted-foreground">{pm.count} txns ({pm.percentage.toFixed(1)}%)</p>
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
                  Employee Performance (This Month)
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
                  Expense Breakdown (This Month)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {(overallData.expenses?.breakdown || []).map((exp: any) => (
                    <div key={exp.category} className="flex items-center justify-between">
                      <span className="text-sm">{exp.category.replace(/_/g, ' ')}</span>
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
                    <p className="text-sm text-muted-foreground mb-2">Average Order Value</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div className="text-center p-2 bg-muted rounded">
                        <p className="text-xs text-muted-foreground">Today</p>
                        <p className="font-medium">{formatCurrency(overallData.averageOrderValue?.today || 0)}</p>
                      </div>
                      <div className="text-center p-2 bg-muted rounded">
                        <p className="text-xs text-muted-foreground">Week</p>
                        <p className="font-medium">{formatCurrency(overallData.averageOrderValue?.week || 0)}</p>
                      </div>
                      <div className="text-center p-2 bg-muted rounded">
                        <p className="text-xs text-muted-foreground">Month</p>
                        <p className="font-medium">{formatCurrency(overallData.averageOrderValue?.month || 0)}</p>
                      </div>
                    </div>
                  </div>
                  <div className="pt-4 border-t">
                    <p className="text-sm text-muted-foreground mb-2">Refunds & Voids (This Month)</p>
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
      {activeTab === 'sales' && salesData && (
        <>
          {/* Search & Filter Bar */}
          <div className="flex gap-2 mb-4">
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
                      startDate: new Date().toISOString().split('T')[0],
                      endDate: new Date().toISOString().split('T')[0],
                      minAmount: '',
                      maxAmount: '',
                      showCharts: false,
                    })
                  }
                  employees={salesEmployees}
                />
              </FilterDropdown>
            </div>
          </div>

          {/* Bulk Actions Toolbar */}
          <SalesBulkActions
            selectedIds={selectedSaleIds}
            onClearSelection={() => setSelectedSaleIds([])}
            onSuccess={loadReports}
          />

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground mb-1">Total Sales</p>
                <p className="text-2xl font-bold text-success">
                  {formatCurrency(salesData.summary?.totalSales || 0)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground mb-1">Transactions</p>
                <p className="text-2xl font-bold">{salesData.summary?.totalTransactions || 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground mb-1">Avg Order Value</p>
                <p className="text-2xl font-bold">
                  {formatCurrency(salesData.summary?.averageOrderValue || 0)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground mb-1">Total Discount</p>
                <p className="text-2xl font-bold text-destructive">
                  {formatCurrency(salesData.summary?.totalDiscount || 0)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Payment Method Breakdown */}
          {salesFilters.showCharts && salesData.paymentBreakdown && Object.keys(salesData.paymentBreakdown).length > 0 && (
            <div className="mb-6">
              <DataVisualizationCard
                title="Sales by Payment Method"
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
                title="Sales by Employee"
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
                  ? `Filtered Sales (${filteredSales.length})`
                  : 'All Sales'}
              </CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <input
                      type="checkbox"
                      checked={
                        filteredSales.length > 0 &&
                        selectedSaleIds.length === filteredSales.length
                      }
                      onChange={toggleSelectAllSales}
                      className="cursor-pointer"
                    />
                  </TableHead>
                  <TableHead>Sale #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSales.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      No sales found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredSales.slice(0, 50).map((sale) => (
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
                        setSelectedSale(sale);
                        setShowSaleDetails(true);
                      }}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedSaleIds.includes(sale.id)}
                          onChange={() => toggleSaleSelection(sale.id)}
                          className="cursor-pointer"
                        />
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-sm">{sale.saleNumber}</span>
                      </TableCell>
                      <TableCell>{formatDate(sale.createdAt)}</TableCell>
                      <TableCell>
                        {sale.customer
                          ? `${sale.customer.firstName} ${sale.customer.lastName}`
                          : 'Walk-in'}
                      </TableCell>
                      <TableCell>
                        {sale.user ? `${sale.user.firstName} ${sale.user.lastName}` : 'N/A'}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs px-2 py-1 rounded bg-muted">
                          {sale.paymentMethod.replace(/_/g, ' ')}
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
                            setSelectedSale(sale);
                            setShowSaleDetails(true);
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

          {/* Sale Details Modal */}
          <SaleDetailsModal
            isOpen={showSaleDetails}
            onClose={() => {
              setShowSaleDetails(false);
              setSelectedSale(null);
            }}
            sale={selectedSale}
            onSuccess={loadReports}
          />
        </>
      )}

      {/* Inventory Report */}
      {activeTab === 'inventory' && inventoryData && (
        <>
          {/* Search & Filter Bar */}
          <div className="flex gap-2 mb-4">
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
                      startDate: new Date(new Date().setDate(new Date().getDate() - 30))
                        .toISOString()
                        .split('T')[0],
                      endDate: new Date().toISOString().split('T')[0],
                      showCharts: false,
                    })
                  }
                  categories={inventoryCategories}
                />
              </FilterDropdown>
            </div>
          </div>

          {/* Bulk Actions Toolbar */}
          <InventoryBulkActions
            selectedIds={selectedProductIds}
            onClearSelection={() => setSelectedProductIds([])}
            onSuccess={loadReports}
            categories={inventoryCategories}
          />

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground mb-1">Total Products</p>
                <p className="text-2xl font-bold">
                  {inventoryData.summary?.totalProducts || 0}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground mb-1">Inventory Value</p>
                <p className="text-2xl font-bold">
                  {formatCurrency(inventoryData.summary?.totalInventoryValue || 0)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground mb-1">Retail Value</p>
                <p className="text-2xl font-bold">
                  {formatCurrency(inventoryData.summary?.totalRetailValue || 0)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground mb-1">Potential Profit</p>
                <p className="text-2xl font-bold text-success">
                  {formatCurrency(inventoryData.summary?.potentialProfit || 0)}
                </p>
              </CardContent>
            </Card>
          </div>

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
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                      No products found
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

      {isLoading && (
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
          data={showExportPreview === 'sales' ? filteredSales : filteredProducts}
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
    </div>
  );
};
