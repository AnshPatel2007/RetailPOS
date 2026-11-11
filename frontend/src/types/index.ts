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
  twoFactorEnabled?: boolean;
  /** A register PIN is set (the PIN itself never reaches the browser). */
  hasPin?: boolean;
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
  timezone?: string;
}

export interface Product {
  /** Selling formats share one underlying inventory product. */
  inventoryProductId?: string;
  sellingUnitId?: string;
  unitsPerPackage?: number;
  baseStockQuantity?: number;
  looseStockQuantity?: number;
  baseUnitName?: string;
  sellingUnits?: ProductSellingUnit[];
  inventoryValue?: number | null;
  averageCost?: number | null;
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
  stockVersion: number;
  lowStockAlert: number;
  barcode: string | null;
  image: string | null;
  isActive: boolean;
  isTaxable: boolean;
  allowBackorder: boolean;
  /** Recall / prohibited-sale hold. Recorded stock never blocks a sale; this does. */
  saleBlockedReason?: string | null;
  provisionalUnitCost?: number | null;
  brand?: string | null;
  productFamily?: string | null;
  variant?: string | null;
  size?: string | null;
  minimumAge?: number | null;
  ebtEligible?: boolean;
  priceEmbedded?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductSellingUnit {
  id: string;
  productId: string;
  locationId: string;
  name: string;
  sku: string | null;
  barcode: string;
  price: number;
  unitsPerPackage: number;
  sealedQuantity: number;
  isActive: boolean;
  version: number;
}

export interface ProductPackaging {
  productId: string;
  baseUnitName: string;
  stockQuantity: number;
  looseStockQuantity: number;
  stockVersion: number;
  sellingUnits: ProductSellingUnit[];
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
  loyaltyTier?: string;
  totalSpent: number;
  visitCount: number;
  lastVisitAt: string | null;
  createdAt: string;
  isActive: boolean;
  emailMarketing?: boolean;
  smsMarketing?: boolean;
  tags?: string[];
  birthDate?: string | null;
}

export interface Sale {
  sourceType?: 'RECEIPT' | 'DAILY_SUMMARY';
  sourceData?: { businessDate?: string; register1Cents?: number | null; register2Cents?: number | null; cardCents?: number | null; lotteryNetCents?: number | null; sourceTitle?: string; caveats?: string[] } | null;
  voidEvent?: { id: string; createdAt: string; reason: string } | null;
  pricingVersion?: number | null;
  pointsEarned?: number | null;
  pointsRedeemed?: number | null;
  loyaltyDiscount?: number | string | null;
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

export type PromotionType = 'QUANTITY_PRICE' | 'BOGO' | 'PERCENT_OFF' | 'AMOUNT_OFF';

export interface Promotion {
  id: string;
  name: string;
  description: string | null;
  type: PromotionType;
  isActive: boolean;
  buyQuantity: number | null;
  getQuantity: number | null;
  bundlePrice: number | null;
  percentOff: number | null;
  amountOff: number | null;
  productIds: string[];
  categoryIds: string[];
  startsAt: string | null;
  endsAt: string | null;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  locationId: string | null;
  priority: number;
  timesUsed: number;
  createdAt: string;
  updatedAt: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
  discount: number;
  notes: string;
  priceOverride?: boolean;
}

export interface Shift {
  /** Blind close: this cashier counts the drawer before seeing what it should hold, so the cash figures are not sent. */
  blindClose?: boolean;
  cashRefunds?: number;
  cashGiftFunding?: number;
  cashHousePayments?: number;
  cashVoids?: number;
  reconciliationWarning?: string | null;
  drawerHistoryComplete?: boolean;
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
  period: { timezone: string; asOf: string; today: string; week: string; month: string; hourlyStart: string };
  historyWarning: string | null;
  productWarning: string | null;
  unallocatedProductTotal: number;
  hourlyData: { timestamp: number; total: number }[];
  topProducts: { productId: string; name: string; qty: number; revenue: number }[];
  activeShifts: { id: string; employeeName: string; clockInAt: string; totalSales: number; totalTransactions: number }[];
  todayVoids: number;
  todayVoidCount: number;
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
  recentSales: { id: string; status: string; saleNumber: string; total: number; paymentMethod: string; createdAt: string; customerName: string | null }[];
  paymentBreakdown: { method: string; total: number; count: number; percentage: number | null }[];
  /** Blind close: a cashier's own payment totals are withheld until their drawer is counted. */
  paymentBreakdownHidden?: boolean;
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
  inventoryReceiptId?: string | null;
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
    timezone?: string;
  };
  approvedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseReportData {
  expenses: Expense[];
  period: { timezone: string };
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
  employees: { id: string; firstName: string; lastName: string }[];
  entriesPartial: boolean;
  pagination: {
    sales: { page: number; pageSize: number; total: number; totalPages: number };
    refunds: { page: number; pageSize: number; total: number; totalPages: number };
    voids: { page: number; pageSize: number; total: number; totalPages: number };
    entries: { page: number; pageSize: number; total: number; totalPages: number };
    entryCount: number;
  };
  refunds: { id: string; createdAt: string; amount: number; taxAmount: number | null; method: string | null; tenders: { method: string; amount: number; reference?: string }[] | null; reason: string; sale: Sale }[];
  voids: { id: string; createdAt: string; amount: number; taxAmount: number; reason: string; sale: Sale }[];
  historyWarning?: string | null;
  entries: { sourceType?: string; storeDate?: string; id: string; saleNumber: string; kind: string; createdAt: string; employee: string; customer: string; method: string; total: number; tax: number | null }[];
  period: { timezone: string };
  summary: {
    totalSales: number;
    grossCollected: number;
    refunds: number;
    refundCount: number;
    voids: number;
    voidCount: number;
    netSales: number | null;
    totalTransactions: number | null;
    averageOrderValue: number | null;
    totalTax: number | null;
    totalDiscount: number | null;
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
