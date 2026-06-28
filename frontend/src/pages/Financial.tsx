import React, { useState, useEffect } from 'react';
import {
  DollarSign,
  PiggyBank,
  RefreshCw,
  FileText,
  Download,
  Plus,
  Trash2,
  Edit,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Search,
  Filter,
  Eye,
  ChevronDown,
  BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import {
  Table,
  TableBody,
  TableRow,
  TableHeader,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { financialService, expenseService, reportService } from '@/services/api';
import { formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import type { ExpenseReportData, Expense } from '@/types';
import { ExpenseModal } from '@/components/expenses/ExpenseModal';
import { ExpenseDetailsModal } from '@/components/expenses/ExpenseDetailsModal';
import { ExpenseFilters } from '@/components/expenses/ExpenseFilters';
import { BulkActionsToolbar } from '@/components/expenses/BulkActionsToolbar';
import { FilterDropdown } from '@/components/common/FilterDropdown';
import { BudgetModal } from '@/components/financial/BudgetModal';
import { RecurringExpenseModal } from '@/components/financial/RecurringExpenseModal';

// Helper to get local date in YYYY-MM-DD format
const getLocalDateString = (date: Date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const Financial: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'expenses' | 'budgets' | 'recurring' | 'pnl' | 'exports'>('expenses');
  const [loading, setLoading] = useState(true);

  // Data states
  const [expenseData, setExpenseData] = useState<ExpenseReportData | null>(null);
  const [budgets, setBudgets] = useState<any[]>([]);
  const [budgetSummary, setBudgetSummary] = useState<any>(null);
  const [recurringExpenses, setRecurringExpenses] = useState<any[]>([]);
  const [pnlData, setPnlData] = useState<any>(null);
  const [exportHistory, setExportHistory] = useState<any[]>([]);

  // Expense-specific state
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showExpenseDetails, setShowExpenseDetails] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>([]);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [expenseFilters, setExpenseFilters] = useState({
    category: [] as string[],
    status: [] as string[],
    startDate: getLocalDateString(new Date(new Date().setDate(new Date().getDate() - 30))),
    endDate: getLocalDateString(),
    minAmount: '',
    maxAmount: '',
    showCharts: false,
  });

  // Modal states for budgets/recurring
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const [editingBudget, setEditingBudget] = useState<any>(null);
  const [editingRecurring, setEditingRecurring] = useState<any>(null);

  useEffect(() => {
    fetchData();
  }, [activeTab, expenseFilters.startDate, expenseFilters.endDate]);

  const fetchData = async () => {
    setLoading(true);
    try {
      switch (activeTab) {
        case 'expenses':
          const expRes = await reportService.getExpenses({
            startDate: expenseFilters.startDate,
            endDate: expenseFilters.endDate,
          });
          setExpenseData(expRes.data.data);
          break;
        case 'budgets':
          const [budgetsRes, summaryRes] = await Promise.all([
            financialService.getBudgets(),
            financialService.getBudgetSummary(),
          ]);
          setBudgets(budgetsRes.data.data || []);
          setBudgetSummary(summaryRes.data.data);
          break;
        case 'recurring':
          const recRes = await financialService.getRecurringExpenses();
          setRecurringExpenses(recRes.data.data || []);
          break;
        case 'pnl':
          const pnlRes = await financialService.getProfitAndLoss();
          setPnlData(pnlRes.data.data);
          break;
        case 'exports':
          const expHistRes = await financialService.getExportHistory();
          setExportHistory(expHistRes.data.data || []);
          break;
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // Expense helper functions
  const handleExport = async (format: 'csv' | 'pdf') => {
    try {
      const params = {
        ...expenseFilters,
        category: expenseFilters.category.join(','),
        status: expenseFilters.status.join(','),
      };

      const response =
        format === 'csv'
          ? await expenseService.exportCSV(params)
          : await expenseService.exportPDF(params);

      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `expenses-export.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setShowExportMenu(false);
      toast.success(`Exported expenses as ${format.toUpperCase()}`);
    } catch (error) {
      console.error(`Failed to export ${format}:`, error);
      toast.error(`Failed to export ${format}`);
    }
  };

  const toggleExpenseSelection = (id: string) => {
    setSelectedExpenseIds((prev) =>
      prev.includes(id) ? prev.filter((expId) => expId !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedExpenseIds.length === filteredExpenses.length) {
      setSelectedExpenseIds([]);
    } else {
      setSelectedExpenseIds(filteredExpenses.map((exp) => exp.id));
    }
  };

  // Filter and search expenses
  const filteredExpenses = React.useMemo(() => {
    if (!expenseData?.expenses) return [];

    let filtered = [...expenseData.expenses];

    // Apply search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (exp) =>
          exp.expenseNumber.toLowerCase().includes(query) ||
          exp.description.toLowerCase().includes(query) ||
          exp.vendor?.toLowerCase().includes(query) ||
          exp.invoiceNumber?.toLowerCase().includes(query)
      );
    }

    // Apply filters
    if (expenseFilters.category.length > 0) {
      filtered = filtered.filter((exp) => expenseFilters.category.includes(exp.category));
    }
    if (expenseFilters.status.length > 0) {
      filtered = filtered.filter((exp) => expenseFilters.status.includes(exp.status));
    }
    if (expenseFilters.minAmount) {
      filtered = filtered.filter((exp) => exp.amount >= parseFloat(expenseFilters.minAmount));
    }
    if (expenseFilters.maxAmount) {
      filtered = filtered.filter((exp) => exp.amount <= parseFloat(expenseFilters.maxAmount));
    }

    return filtered;
  }, [expenseData?.expenses, searchQuery, expenseFilters]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value || 0);
  };

  const handleExportSales = async () => {
    try {
      const response = await financialService.exportSales();
      toast.success(`Exported ${response.data.data.recordCount} sales records`);
      fetchData();
    } catch (error) {
      toast.error('Failed to export sales');
    }
  };

  const handleExportExpenses = async () => {
    try {
      const response = await financialService.exportExpenses();
      toast.success(`Exported ${response.data.data.recordCount} expense records`);
      fetchData();
    } catch (error) {
      toast.error('Failed to export expenses');
    }
  };

  const handleGenerateRecurring = async () => {
    try {
      const response = await financialService.generateRecurringExpenses();
      toast.success(`Generated ${response.data.data.generated} expenses`);
      fetchData();
    } catch (error) {
      toast.error('Failed to generate recurring expenses');
    }
  };

  const handleDeleteBudget = async (id: string) => {
    if (!confirm('Are you sure you want to delete this budget?')) return;
    try {
      await financialService.deleteBudget(id);
      toast.success('Budget deleted');
      fetchData();
    } catch (error) {
      toast.error('Failed to delete budget');
    }
  };

  const handleDeleteRecurring = async (id: string) => {
    if (!confirm('Are you sure you want to delete this recurring expense?')) return;
    try {
      await financialService.deleteRecurringExpense(id);
      toast.success('Recurring expense deleted');
      fetchData();
    } catch (error) {
      toast.error('Failed to delete recurring expense');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <Badge variant="warning">Pending</Badge>;
      case 'APPROVED':
        return <Badge variant="success">Approved</Badge>;
      case 'PAID':
        return <Badge variant="default">Paid</Badge>;
      case 'REJECTED':
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Financial Management</h1>
          <p className="text-muted-foreground">
            Manage expenses, budgets, and financial reports
          </p>
        </div>
        <Button onClick={fetchData} variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-6">
        <Button
          variant={activeTab === 'expenses' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('expenses')}
          size="sm"
        >
          <DollarSign className="w-4 h-4 mr-2" />
          Expenses
        </Button>
        <Button
          variant={activeTab === 'budgets' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('budgets')}
          size="sm"
        >
          <PiggyBank className="w-4 h-4 mr-2" />
          Budgets
        </Button>
        <Button
          variant={activeTab === 'recurring' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('recurring')}
          size="sm"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Recurring
        </Button>
        <Button
          variant={activeTab === 'pnl' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('pnl')}
          size="sm"
        >
          <FileText className="w-4 h-4 mr-2" />
          P&L Report
        </Button>
        <Button
          variant={activeTab === 'exports' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('exports')}
          size="sm"
        >
          <Download className="w-4 h-4 mr-2" />
          Exports
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Expenses Tab */}
          {activeTab === 'expenses' && expenseData && (
            <>
              {/* Search & Filter Bar */}
              <div className="flex gap-2 mb-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Search by expense #, description, vendor, or invoice..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Button
                  variant={expenseFilters.showCharts ? 'default' : 'outline'}
                  onClick={() => setExpenseFilters({ ...expenseFilters, showCharts: !expenseFilters.showCharts })}
                  title="Toggle charts visualization"
                >
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Charts
                </Button>
                <div className="relative">
                  <Button
                    variant={showFilters ? 'default' : 'outline'}
                    onClick={() => setShowFilters(!showFilters)}
                  >
                    <Filter className="h-4 w-4 mr-2" />
                    Filters
                    {(expenseFilters.category.length > 0 || expenseFilters.status.length > 0) && (
                      <span className="ml-2 bg-primary-foreground text-primary rounded-full px-2 py-0.5 text-xs">
                        {expenseFilters.category.length + expenseFilters.status.length}
                      </span>
                    )}
                  </Button>

                  {/* Filters Dropdown */}
                  <FilterDropdown
                    isOpen={showFilters}
                    onClose={() => setShowFilters(false)}
                    title="Expense Filters"
                  >
                    <ExpenseFilters
                      filters={expenseFilters}
                      onFilterChange={setExpenseFilters}
                      onClear={() =>
                        setExpenseFilters({
                          category: [],
                          status: [],
                          startDate: getLocalDateString(new Date(new Date().setDate(new Date().getDate() - 30))),
                          endDate: getLocalDateString(),
                          minAmount: '',
                          maxAmount: '',
                          showCharts: false,
                        })
                      }
                    />
                  </FilterDropdown>
                </div>
                <Button variant="primary" onClick={() => setShowExpenseModal(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Expense
                </Button>
                <div className="relative">
                  <Button variant="outline" onClick={() => setShowExportMenu(!showExportMenu)}>
                    <Download className="h-4 w-4 mr-2" />
                    Export
                    <ChevronDown className="h-4 w-4 ml-1" />
                  </Button>
                  {showExportMenu && (
                    <div className="absolute right-0 mt-2 w-48 bg-background border rounded-md shadow-lg z-10">
                      <button
                        onClick={() => handleExport('csv')}
                        className="block w-full text-left px-4 py-2 hover:bg-accent"
                      >
                        Export as CSV
                      </button>
                      <button
                        onClick={() => handleExport('pdf')}
                        className="block w-full text-left px-4 py-2 hover:bg-accent"
                      >
                        Export as PDF
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Bulk Actions Toolbar */}
              <BulkActionsToolbar
                selectedIds={selectedExpenseIds}
                onClearSelection={() => setSelectedExpenseIds([])}
                onSuccess={fetchData}
              />

              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <Card>
                  <CardContent className="p-6">
                    <p className="text-sm text-muted-foreground mb-1">Total Expenses</p>
                    <p className="text-2xl font-bold text-destructive">
                      {formatCurrency(expenseData.summary?.totalExpenses || 0)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6">
                    <p className="text-sm text-muted-foreground mb-1">Pending</p>
                    <p className="text-2xl font-bold text-warning">
                      {formatCurrency(expenseData.summary?.pendingExpenses || 0)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6">
                    <p className="text-sm text-muted-foreground mb-1">Top Category</p>
                    <p className="text-2xl font-bold">
                      {expenseData.summary?.topCategory || 'N/A'}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6">
                    <p className="text-sm text-muted-foreground mb-1">Avg Daily</p>
                    <p className="text-2xl font-bold">
                      {formatCurrency(expenseData.summary?.avgDailyExpense || 0)}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Category Breakdown Chart */}
              {expenseFilters.showCharts && expenseData.summary?.byCategory && expenseData.summary.byCategory.length > 0 && (
                <Card className="mb-6">
                  <CardHeader>
                    <CardTitle>Expense by Category</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={expenseData.summary.byCategory}
                              dataKey="total"
                              nameKey="category"
                              cx="50%"
                              cy="50%"
                              outerRadius={100}
                              label={(entry) => `${entry.category}: ${entry.percentage.toFixed(1)}%`}
                            >
                              {expenseData.summary.byCategory.map((_entry, index) => (
                                <Cell
                                  key={`cell-${index}`}
                                  fill={`hsl(${(index * 360) / expenseData.summary.byCategory.length}, 70%, 50%)`}
                                />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value) => formatCurrency(value as number)} />
                            <Legend />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Category</TableHead>
                              <TableHead>Count</TableHead>
                              <TableHead className="text-right">Total</TableHead>
                              <TableHead className="text-right">%</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {expenseData.summary.byCategory.map((cat) => (
                              <TableRow key={cat.category}>
                                <TableCell className="font-medium">{cat.category}</TableCell>
                                <TableCell>{cat.count}</TableCell>
                                <TableCell className="text-right">
                                  {formatCurrency(cat.total)}
                                </TableCell>
                                <TableCell className="text-right">
                                  {cat.percentage.toFixed(1)}%
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Expenses Table */}
              <Card>
                <CardHeader>
                  <CardTitle>
                    {searchQuery || expenseFilters.category.length > 0 || expenseFilters.status.length > 0
                      ? `Filtered Expenses (${filteredExpenses.length})`
                      : 'All Expenses'}
                  </CardTitle>
                </CardHeader>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <input
                          type="checkbox"
                          checked={
                            filteredExpenses.length > 0 &&
                            selectedExpenseIds.length === filteredExpenses.length
                          }
                          onChange={toggleSelectAll}
                          className="cursor-pointer"
                        />
                      </TableHead>
                      <TableHead>Expense #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredExpenses.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                          No expenses found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredExpenses.slice(0, 50).map((expense) => (
                        <TableRow
                          key={expense.id}
                          className="cursor-pointer hover:bg-accent"
                          onClick={(e) => {
                            if (
                              (e.target as HTMLElement).tagName === 'INPUT' ||
                              (e.target as HTMLElement).closest('button')
                            ) {
                              return;
                            }
                            setSelectedExpense(expense);
                            setShowExpenseDetails(true);
                          }}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedExpenseIds.includes(expense.id)}
                              onChange={() => toggleExpenseSelection(expense.id)}
                              className="cursor-pointer"
                            />
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-sm">{expense.expenseNumber}</span>
                          </TableCell>
                          <TableCell>{formatDate(expense.expenseDate)}</TableCell>
                          <TableCell>
                            <span className="text-xs px-2 py-1 rounded bg-muted">
                              {expense.category.replace(/_/g, ' ')}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-xs truncate">{expense.description}</TableCell>
                          <TableCell>{expense.vendor || '-'}</TableCell>
                          <TableCell>{getStatusBadge(expense.status)}</TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(expense.amount)}
                          </TableCell>
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-end gap-1">
                              <button
                                onClick={() => {
                                  setSelectedExpense(expense);
                                  setShowExpenseDetails(true);
                                }}
                                className="p-1 hover:bg-accent rounded"
                                title="View details"
                              >
                                <Eye className="h-4 w-4" />
                              </button>
                              {expense.status === 'PENDING' && (
                                <button
                                  onClick={() => {
                                    setSelectedExpense(expense);
                                    setShowExpenseModal(true);
                                  }}
                                  className="p-1 hover:bg-accent rounded"
                                  title="Edit"
                                >
                                  <Edit className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </Card>

              {/* Modals */}
              <ExpenseModal
                isOpen={showExpenseModal}
                onClose={() => {
                  setShowExpenseModal(false);
                  setSelectedExpense(null);
                }}
                onSuccess={fetchData}
                expense={selectedExpense}
              />

              <ExpenseDetailsModal
                isOpen={showExpenseDetails}
                onClose={() => {
                  setShowExpenseDetails(false);
                  setSelectedExpense(null);
                }}
                expense={selectedExpense}
                onSuccess={fetchData}
                onEdit={(expense) => {
                  setSelectedExpense(expense);
                  setShowExpenseModal(true);
                }}
              />
            </>
          )}

          {/* Budgets Tab */}
          {activeTab === 'budgets' && (
            <div className="space-y-6">
              {/* Budget Summary */}
              {budgetSummary && (
                <div className="grid grid-cols-4 gap-4">
                  <Card className="p-4">
                    <p className="text-sm text-muted-foreground">Total Budgeted</p>
                    <p className="text-2xl font-bold">{formatCurrency(budgetSummary.totals.budgeted)}</p>
                  </Card>
                  <Card className="p-4">
                    <p className="text-sm text-muted-foreground">Total Spent</p>
                    <p className="text-2xl font-bold">{formatCurrency(budgetSummary.totals.spent)}</p>
                  </Card>
                  <Card className="p-4">
                    <p className="text-sm text-muted-foreground">Remaining</p>
                    <p className={`text-2xl font-bold ${budgetSummary.totals.remaining >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {formatCurrency(budgetSummary.totals.remaining)}
                    </p>
                  </Card>
                  <Card className="p-4">
                    <p className="text-sm text-muted-foreground">% Used</p>
                    <p className="text-2xl font-bold">{budgetSummary.totals.percentUsed}%</p>
                    <div className="w-full bg-muted rounded-full h-2 mt-2">
                      <div
                        className={`h-2 rounded-full ${
                          budgetSummary.totals.percentUsed > 100 ? 'bg-red-500' :
                          budgetSummary.totals.percentUsed > 80 ? 'bg-yellow-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${Math.min(budgetSummary.totals.percentUsed, 100)}%` }}
                      ></div>
                    </div>
                  </Card>
                </div>
              )}

              {/* Category Budgets */}
              {budgetSummary?.categories && budgetSummary.categories.length > 0 && (
                <Card className="p-6">
                  <h3 className="font-medium mb-4">Budget by Category</h3>
                  <div className="space-y-4">
                    {budgetSummary.categories.map((cat: any) => (
                      <div key={cat.category} className="flex items-center gap-4">
                        <div className="w-32 font-medium">{cat.category}</div>
                        <div className="flex-1">
                          <div className="flex justify-between text-sm mb-1">
                            <span>{formatCurrency(cat.spent)} / {formatCurrency(cat.budgeted)}</span>
                            <span>{cat.percentUsed}%</span>
                          </div>
                          <div className="w-full bg-muted rounded-full h-2">
                            <div
                              className={`h-2 rounded-full ${
                                cat.status === 'over' ? 'bg-red-500' :
                                cat.status === 'warning' ? 'bg-yellow-500' : 'bg-green-500'
                              }`}
                              style={{ width: `${Math.min(cat.percentUsed, 100)}%` }}
                            ></div>
                          </div>
                        </div>
                        {cat.status === 'over' && <AlertTriangle className="w-4 h-4 text-red-500" />}
                        {cat.status === 'warning' && <AlertTriangle className="w-4 h-4 text-yellow-500" />}
                        {cat.status === 'ok' && <CheckCircle className="w-4 h-4 text-green-500" />}
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* All Budgets Table */}
              <Card>
                <div className="p-4 border-b flex justify-between items-center">
                  <h3 className="font-medium">All Budgets</h3>
                  <Button size="sm" onClick={() => setShowBudgetModal(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Budget
                  </Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Budgeted</TableHead>
                      <TableHead>Spent</TableHead>
                      <TableHead>Remaining</TableHead>
                      <TableHead>% Used</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {budgets.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground">
                          No budgets set. Click "Add Budget" to create one.
                        </TableCell>
                      </TableRow>
                    ) : (
                      budgets.map((budget) => (
                        <TableRow key={budget.id}>
                          <TableCell>{budget.category}</TableCell>
                          <TableCell>{budget.period}</TableCell>
                          <TableCell>{formatCurrency(budget.amount)}</TableCell>
                          <TableCell>{formatCurrency(budget.spent)}</TableCell>
                          <TableCell className={budget.remaining >= 0 ? 'text-green-500' : 'text-red-500'}>
                            {formatCurrency(budget.remaining)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span>{budget.percentUsed}%</span>
                              {budget.isOverBudget && <AlertTriangle className="w-4 h-4 text-red-500" />}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditingBudget(budget);
                                  setShowBudgetModal(true);
                                }}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDeleteBudget(budget.id)}
                              >
                                <Trash2 className="w-4 h-4 text-red-500" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}

          {/* Recurring Expenses Tab */}
          {activeTab === 'recurring' && (
            <div className="space-y-6">
              <div className="flex justify-between">
                <Button onClick={handleGenerateRecurring} variant="outline">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Generate Due Expenses
                </Button>
                <Button onClick={() => setShowRecurringModal(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Recurring
                </Button>
              </div>

              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Frequency</TableHead>
                      <TableHead>Next Due</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recurringExpenses.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground">
                          No recurring expenses set up
                        </TableCell>
                      </TableRow>
                    ) : (
                      recurringExpenses.map((recurring) => (
                        <TableRow key={recurring.id}>
                          <TableCell>
                            <p className="font-medium">{recurring.description}</p>
                            {recurring.vendor && (
                              <p className="text-xs text-muted-foreground">{recurring.vendor}</p>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{recurring.category}</Badge>
                          </TableCell>
                          <TableCell className="font-medium">
                            {formatCurrency(recurring.amount)}
                          </TableCell>
                          <TableCell>{recurring.frequency}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Calendar className="w-4 h-4 text-muted-foreground" />
                              {new Date(recurring.nextDueDate).toLocaleDateString()}
                            </div>
                          </TableCell>
                          <TableCell>
                            {recurring.isActive ? (
                              <Badge variant="success">Active</Badge>
                            ) : (
                              <Badge variant="secondary">Inactive</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditingRecurring(recurring);
                                  setShowRecurringModal(true);
                                }}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDeleteRecurring(recurring.id)}
                              >
                                <Trash2 className="w-4 h-4 text-red-500" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}

          {/* P&L Report Tab */}
          {activeTab === 'pnl' && pnlData && (
            <div className="space-y-6">
              <Card className="p-6">
                <h3 className="font-medium mb-4">Profit & Loss Statement</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  Period: {new Date(pnlData.period.start).toLocaleDateString()} - {new Date(pnlData.period.end).toLocaleDateString()}
                </p>

                <div className="space-y-4">
                  {/* Revenue Section */}
                  <div className="border-b pb-4">
                    <h4 className="font-medium text-green-500 mb-2">Revenue</h4>
                    <div className="space-y-2 ml-4">
                      <div className="flex justify-between">
                        <span>Gross Sales</span>
                        <span>{formatCurrency(pnlData.revenue.grossSales)}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Less: Refunds</span>
                        <span>({formatCurrency(pnlData.revenue.refunds)})</span>
                      </div>
                      <div className="flex justify-between font-medium border-t pt-2">
                        <span>Net Sales</span>
                        <span>{formatCurrency(pnlData.revenue.netSales)}</span>
                      </div>
                    </div>
                  </div>

                  {/* COGS Section */}
                  <div className="border-b pb-4">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Cost of Goods Sold (Est.)</span>
                      <span>({formatCurrency(pnlData.costOfGoodsSold)})</span>
                    </div>
                    <div className="flex justify-between font-medium mt-2">
                      <span>Gross Profit</span>
                      <span className="text-green-500">{formatCurrency(pnlData.grossProfit)}</span>
                    </div>
                  </div>

                  {/* Operating Expenses */}
                  <div className="border-b pb-4">
                    <h4 className="font-medium text-red-500 mb-2">Operating Expenses</h4>
                    <div className="space-y-2 ml-4">
                      {pnlData.operatingExpenses.byCategory.map((exp: any) => (
                        <div key={exp.category} className="flex justify-between text-muted-foreground">
                          <span>{exp.category}</span>
                          <span>{formatCurrency(exp.amount)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between font-medium border-t pt-2">
                        <span>Total Operating Expenses</span>
                        <span>({formatCurrency(pnlData.operatingExpenses.total)})</span>
                      </div>
                    </div>
                  </div>

                  {/* Net Income */}
                  <div className="pt-2">
                    <div className="flex justify-between text-xl font-bold">
                      <span>Net Income</span>
                      <span className={pnlData.netIncome >= 0 ? 'text-green-500' : 'text-red-500'}>
                        {formatCurrency(pnlData.netIncome)}
                      </span>
                    </div>
                  </div>

                  {/* Margins */}
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                    <Card className="p-4">
                      <p className="text-sm text-muted-foreground">Gross Margin</p>
                      <p className="text-2xl font-bold">{pnlData.margins.gross}%</p>
                    </Card>
                    <Card className="p-4">
                      <p className="text-sm text-muted-foreground">Net Margin</p>
                      <p className="text-2xl font-bold">{pnlData.margins.net}%</p>
                    </Card>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {/* Exports Tab */}
          {activeTab === 'exports' && (
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
                          <TableCell>
                            {new Date(exp.createdAt).toLocaleString()}
                          </TableCell>
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
          )}
        </>
      )}

      {/* Budget Modal */}
      <BudgetModal
        isOpen={showBudgetModal}
        onClose={() => {
          setShowBudgetModal(false);
          setEditingBudget(null);
        }}
        onSuccess={fetchData}
        budget={editingBudget}
      />

      {/* Recurring Expense Modal */}
      <RecurringExpenseModal
        isOpen={showRecurringModal}
        onClose={() => {
          setShowRecurringModal(false);
          setEditingRecurring(null);
        }}
        onSuccess={fetchData}
        recurringExpense={editingRecurring}
      />
    </div>
  );
};

export default Financial;