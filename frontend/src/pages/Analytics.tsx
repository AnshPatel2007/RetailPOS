import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  TrendingDown,
  BarChart3,
  PieChart,
  Package,
  DollarSign,
  RefreshCw,
  Star,
  AlertTriangle,
  HelpCircle,
  ArrowUpRight,
  ArrowDownRight,
  Target,
  Activity,
  Brain,
  Zap,
  Gift,
  Trophy,
  Heart,
  Calculator,
  ShoppingBag,
  Award,
  Medal,
  Sparkles,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  Line,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  AreaChart,
  Area,
} from 'recharts';
import { analyticsService } from '../services/api';
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

export const Analytics: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'inventory' | 'products' | 'forecast' | 'predictions' | 'anomalies' | 'bundles' | 'employees' | 'health' | 'whatif'>('overview');
  const [loading, setLoading] = useState(true);
  const [comparisonData, setComparisonData] = useState<any>(null);
  const [abcData, setAbcData] = useState<any>(null);
  const [matrixData, setMatrixData] = useState<any>(null);
  const [forecastData, setForecastData] = useState<any>(null);
  const [realtimeData, setRealtimeData] = useState<any>(null);
  const [inventoryPredictions, setInventoryPredictions] = useState<any>(null);
  const [anomaliesData, setAnomaliesData] = useState<any>(null);
  const [bundlesData, setBundlesData] = useState<any>(null);
  const [employeeData, setEmployeeData] = useState<any>(null);
  const [healthData, setHealthData] = useState<any>(null);
  const [whatIfData, setWhatIfData] = useState<any>(null);
  const [whatIfInputs, setWhatIfInputs] = useState({ priceChange: 0, costChange: 0, volumeChange: 0 });
  const [abcDays, setAbcDays] = useState('90');
  const [forecastDays, setForecastDays] = useState('30');
  const [employeeDays, setEmployeeDays] = useState('30');

  useEffect(() => {
    fetchAllData();
    const interval = setInterval(fetchRealtime, 30000); // Refresh realtime every 30s
    return () => clearInterval(interval);
  }, []);

  const fetchAllData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchComparison(),
        fetchABC(),
        fetchMatrix(),
        fetchForecast(),
        fetchRealtime(),
        fetchInventoryPredictions(),
        fetchAnomalies(),
        fetchBundles(),
        fetchEmployeePerformance(),
        fetchBusinessHealth(),
      ]);
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchComparison = async () => {
    try {
      const response = await analyticsService.getComparison();
      setComparisonData(response.data.data);
    } catch (error) {
      console.error('Failed to fetch comparison:', error);
    }
  };

  const fetchABC = async () => {
    try {
      const response = await analyticsService.getABCAnalysis({ days: abcDays });
      setAbcData(response.data.data);
    } catch (error) {
      console.error('Failed to fetch ABC analysis:', error);
    }
  };

  const fetchMatrix = async () => {
    try {
      const response = await analyticsService.getProductMatrix({ days: 30 });
      setMatrixData(response.data.data);
    } catch (error) {
      console.error('Failed to fetch product matrix:', error);
    }
  };

  const fetchForecast = async () => {
    try {
      const response = await analyticsService.getForecast({ forecastDays });
      setForecastData(response.data.data);
    } catch (error) {
      console.error('Failed to fetch forecast:', error);
    }
  };

  const fetchRealtime = async () => {
    try {
      const response = await analyticsService.getRealtime();
      setRealtimeData(response.data.data);
    } catch (error) {
      console.error('Failed to fetch realtime:', error);
    }
  };

  const fetchInventoryPredictions = async () => {
    try {
      const response = await analyticsService.getInventoryPredictions();
      setInventoryPredictions(response.data.data);
    } catch (error) {
      console.error('Failed to fetch inventory predictions:', error);
    }
  };

  const fetchAnomalies = async () => {
    try {
      const response = await analyticsService.getAnomalies();
      setAnomaliesData(response.data.data);
    } catch (error) {
      console.error('Failed to fetch anomalies:', error);
    }
  };

  const fetchBundles = async () => {
    try {
      const response = await analyticsService.getBundleRecommendations();
      setBundlesData(response.data.data);
    } catch (error) {
      console.error('Failed to fetch bundle recommendations:', error);
    }
  };

  const fetchEmployeePerformance = async () => {
    try {
      const response = await analyticsService.getEmployeePerformance({ days: employeeDays });
      setEmployeeData(response.data.data);
    } catch (error) {
      console.error('Failed to fetch employee performance:', error);
    }
  };

  const fetchBusinessHealth = async () => {
    try {
      const response = await analyticsService.getBusinessHealth();
      setHealthData(response.data.data);
    } catch (error) {
      console.error('Failed to fetch business health:', error);
    }
  };

  const fetchWhatIfAnalysis = async () => {
    try {
      const response = await analyticsService.getWhatIfAnalysis(whatIfInputs);
      setWhatIfData(response.data.data);
    } catch (error) {
      console.error('Failed to fetch what-if analysis:', error);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  };

  const GrowthIndicator = ({ value }: { value: number }) => {
    if (value > 0) {
      return (
        <span className="flex items-center text-green-500 text-sm">
          <ArrowUpRight className="w-4 h-4" />
          {formatPercent(value)}
        </span>
      );
    } else if (value < 0) {
      return (
        <span className="flex items-center text-red-500 text-sm">
          <ArrowDownRight className="w-4 h-4" />
          {formatPercent(value)}
        </span>
      );
    }
    return <span className="text-muted-foreground text-sm">0%</span>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Analytics</h1>
          <p className="text-muted-foreground">
            Deep insights into your business performance
          </p>
        </div>
        <Button variant="outline" onClick={fetchAllData}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Real-time Summary */}
      {realtimeData && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Today's Revenue</p>
                <p className="text-2xl font-bold">{formatCurrency(realtimeData.today.revenue)}</p>
              </div>
              <div className="p-3 bg-green-500/10 rounded-full">
                <DollarSign className="w-6 h-6 text-green-500" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {realtimeData.today.transactions} transactions
            </p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Last Hour</p>
                <p className="text-2xl font-bold">{formatCurrency(realtimeData.lastHour.revenue)}</p>
              </div>
              <div className="p-3 bg-blue-500/10 rounded-full">
                <Activity className="w-6 h-6 text-blue-500" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {realtimeData.lastHour.transactions} sales
            </p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Avg Order Value</p>
                <p className="text-2xl font-bold">{formatCurrency(realtimeData.today.avgOrderValue)}</p>
              </div>
              <div className="p-3 bg-purple-500/10 rounded-full">
                <Target className="w-6 h-6 text-purple-500" />
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Alerts</p>
                <p className="text-2xl font-bold">{realtimeData.alerts.lowStockItems}</p>
              </div>
              <div className="p-3 bg-orange-500/10 rounded-full">
                <AlertTriangle className="w-6 h-6 text-orange-500" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Low stock items
            </p>
          </Card>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Button
          variant={activeTab === 'overview' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('overview')}
          size="sm"
        >
          <BarChart3 className="w-4 h-4 mr-2" />
          Comparison
        </Button>
        <Button
          variant={activeTab === 'health' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('health')}
          size="sm"
        >
          <Heart className="w-4 h-4 mr-2" />
          Business Health
        </Button>
        <Button
          variant={activeTab === 'predictions' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('predictions')}
          size="sm"
        >
          <Brain className="w-4 h-4 mr-2" />
          Inventory AI
        </Button>
        <Button
          variant={activeTab === 'anomalies' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('anomalies')}
          size="sm"
        >
          <Zap className="w-4 h-4 mr-2" />
          Anomalies
        </Button>
        <Button
          variant={activeTab === 'bundles' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('bundles')}
          size="sm"
        >
          <Gift className="w-4 h-4 mr-2" />
          Bundles
        </Button>
        <Button
          variant={activeTab === 'employees' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('employees')}
          size="sm"
        >
          <Trophy className="w-4 h-4 mr-2" />
          Employees
        </Button>
        <Button
          variant={activeTab === 'whatif' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('whatif')}
          size="sm"
        >
          <Calculator className="w-4 h-4 mr-2" />
          What-If
        </Button>
        <Button
          variant={activeTab === 'inventory' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('inventory')}
          size="sm"
        >
          <Package className="w-4 h-4 mr-2" />
          ABC Analysis
        </Button>
        <Button
          variant={activeTab === 'products' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('products')}
          size="sm"
        >
          <PieChart className="w-4 h-4 mr-2" />
          Product Matrix
        </Button>
        <Button
          variant={activeTab === 'forecast' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('forecast')}
          size="sm"
        >
          <TrendingUp className="w-4 h-4 mr-2" />
          Forecast
        </Button>
      </div>

      {/* Comparison Analytics Tab */}
      {activeTab === 'overview' && comparisonData && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Daily Comparison */}
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Daily Performance</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Today</span>
                  <span className="font-bold text-xl">{formatCurrency(comparisonData.daily.current.revenue)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span>vs Yesterday</span>
                  <GrowthIndicator value={comparisonData.daily.growthVsPrevious} />
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span>vs Same Day Last Year</span>
                  <GrowthIndicator value={comparisonData.daily.growthVsLastYear} />
                </div>
                <div className="pt-2 border-t">
                  <p className="text-sm text-muted-foreground">
                    {comparisonData.daily.current.transactions} transactions today
                  </p>
                </div>
              </div>
            </Card>

            {/* Weekly Comparison */}
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Weekly Performance</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">This Week</span>
                  <span className="font-bold text-xl">{formatCurrency(comparisonData.weekly.current.revenue)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span>vs Last Week</span>
                  <GrowthIndicator value={comparisonData.weekly.growthVsPrevious} />
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span>vs Same Week Last Year</span>
                  <GrowthIndicator value={comparisonData.weekly.growthVsLastYear} />
                </div>
                <div className="pt-2 border-t">
                  <p className="text-sm text-muted-foreground">
                    {comparisonData.weekly.current.transactions} transactions this week
                  </p>
                </div>
              </div>
            </Card>

            {/* Monthly Comparison */}
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Monthly Performance</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">This Month</span>
                  <span className="font-bold text-xl">{formatCurrency(comparisonData.monthly.current.revenue)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span>vs Last Month</span>
                  <GrowthIndicator value={comparisonData.monthly.growthVsPrevious} />
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span>vs Same Month Last Year</span>
                  <GrowthIndicator value={comparisonData.monthly.growthVsLastYear} />
                </div>
                <div className="pt-2 border-t">
                  <p className="text-sm text-muted-foreground">
                    Profit: {formatCurrency(comparisonData.monthly.current.profit)}
                  </p>
                </div>
              </div>
            </Card>

            {/* Yearly Comparison */}
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Yearly Performance</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">This Year</span>
                  <span className="font-bold text-xl">{formatCurrency(comparisonData.yearly.current.revenue)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span>vs Last Year</span>
                  <GrowthIndicator value={comparisonData.yearly.growthVsPrevious} />
                </div>
                <div className="pt-2 border-t">
                  <p className="text-sm text-muted-foreground">
                    {comparisonData.yearly.current.transactions} transactions YTD
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ABC Inventory Analysis Tab */}
      {activeTab === 'inventory' && abcData && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-semibold">ABC Inventory Analysis</h3>
              <p className="text-sm text-muted-foreground">
                Classify products by revenue contribution
              </p>
            </div>
            <select
              value={abcDays}
              onChange={(e) => {
                setAbcDays(e.target.value);
                setTimeout(fetchABC, 100);
              }}
              className="px-3 py-2 border border-input rounded-md bg-background text-foreground"
            >
              <option value="30">Last 30 days</option>
              <option value="60">Last 60 days</option>
              <option value="90">Last 90 days</option>
              <option value="180">Last 180 days</option>
            </select>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="p-4 border-l-4 border-l-green-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-green-500">Class A - Stars</p>
                  <p className="text-2xl font-bold">{abcData.summary.classA.count} products</p>
                </div>
                <Star className="w-8 h-8 text-green-500" />
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                {abcData.summary.classA.revenuePercentage.toFixed(0)}% of revenue ({abcData.summary.classA.percentage.toFixed(0)}% of items)
              </p>
            </Card>
            <Card className="p-4 border-l-4 border-l-yellow-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-yellow-500">Class B - Stable</p>
                  <p className="text-2xl font-bold">{abcData.summary.classB.count} products</p>
                </div>
                <BarChart3 className="w-8 h-8 text-yellow-500" />
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                {abcData.summary.classB.revenuePercentage.toFixed(0)}% of revenue ({abcData.summary.classB.percentage.toFixed(0)}% of items)
              </p>
            </Card>
            <Card className="p-4 border-l-4 border-l-red-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-red-500">Class C - Slow</p>
                  <p className="text-2xl font-bold">{abcData.summary.classC.count} products</p>
                </div>
                <TrendingDown className="w-8 h-8 text-red-500" />
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                {abcData.summary.classC.revenuePercentage.toFixed(0)}% of revenue ({abcData.summary.classC.percentage.toFixed(0)}% of items)
              </p>
            </Card>
          </div>

          {/* Pareto Chart */}
          <Card className="p-6">
            <h4 className="font-medium mb-4">Revenue Distribution (Pareto)</h4>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={abcData.products.slice(0, 30)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={false} />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 100]} />
                  <Tooltip
                    formatter={(value: any, name: string) =>
                      name === 'cumulative' ? `${value.toFixed(1)}%` : formatCurrency(value)
                    }
                  />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="revenue"
                    fill="#3b82f6"
                    stroke="#3b82f6"
                    name="Revenue"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="cumulativePercentage"
                    stroke="#ef4444"
                    name="cumulative"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Product List */}
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Revenue</TableHead>
                  <TableHead>% of Total</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Stock</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {abcData.products.slice(0, 20).map((product: any) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      <Badge
                        variant={
                          product.classification === 'A' ? 'success' :
                          product.classification === 'B' ? 'warning' : 'destructive'
                        }
                      >
                        {product.classification}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell className="text-muted-foreground">{product.sku}</TableCell>
                    <TableCell>{formatCurrency(product.revenue)}</TableCell>
                    <TableCell>{product.revenuePercentage.toFixed(1)}%</TableCell>
                    <TableCell>{product.quantity}</TableCell>
                    <TableCell>{product.stockQuantity}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* Product Performance Matrix Tab */}
      {activeTab === 'products' && matrixData && (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold">Product Performance Matrix</h3>
            <p className="text-sm text-muted-foreground">
              Classify products by sales velocity and profit margin
            </p>
          </div>

          {/* Quadrant Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-4 border-t-4 border-t-green-500">
              <div className="flex items-center gap-2 mb-2">
                <Star className="w-5 h-5 text-green-500" />
                <h4 className="font-semibold text-green-500">Stars ({matrixData.quadrants.star.count})</h4>
              </div>
              <p className="text-xs text-muted-foreground mb-3">{matrixData.quadrants.star.description}</p>
              <div className="space-y-2">
                {matrixData.quadrants.star.products.slice(0, 5).map((product: any) => (
                  <div key={product.id} className="flex justify-between text-sm">
                    <span className="truncate">{product.name}</span>
                    <span className="font-medium">{formatCurrency(product.revenue)}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-4 border-t-4 border-t-blue-500">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-5 h-5 text-blue-500" />
                <h4 className="font-semibold text-blue-500">Cash Cows ({matrixData.quadrants.cash_cow.count})</h4>
              </div>
              <p className="text-xs text-muted-foreground mb-3">{matrixData.quadrants.cash_cow.description}</p>
              <div className="space-y-2">
                {matrixData.quadrants.cash_cow.products.slice(0, 5).map((product: any) => (
                  <div key={product.id} className="flex justify-between text-sm">
                    <span className="truncate">{product.name}</span>
                    <span className="font-medium">{formatCurrency(product.revenue)}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-4 border-t-4 border-t-yellow-500">
              <div className="flex items-center gap-2 mb-2">
                <HelpCircle className="w-5 h-5 text-yellow-500" />
                <h4 className="font-semibold text-yellow-500">Question Marks ({matrixData.quadrants.question_mark.count})</h4>
              </div>
              <p className="text-xs text-muted-foreground mb-3">{matrixData.quadrants.question_mark.description}</p>
              <div className="space-y-2">
                {matrixData.quadrants.question_mark.products.slice(0, 5).map((product: any) => (
                  <div key={product.id} className="flex justify-between text-sm">
                    <span className="truncate">{product.name}</span>
                    <span className="font-medium">{formatCurrency(product.revenue)}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-4 border-t-4 border-t-red-500">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                <h4 className="font-semibold text-red-500">Dogs ({matrixData.quadrants.dog.count})</h4>
              </div>
              <p className="text-xs text-muted-foreground mb-3">{matrixData.quadrants.dog.description}</p>
              <div className="space-y-2">
                {matrixData.quadrants.dog.products.slice(0, 5).map((product: any) => (
                  <div key={product.id} className="flex justify-between text-sm">
                    <span className="truncate">{product.name}</span>
                    <span className="font-medium">{formatCurrency(product.revenue)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Scatter Plot */}
          <Card className="p-6">
            <h4 className="font-medium mb-4">Product Matrix Visualization</h4>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="velocity"
                    name="Velocity"
                    label={{ value: 'Sales Velocity (units/day)', position: 'bottom' }}
                  />
                  <YAxis
                    type="number"
                    dataKey="margin"
                    name="Margin"
                    label={{ value: 'Profit Margin (%)', angle: -90, position: 'left' }}
                  />
                  <Tooltip
                    content={({ payload }) => {
                      if (payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="bg-background border rounded p-2 text-sm">
                            <p className="font-medium">{data.name}</p>
                            <p>Velocity: {data.velocity.toFixed(2)} /day</p>
                            <p>Margin: {data.margin.toFixed(1)}%</p>
                            <p>Revenue: {formatCurrency(data.revenue)}</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Scatter
                    data={matrixData.products}
                    fill="#3b82f6"
                  >
                    {matrixData.products.map((entry: any, index: number) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={
                          entry.quadrant === 'star' ? '#10b981' :
                          entry.quadrant === 'cash_cow' ? '#3b82f6' :
                          entry.quadrant === 'question_mark' ? '#f59e0b' : '#ef4444'
                        }
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-4 mt-4 text-sm">
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-500 rounded-full"></span> Stars</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-500 rounded-full"></span> Cash Cows</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-yellow-500 rounded-full"></span> Question Marks</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-500 rounded-full"></span> Dogs</span>
            </div>
          </Card>
        </div>
      )}

      {/* Sales Forecast Tab */}
      {activeTab === 'forecast' && forecastData && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-semibold">Sales Forecast</h3>
              <p className="text-sm text-muted-foreground">
                Predicted revenue based on historical trends
              </p>
            </div>
            <select
              value={forecastDays}
              onChange={(e) => {
                setForecastDays(e.target.value);
                setTimeout(fetchForecast, 100);
              }}
              className="px-3 py-2 border border-input rounded-md bg-background text-foreground"
            >
              <option value="7">Next 7 days</option>
              <option value="14">Next 14 days</option>
              <option value="30">Next 30 days</option>
              <option value="60">Next 60 days</option>
            </select>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Forecast Total</p>
              <p className="text-2xl font-bold">{formatCurrency(forecastData.summary.totalForecastRevenue)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Avg Daily Forecast</p>
              <p className="text-2xl font-bold">{formatCurrency(forecastData.summary.avgDailyForecast)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Historical Avg</p>
              <p className="text-2xl font-bold">{formatCurrency(forecastData.summary.historicalAvgDaily)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Expected Growth</p>
              <div className="flex items-center">
                <p className="text-2xl font-bold">{forecastData.summary.expectedGrowth.toFixed(1)}%</p>
                {forecastData.trends.direction === 'upward' ? (
                  <TrendingUp className="w-5 h-5 ml-2 text-green-500" />
                ) : forecastData.trends.direction === 'downward' ? (
                  <TrendingDown className="w-5 h-5 ml-2 text-red-500" />
                ) : null}
              </div>
            </Card>
          </div>

          {/* Forecast Chart */}
          <Card className="p-6">
            <h4 className="font-medium mb-4">Revenue Forecast</h4>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={forecastData.forecast}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip
                    formatter={(value: any) => formatCurrency(value)}
                    labelFormatter={(label) => `Date: ${label}`}
                  />
                  <Area
                    type="monotone"
                    dataKey="confidenceHigh"
                    stroke="none"
                    fill="#3b82f6"
                    fillOpacity={0.1}
                    name="Upper Bound"
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#3b82f6"
                    fill="#3b82f6"
                    fillOpacity={0.3}
                    name="Forecast"
                  />
                  <Area
                    type="monotone"
                    dataKey="confidenceLow"
                    stroke="none"
                    fill="#ffffff"
                    fillOpacity={1}
                    name="Lower Bound"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Day of Week Patterns */}
          <Card className="p-6">
            <h4 className="font-medium mb-4">Day of Week Patterns</h4>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={forecastData.dayOfWeekPatterns}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis domain={[0, 2]} />
                  <Tooltip
                    formatter={(value: any) => `${(value * 100).toFixed(0)}%`}
                  />
                  <Bar dataKey="multiplier" fill="#3b82f6" name="Multiplier">
                    {forecastData.dayOfWeekPatterns.map((entry: any, index: number) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.multiplier >= 1 ? '#10b981' : '#f59e0b'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-sm text-muted-foreground text-center mt-2">
              100% = average daily sales. Above = better than average.
            </p>
          </Card>

          {/* Forecast Table */}
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Day</TableHead>
                  <TableHead>Forecast Revenue</TableHead>
                  <TableHead>Transactions</TableHead>
                  <TableHead>Confidence Range</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {forecastData.forecast.slice(0, 14).map((day: any) => (
                  <TableRow key={day.date}>
                    <TableCell>{day.date}</TableCell>
                    <TableCell>{day.dayOfWeek}</TableCell>
                    <TableCell className="font-medium">{formatCurrency(day.revenue)}</TableCell>
                    <TableCell>{day.transactions}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatCurrency(day.confidenceLow)} - {formatCurrency(day.confidenceHigh)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* Business Health Dashboard Tab */}
      {activeTab === 'health' && healthData && (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold">Business Health Dashboard</h3>
            <p className="text-sm text-muted-foreground">
              Real-time P&L, KPIs, and overall health scores
            </p>
          </div>

          {/* Health Score */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <Card className="p-4 col-span-2 sm:col-span-1">
              <div className="text-center">
                <p className="text-sm text-muted-foreground mb-2">Overall Health</p>
                <div className={`text-4xl font-bold ${
                  healthData.healthScores.overall >= 70 ? 'text-green-500' :
                  healthData.healthScores.overall >= 40 ? 'text-yellow-500' : 'text-red-500'
                }`}>
                  {healthData.healthScores.overall}
                </div>
                <p className="text-xs text-muted-foreground mt-1">out of 100</p>
              </div>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Revenue Score</p>
              <p className="text-2xl font-bold">{healthData.healthScores.revenue}</p>
              <div className="w-full bg-muted rounded-full h-2 mt-2">
                <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${healthData.healthScores.revenue}%` }}></div>
              </div>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Profitability</p>
              <p className="text-2xl font-bold">{healthData.healthScores.profitability}</p>
              <div className="w-full bg-muted rounded-full h-2 mt-2">
                <div className="bg-green-500 h-2 rounded-full" style={{ width: `${healthData.healthScores.profitability}%` }}></div>
              </div>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Inventory</p>
              <p className="text-2xl font-bold">{healthData.healthScores.inventory}</p>
              <div className="w-full bg-muted rounded-full h-2 mt-2">
                <div className="bg-purple-500 h-2 rounded-full" style={{ width: `${healthData.healthScores.inventory}%` }}></div>
              </div>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Growth</p>
              <p className="text-2xl font-bold">{healthData.healthScores.growth}</p>
              <div className="w-full bg-muted rounded-full h-2 mt-2">
                <div className="bg-orange-500 h-2 rounded-full" style={{ width: `${healthData.healthScores.growth}%` }}></div>
              </div>
            </Card>
          </div>

          {/* Revenue Overview */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Today's Revenue</p>
              <p className="text-2xl font-bold">{formatCurrency(healthData.overview.todayRevenue)}</p>
              <p className="text-xs text-muted-foreground">{healthData.overview.todayTransactions} transactions</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Month Revenue</p>
              <p className="text-2xl font-bold">{formatCurrency(healthData.overview.monthRevenue)}</p>
              <p className="text-xs text-muted-foreground">{healthData.overview.monthTransactions} transactions</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Year Revenue</p>
              <p className="text-2xl font-bold">{formatCurrency(healthData.overview.yearRevenue)}</p>
              <p className="text-xs text-muted-foreground">{healthData.overview.yearTransactions} transactions</p>
            </Card>
          </div>

          {/* Profitability */}
          <Card className="p-6">
            <h4 className="font-medium mb-4">Monthly P&L</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span>Gross Revenue</span>
                  <span className="font-medium">{formatCurrency(healthData.profitability.grossRevenue)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>- COGS (Est.)</span>
                  <span>{formatCurrency(healthData.profitability.estimatedCOGS)}</span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span>Gross Profit</span>
                  <span className="font-medium text-green-500">{formatCurrency(healthData.profitability.grossProfit)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>- Operating Expenses</span>
                  <span>{formatCurrency(healthData.profitability.expenses)}</span>
                </div>
                <div className="flex justify-between border-t pt-2 text-lg">
                  <span className="font-semibold">Net Profit</span>
                  <span className={`font-bold ${healthData.profitability.netProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {formatCurrency(healthData.profitability.netProfit)}
                  </span>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span>Gross Margin</span>
                  <span className="font-medium">{healthData.profitability.grossMargin.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Net Margin</span>
                  <span className="font-medium">{healthData.profitability.netMargin.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Revenue Growth</span>
                  <GrowthIndicator value={healthData.kpis.revenueGrowth} />
                </div>
                <div className="flex justify-between">
                  <span>Avg Transaction</span>
                  <span className="font-medium">{formatCurrency(healthData.kpis.avgTransactionValue)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Projected Monthly</span>
                  <span className="font-medium">{formatCurrency(healthData.kpis.projectedMonthlyRevenue)}</span>
                </div>
              </div>
            </div>
          </Card>

          {/* KPIs and Cash Flow */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="p-6">
              <h4 className="font-medium mb-4">Inventory Health</h4>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span>Total Units</span>
                  <span className="font-medium">{healthData.inventory.totalUnits.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Value at Cost</span>
                  <span className="font-medium">{formatCurrency(healthData.inventory.valueAtCost)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Value at Retail</span>
                  <span className="font-medium">{formatCurrency(healthData.inventory.valueAtRetail)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Potential Profit</span>
                  <span className="font-medium text-green-500">{formatCurrency(healthData.inventory.potentialProfit)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Turnover Ratio</span>
                  <span className="font-medium">{healthData.inventory.turnoverRatio.toFixed(2)}x</span>
                </div>
              </div>
            </Card>
            <Card className="p-6">
              <h4 className="font-medium mb-4">Cash Flow</h4>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span>Cash Inflows</span>
                  <span className="font-medium text-green-500">{formatCurrency(healthData.cashFlow.inflows)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Cash Outflows</span>
                  <span className="font-medium text-red-500">{formatCurrency(healthData.cashFlow.outflows)}</span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="font-semibold">Net Cash Flow</span>
                  <span className={`font-bold ${healthData.cashFlow.netCashFlow >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {formatCurrency(healthData.cashFlow.netCashFlow)}
                  </span>
                </div>
                <div className="mt-4 p-3 bg-muted rounded">
                  <p className="text-sm">
                    <span className="font-medium">Break-even Progress: </span>
                    {healthData.kpis.breakEvenProgress}%
                  </p>
                  <div className="w-full bg-background rounded-full h-2 mt-2">
                    <div
                      className={`h-2 rounded-full ${healthData.kpis.breakEvenProgress >= 100 ? 'bg-green-500' : 'bg-blue-500'}`}
                      style={{ width: `${Math.min(healthData.kpis.breakEvenProgress, 100)}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Inventory Predictions Tab */}
      {activeTab === 'predictions' && inventoryPredictions && (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Brain className="w-5 h-5 text-purple-500" />
              AI Inventory Predictions
            </h3>
            <p className="text-sm text-muted-foreground">
              Smart reorder recommendations based on sales velocity, lead times, and stock levels
            </p>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <Card className="p-4 border-l-4 border-l-red-500">
              <p className="text-sm text-muted-foreground">Critical</p>
              <p className="text-2xl font-bold text-red-500">{inventoryPredictions.summary.critical}</p>
              <p className="text-xs">Order immediately</p>
            </Card>
            <Card className="p-4 border-l-4 border-l-orange-500">
              <p className="text-sm text-muted-foreground">Needs Reorder</p>
              <p className="text-2xl font-bold text-orange-500">{inventoryPredictions.summary.needsReorder}</p>
              <p className="text-xs">Order within this week</p>
            </Card>
            <Card className="p-4 border-l-4 border-l-yellow-500">
              <p className="text-sm text-muted-foreground">Overstock</p>
              <p className="text-2xl font-bold text-yellow-500">{inventoryPredictions.summary.overstock}</p>
              <p className="text-xs">Stop buying, run promos</p>
            </Card>
            <Card className="p-4 border-l-4 border-l-red-500/50">
              <p className="text-sm text-muted-foreground">Dead Stock</p>
              <p className="text-2xl font-bold text-red-500">{inventoryPredictions.summary.deadStock}</p>
              <p className="text-xs">No sales in 60+ days</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Inventory Value</p>
              <p className="text-2xl font-bold">{formatCurrency(inventoryPredictions.summary.totalInventoryValue)}</p>
              <p className="text-xs">Total at cost</p>
            </Card>
          </div>

          {/* AI Insights Summary */}
          {(() => {
            const deadStockValue = inventoryPredictions.deadStock.reduce((sum: number, d: any) => sum + d.value, 0);
            const overstockItems = inventoryPredictions.predictions.filter((p: any) => p.status === 'overstock');
            const overstockValue = overstockItems.reduce((sum: number, p: any) => sum + p.totalValue, 0);
            const criticalItems = inventoryPredictions.predictions.filter((p: any) => p.status === 'critical');
            const reorderCost = inventoryPredictions.autoOrderSuggestions.reduce((sum: number, s: any) => sum + s.estimatedCost, 0);
            const fastMovers = inventoryPredictions.predictions.filter((p: any) => p.dailyVelocity >= 1).sort((a: any, b: any) => b.dailyVelocity - a.dailyVelocity);
            const insights: string[] = [];

            if (deadStockValue > 0) insights.push(`${formatCurrency(deadStockValue)} tied up in dead stock — consider clearance sales or discontinuing these products`);
            if (overstockValue > 0) insights.push(`${formatCurrency(overstockValue)} in overstock across ${overstockItems.length} products — stop purchasing these until stock depletes`);
            if (criticalItems.length > 0) insights.push(`${criticalItems.length} products will run out before next delivery — place orders today`);
            if (reorderCost > 0) insights.push(`Estimated ${formatCurrency(reorderCost)} needed to restock critical and low-stock items`);
            if (fastMovers.length > 0) insights.push(`Top seller: ${fastMovers[0].name} at ${fastMovers[0].dailyVelocity} units/day — ensure consistent supply`);

            return insights.length > 0 ? (
              <Card className="p-4 bg-purple-500/5 border-purple-500/20">
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-500" />
                  AI Recommendations
                </h4>
                <ul className="space-y-1.5 text-sm">
                  {insights.map((insight, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Brain className="w-4 h-4 text-purple-500 mt-0.5 shrink-0" />
                      {insight}
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null;
          })()}

          {/* Buy More - Auto Order Suggestions */}
          {inventoryPredictions.autoOrderSuggestions.length > 0 && (
            <Card className="p-6 border-green-500/20">
              <h4 className="font-medium mb-1 flex items-center gap-2 text-green-500">
                <ArrowUpRight className="w-5 h-5" />
                Buy More — Restock These Products
              </h4>
              <p className="text-sm text-muted-foreground mb-4">
                These products are selling fast and need restocking based on velocity and lead time
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Current Stock</TableHead>
                    <TableHead>Recommended Order</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Est. Cost</TableHead>
                    <TableHead>Urgency</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inventoryPredictions.autoOrderSuggestions.map((item: any) => {
                    const prediction = inventoryPredictions.predictions.find((p: any) => p.id === item.productId);
                    return (
                      <TableRow key={item.productId}>
                        <TableCell className="font-medium">{item.productName}</TableCell>
                        <TableCell>{prediction?.currentStock ?? '—'} units</TableCell>
                        <TableCell className="font-bold text-green-500">{item.quantity} units</TableCell>
                        <TableCell>{item.supplier}</TableCell>
                        <TableCell>{formatCurrency(item.estimatedCost)}</TableCell>
                        <TableCell>
                          <Badge variant={item.urgency === 'critical' ? 'destructive' : 'warning'}>
                            {item.urgency === 'critical' ? 'Order Now' : 'Order Soon'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}

          {/* Stop Buying - Overstock & Dead Stock */}
          {(inventoryPredictions.predictions.filter((p: any) => p.status === 'overstock').length > 0 || inventoryPredictions.deadStock.length > 0) && (
            <Card className="p-6 border-red-500/20">
              <h4 className="font-medium mb-1 flex items-center gap-2 text-red-500">
                <ArrowDownRight className="w-5 h-5" />
                Stop Buying — Reduce These Products
              </h4>
              <p className="text-sm text-muted-foreground mb-4">
                These products are not selling well enough to justify current stock levels
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Stock</TableHead>
                    <TableHead>Sales/Day</TableHead>
                    <TableHead>Days to Sell</TableHead>
                    <TableHead>Capital Tied Up</TableHead>
                    <TableHead>Recommendation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    ...inventoryPredictions.deadStock.map((d: any) => ({
                      ...d,
                      status: 'dead',
                      dailyVelocity: 0,
                      daysOfStock: 999,
                      totalValue: d.value,
                      action: 'Clearance sale or discontinue — no sales in 60+ days',
                    })),
                    ...inventoryPredictions.predictions.filter((p: any) => p.status === 'overstock'),
                  ].map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Badge variant={item.status === 'dead' ? 'destructive' : 'warning'}>
                          {item.status === 'dead' ? 'Dead Stock' : 'Overstock'}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>{item.stock ?? item.currentStock} units</TableCell>
                      <TableCell>{item.dailyVelocity?.toFixed(1) ?? '0'} /day</TableCell>
                      <TableCell>{item.daysOfStock === 999 ? 'Never' : `${item.daysOfStock} days`}</TableCell>
                      <TableCell className="font-medium text-red-500">{formatCurrency(item.totalValue ?? item.value)}</TableCell>
                      <TableCell className="text-sm max-w-xs">
                        {item.action}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}

          {/* All Predictions Table */}
          <Card>
            <div className="p-4 border-b">
              <h4 className="font-medium">Complete Inventory Analysis</h4>
              <p className="text-sm text-muted-foreground">All products sorted by urgency</p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Velocity</TableHead>
                  <TableHead>Days Left</TableHead>
                  <TableHead>Reorder Point</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inventoryPredictions.predictions.slice(0, 20).map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Badge variant={
                        item.status === 'critical' ? 'destructive' :
                        item.status === 'reorder' ? 'warning' :
                        item.status === 'overstock' ? 'secondary' : 'default'
                      }>
                        {item.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.sku} · {item.category}</p>
                    </TableCell>
                    <TableCell>{item.currentStock}</TableCell>
                    <TableCell>{item.dailyVelocity.toFixed(1)} /day</TableCell>
                    <TableCell className={item.daysOfStock <= 7 ? 'text-red-500 font-bold' : ''}>
                      {item.daysOfStock === 999 ? '∞' : `${item.daysOfStock}d`}
                    </TableCell>
                    <TableCell>{item.reorderPoint}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs">
                      {item.action}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* Anomalies Detection Tab */}
      {activeTab === 'anomalies' && anomaliesData && (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Zap className="w-5 h-5 text-yellow-500" />
              Sales Anomaly Detection
            </h3>
            <p className="text-sm text-muted-foreground">
              Unusual patterns in your sales data
            </p>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Daily Anomalies</p>
              <p className="text-2xl font-bold">{anomaliesData.summary.dailyAnomalies}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Product Anomalies</p>
              <p className="text-2xl font-bold">{anomaliesData.summary.productAnomalies}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Avg Daily Revenue</p>
              <p className="text-2xl font-bold">{formatCurrency(anomaliesData.summary.avgDailyRevenue)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Std Deviation</p>
              <p className="text-2xl font-bold">{formatCurrency(anomaliesData.summary.revenueStdDev)}</p>
            </Card>
          </div>

          {/* Insights */}
          {anomaliesData.insights.length > 0 && (
            <Card className="p-4 bg-blue-500/5">
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Key Insights
              </h4>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {anomaliesData.insights.map((insight: string, i: number) => (
                  <li key={i}>{insight}</li>
                ))}
              </ul>
            </Card>
          )}

          {/* Daily Anomalies */}
          {anomaliesData.dailyAnomalies.length > 0 && (
            <Card className="p-6">
              <h4 className="font-medium mb-4">Daily Revenue Anomalies</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Revenue</TableHead>
                    <TableHead>Expected</TableHead>
                    <TableHead>Deviation</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Severity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {anomaliesData.dailyAnomalies.map((anomaly: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell>{anomaly.date}</TableCell>
                      <TableCell className="font-medium">{formatCurrency(anomaly.revenue)}</TableCell>
                      <TableCell>{formatCurrency(anomaly.expected)}</TableCell>
                      <TableCell className={anomaly.deviation > 0 ? 'text-green-500' : 'text-red-500'}>
                        {anomaly.deviation > 0 ? '+' : ''}{formatCurrency(anomaly.deviation)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={anomaly.type === 'spike' ? 'success' : 'destructive'}>
                          {anomaly.type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={anomaly.severity === 'high' ? 'destructive' : 'warning'}>
                          {anomaly.severity}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}

          {/* Product Anomalies */}
          {anomaliesData.productAnomalies.length > 0 && (
            <Card className="p-6">
              <h4 className="font-medium mb-4">Product Demand Anomalies</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Last Qty</TableHead>
                    <TableHead>Avg Qty</TableHead>
                    <TableHead>Z-Score</TableHead>
                    <TableHead>Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {anomaliesData.productAnomalies.map((anomaly: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{anomaly.productName}</TableCell>
                      <TableCell>{anomaly.lastQuantity}</TableCell>
                      <TableCell>{anomaly.avgQuantity}</TableCell>
                      <TableCell>{anomaly.zScore}</TableCell>
                      <TableCell>
                        <Badge variant={anomaly.type === 'surge' ? 'success' : 'destructive'}>
                          {anomaly.type}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </div>
      )}

      {/* Bundle Recommendations Tab */}
      {activeTab === 'bundles' && bundlesData && (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Gift className="w-5 h-5 text-pink-500" />
              Bundle Recommendations
            </h3>
            <p className="text-sm text-muted-foreground">
              Products frequently bought together - create bundle deals!
            </p>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Bundles Found</p>
              <p className="text-2xl font-bold">{bundlesData.summary.totalBundlesFound}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Avg Lift</p>
              <p className="text-2xl font-bold">{bundlesData.summary.avgLift}x</p>
              <p className="text-xs text-muted-foreground">Higher = stronger association</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Potential Revenue</p>
              <p className="text-2xl font-bold">{formatCurrency(bundlesData.summary.potentialRevenue)}</p>
            </Card>
          </div>

          {/* Insights */}
          {bundlesData.insights.length > 0 && (
            <Card className="p-4 bg-pink-500/5">
              <ul className="space-y-1 text-sm">
                {bundlesData.insights.map((insight: string, i: number) => (
                  <li key={i} className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-pink-500" />
                    {insight}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Bundle Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {bundlesData.recommendations.map((bundle: any, i: number) => (
              <Card key={i} className="p-4">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <Badge variant="secondary" className="mb-2">
                      Lift: {bundle.lift}x
                    </Badge>
                    <p className="text-sm text-muted-foreground">
                      Bought together {bundle.coOccurrences} times
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-green-500">
                      {formatCurrency(bundle.suggestedBundlePrice)}
                    </p>
                    <p className="text-xs text-muted-foreground line-through">
                      {formatCurrency(bundle.combinedPrice)}
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  {bundle.products.map((product: any) => (
                    <div key={product.id} className="flex justify-between text-sm">
                      <span>{product.name}</span>
                      <span className="text-muted-foreground">{formatCurrency(product.price)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t flex justify-between text-sm">
                  <span>Suggested Discount</span>
                  <span className="font-medium text-green-500">{bundle.suggestedDiscount}% off</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Bundle Margin</span>
                  <span className="font-medium">{formatCurrency(bundle.potentialMargin)}</span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Employee Performance Tab */}
      {activeTab === 'employees' && employeeData && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Trophy className="w-5 h-5 text-yellow-500" />
                Employee Leaderboard
              </h3>
              <p className="text-sm text-muted-foreground">
                Performance scores and gamification badges
              </p>
            </div>
            <select
              value={employeeDays}
              onChange={(e) => {
                setEmployeeDays(e.target.value);
                setTimeout(fetchEmployeePerformance, 100);
              }}
              className="px-3 py-2 border border-input rounded-md bg-background text-foreground"
            >
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </div>

          {/* Team Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Total Revenue</p>
              <p className="text-2xl font-bold">{formatCurrency(employeeData.teamStats.totalRevenue)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Total Transactions</p>
              <p className="text-2xl font-bold">{employeeData.teamStats.totalTransactions}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Avg Score</p>
              <p className="text-2xl font-bold">{employeeData.teamStats.avgScore}/100</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Top Performer</p>
              <p className="text-2xl font-bold">{employeeData.teamStats.topPerformer}</p>
            </Card>
          </div>

          {/* Scoring Weights */}
          <Card className="p-4">
            <h4 className="font-medium mb-2">Scoring Weights</h4>
            <div className="flex gap-4 text-sm">
              <span>Revenue: {employeeData.scoringWeights.revenue}</span>
              <span>Transactions: {employeeData.scoringWeights.transactions}</span>
              <span>Avg Transaction: {employeeData.scoringWeights.avgTransaction}</span>
              <span>Efficiency: {employeeData.scoringWeights.efficiency}</span>
              <span>Quality: {employeeData.scoringWeights.quality}</span>
            </div>
          </Card>

          {/* Leaderboard */}
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rank</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Revenue</TableHead>
                  <TableHead>Transactions</TableHead>
                  <TableHead>$/Hour</TableHead>
                  <TableHead>Badges</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employeeData.leaderboard.map((emp: any) => (
                  <TableRow key={emp.id}>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {emp.rank === 1 && <Medal className="w-5 h-5 text-yellow-500" />}
                        {emp.rank === 2 && <Medal className="w-5 h-5 text-muted-foreground" />}
                        {emp.rank === 3 && <Medal className="w-5 h-5 text-amber-500" />}
                        {emp.rank > 3 && <span className="w-5 text-center">{emp.rank}</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{emp.name}</p>
                      <p className="text-xs text-muted-foreground">{emp.role}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-bold">{emp.score}</span>
                        <div className="w-20 bg-muted rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${
                              emp.score >= 70 ? 'bg-green-500' :
                              emp.score >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                            }`}
                            style={{ width: `${emp.score}%` }}
                          ></div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{formatCurrency(emp.metrics.totalRevenue)}</TableCell>
                    <TableCell>{emp.metrics.totalSales}</TableCell>
                    <TableCell>{formatCurrency(emp.metrics.revenuePerHour)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {emp.badges.map((badge: string, i: number) => (
                          <Badge key={i} variant="secondary" className="text-xs">
                            {badge === 'Top Seller' && <Award className="w-3 h-3 mr-1" />}
                            {badge === 'Upsell Champion' && <TrendingUp className="w-3 h-3 mr-1" />}
                            {badge === 'Most Efficient' && <Zap className="w-3 h-3 mr-1" />}
                            {badge === 'Quality Star' && <Star className="w-3 h-3 mr-1" />}
                            {badge === 'High Volume' && <ShoppingBag className="w-3 h-3 mr-1" />}
                            {badge}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* What-If Analysis Tab */}
      {activeTab === 'whatif' && (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Calculator className="w-5 h-5 text-blue-500" />
              What-If Scenario Analysis
            </h3>
            <p className="text-sm text-muted-foreground">
              Model the impact of price, cost, and volume changes
            </p>
          </div>

          {/* Input Controls */}
          <Card className="p-6">
            <h4 className="font-medium mb-4">Adjust Parameters</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="text-sm font-medium">Price Change (%)</label>
                <input
                  type="range"
                  min="-50"
                  max="50"
                  value={whatIfInputs.priceChange}
                  onChange={(e) => setWhatIfInputs(prev => ({ ...prev, priceChange: parseInt(e.target.value) }))}
                  className="w-full mt-2"
                />
                <div className="flex justify-between text-sm mt-1">
                  <span>-50%</span>
                  <span className={`font-bold ${whatIfInputs.priceChange > 0 ? 'text-green-500' : whatIfInputs.priceChange < 0 ? 'text-red-500' : ''}`}>
                    {whatIfInputs.priceChange > 0 ? '+' : ''}{whatIfInputs.priceChange}%
                  </span>
                  <span>+50%</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Cost Change (%)</label>
                <input
                  type="range"
                  min="-50"
                  max="50"
                  value={whatIfInputs.costChange}
                  onChange={(e) => setWhatIfInputs(prev => ({ ...prev, costChange: parseInt(e.target.value) }))}
                  className="w-full mt-2"
                />
                <div className="flex justify-between text-sm mt-1">
                  <span>-50%</span>
                  <span className={`font-bold ${whatIfInputs.costChange < 0 ? 'text-green-500' : whatIfInputs.costChange > 0 ? 'text-red-500' : ''}`}>
                    {whatIfInputs.costChange > 0 ? '+' : ''}{whatIfInputs.costChange}%
                  </span>
                  <span>+50%</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Volume Change (%)</label>
                <input
                  type="range"
                  min="-50"
                  max="50"
                  value={whatIfInputs.volumeChange}
                  onChange={(e) => setWhatIfInputs(prev => ({ ...prev, volumeChange: parseInt(e.target.value) }))}
                  className="w-full mt-2"
                />
                <div className="flex justify-between text-sm mt-1">
                  <span>-50%</span>
                  <span className={`font-bold ${whatIfInputs.volumeChange > 0 ? 'text-green-500' : whatIfInputs.volumeChange < 0 ? 'text-red-500' : ''}`}>
                    {whatIfInputs.volumeChange > 0 ? '+' : ''}{whatIfInputs.volumeChange}%
                  </span>
                  <span>+50%</span>
                </div>
              </div>
            </div>
            <Button className="mt-4" onClick={fetchWhatIfAnalysis}>
              <Calculator className="w-4 h-4 mr-2" />
              Calculate Impact
            </Button>
          </Card>

          {/* Results */}
          {whatIfData && (
            <>
              {/* Comparison Table */}
              <Card className="p-6">
                <h4 className="font-medium mb-4">Projected Impact</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-2">Current</p>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span>Revenue</span>
                        <span className="font-medium">{formatCurrency(whatIfData.scenarios.current.revenue)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Transactions</span>
                        <span className="font-medium">{whatIfData.scenarios.current.transactions}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Profit</span>
                        <span className="font-medium">{formatCurrency(whatIfData.scenarios.current.profit)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Margin</span>
                        <span className="font-medium">{whatIfData.scenarios.current.margin.toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-blue-500 mb-2">Projected</p>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span>Revenue</span>
                        <span className="font-medium">{formatCurrency(whatIfData.scenarios.projected.revenue)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Transactions</span>
                        <span className="font-medium">{whatIfData.scenarios.projected.transactions}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Profit</span>
                        <span className="font-medium">{formatCurrency(whatIfData.scenarios.projected.profit)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Margin</span>
                        <span className="font-medium">{whatIfData.scenarios.projected.margin.toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">Difference</p>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span>Revenue</span>
                        <span className={`font-medium ${whatIfData.scenarios.difference.revenue >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {whatIfData.scenarios.difference.revenue >= 0 ? '+' : ''}{formatCurrency(whatIfData.scenarios.difference.revenue)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Transactions</span>
                        <span className={`font-medium ${whatIfData.scenarios.difference.transactions >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {whatIfData.scenarios.difference.transactions >= 0 ? '+' : ''}{whatIfData.scenarios.difference.transactions}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Profit</span>
                        <span className={`font-medium ${whatIfData.scenarios.difference.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {whatIfData.scenarios.difference.profit >= 0 ? '+' : ''}{formatCurrency(whatIfData.scenarios.difference.profit)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Margin</span>
                        <span className={`font-medium ${whatIfData.scenarios.difference.margin >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {whatIfData.scenarios.difference.margin >= 0 ? '+' : ''}{whatIfData.scenarios.difference.margin.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Insights */}
              {whatIfData.insights.length > 0 && (
                <Card className="p-4 bg-blue-500/5">
                  <h4 className="font-medium mb-2">Analysis Insights</h4>
                  <ul className="space-y-1 text-sm">
                    {whatIfData.insights.map((insight: string, i: number) => (
                      <li key={i} className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-blue-500" />
                        {insight}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default Analytics;