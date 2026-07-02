/**
 * Type definitions for the POS system frontend
 */

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'CASHIER';
  isActive: boolean;
  locationId: string | null;
  location?: Location;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface Location {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  phone: string;
  email: string;
  taxRate: number;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  category?: Category;
  cost: number;
  price: number;
  compareAtPrice: number | null;
  trackInventory: boolean;
  stockQuantity: number;
  lowStockAlert: number;
  barcode: string | null;
  image: string | null;
  isActive: boolean;
  isTaxable: boolean;
  allowBackorder: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  isActive: boolean;
}

export interface Customer {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  loyaltyPoints: number;
  totalSpent: number;
  visitCount: number;
  lastVisitAt: string | null;
  createdAt: string;
  isActive: boolean;
  emailMarketing?: boolean;
  smsMarketing?: boolean;
}

export interface Sale {
  id: string;
  saleNumber: string;
  customerId: string | null;
  customer?: Customer;
  userId: string;
  user?: {
    id: string;
    firstName: string;
    lastName: string;
  };
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paymentMethod: 'CASH' | 'CARD' | 'GIFT_CARD' | 'STORE_CREDIT' | 'OTHER';
  amountPaid: number;
  changeDue: number;
  status: 'COMPLETED' | 'PENDING' | 'REFUNDED' | 'VOIDED' | 'HOLD';
  items: SaleItem[];
  createdAt: string;
  completedAt: string | null;
}

export interface SaleItem {
  id: string;
  productId: string;
  product?: Product;
  sku: string;
  productName: string;
  quantity: number;
  price: number;
  discount: number;
  tax: number;
  total: number;
  notes: string | null;
}

export interface CartItem {
  product: Product;
  quantity: number;
  discount: number;
  notes: string;
}

export interface Shift {
  id: string;
  userId: string;
  user?: {
    firstName: string;
    lastName: string;
  };
  clockInAt: string;
  clockOutAt: string | null;
  startingCash: number;
  endingCash: number | null;
  expectedCash: number | null;
  cashDifference: number | null;
  totalSales: number;
  totalTransactions: number;
  isClosed: boolean;
}

export interface DashboardMetrics {
  todaySales: number;
  todayTransactions: number;
  todayTrend: number | null;
  weekSales: number;
  weekTrend: number | null;
  monthSales: number;
  monthTrend: number | null;
  averageOrderValue: number | null;
  todayRefunds: number;
  todayRefundCount: number;
  lowStockCount: number;
  lowStockItems: { id: string; name: string; sku: string; stock: number; alert: number }[];
  totalProducts: number;
  totalCustomers: number;
  activeEmployees: number;
  recentSales: { id: string; saleNumber: string; total: number; paymentMethod: string; createdAt: string; customerName: string | null }[];
  paymentBreakdown: { method: string; total: number; count: number }[];
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ============================================
// EXPENSE TYPES
// ============================================

export enum ExpenseCategory {
  UTILITIES = 'UTILITIES',
  RENT = 'RENT',
  PAYROLL = 'PAYROLL',
  SUPPLIES = 'SUPPLIES',
  INVENTORY_PURCHASE = 'INVENTORY_PURCHASE',
  MARKETING = 'MARKETING',
  MAINTENANCE = 'MAINTENANCE',
  INSURANCE = 'INSURANCE',
  TAXES = 'TAXES',
  SHIPPING = 'SHIPPING',
  SOFTWARE = 'SOFTWARE',
  EQUIPMENT = 'EQUIPMENT',
  OTHER = 'OTHER',
}

export enum ExpenseStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  PAID = 'PAID',
  REJECTED = 'REJECTED',
}

export interface Expense {
  id: string;
  expenseNumber: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  status: ExpenseStatus;
  vendor?: string;
  receiptUrl?: string;
  invoiceNumber?: string;
  expenseDate: string;
  dueDate?: string;
  paidDate?: string;
  locationId?: string;
  userId: string;
  user?: {
    firstName: string;
    lastName: string;
  };
  location?: {
    name: string;
  };
  approvedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseReportData {
  expenses: Expense[];
  summary: {
    totalExpenses: number;
    pendingExpenses: number;
    paidExpenses: number;
    byCategory: {
      category: string;
      count: number;
      total: number;
      percentage: number;
    }[];
    topCategory: string;
    avgDailyExpense: number;
  };
}

// ============================================
// SALES REPORT TYPES
// ============================================

export interface SalesFilters {
  paymentMethod: string[];
  status: string[];
  employeeId: string[];
  customerId: string;
  startDate: string;
  endDate: string;
  minAmount: string;
  maxAmount: string;
}

export interface SalesReportData {
  sales: Sale[];
  summary: {
    totalSales: number;
    totalTransactions: number;
    averageOrderValue: number;
    totalTax: number;
    totalDiscount: number;
  };
  paymentBreakdown: {
    [method: string]: {
      count: number;
      total: number;
    };
  };
  employeeBreakdown: {
    [employeeId: string]: {
      name: string;
      count: number;
      total: number;
    };
  };
}

// ============================================
// INVENTORY REPORT TYPES
// ============================================

export interface InventoryFilters {
  category: string[];
  stockStatus: string[];
  minPrice: string;
  maxPrice: string;
  trackInventory: boolean | null;
  isActive: boolean | null;
}

export interface InventoryReportData {
  products: Product[];
  summary: {
    totalProducts: number;
    totalInventoryValue: number;
    totalRetailValue: number;
    potentialProfit: number;
    lowStockCount: number;
  };
}

// ============================================
// EMPLOYEE PERFORMANCE TYPES
// ============================================

export interface EmployeePerformance {
  id: string;
  name: string;
  role: string;
  totalSales: number;
  totalTransactions: number;
  totalHoursWorked: number;
  totalCashDifference: number;
  averageOrderValue: number;
  salesPerHour: number;
  cashAccuracy: number;
  shiftCount: number;
  itemsSold: number;
}

export interface EmployeePerformanceData {
  performance: EmployeePerformance[];
  summary: {
    totalEmployees: number;
    totalSales: number;
    totalTransactions: number;
    totalHoursWorked: number;
  };
}

// ============================================
// BULK ACTION TYPES
// ============================================

export interface BulkStockUpdate {
  productId: string;
  quantity: number;
  type?: 'set' | 'add';
  notes?: string;
}
