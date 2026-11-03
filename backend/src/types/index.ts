import { Request } from 'express';
import { UserRole } from '@prisma/client';

// Extend Express Request to include authenticated user
export interface AuthRequest extends Request {
  sessionId?: string;
  user?: {
    id: string;
    email: string;
    role: UserRole;
    locationId: string | null;
  };
}

// JWT Payload
export interface JWTPayload {
  sessionId: string;
  userId: string;
  email: string;
  role: UserRole;
}

// API Response types
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

// Query parameters
export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
}

// Sale creation types
export interface CreateSaleItem {
  productId: string;
  quantity: number;
  price: number;
  discount?: number;
  notes?: string;
}

export interface CreateSaleData {
  customerId?: string;
  items: CreateSaleItem[];
  paymentMethod: string;
  amountPaid: number;
  notes?: string;
  receiptEmail?: string;
}

// Report types
export interface SalesReportParams {
  startDate?: string;
  endDate?: string;
  locationId?: string;
  userId?: string;
  groupBy?: 'day' | 'week' | 'month' | 'year';
}

export interface DashboardMetrics {
  todaySales: number;
  todayTransactions: number;
  weekSales: number;
  monthSales: number;
  lowStockProducts: number;
  totalCustomers: number;
  activeEmployees: number;
  averageOrderValue: number;
}

// Product types
export interface ProductFilters {
  categoryId?: string;
  isActive?: boolean;
  inStock?: boolean;
  lowStock?: boolean;
  search?: string;
}

// Customer types
export interface CustomerFilters {
  search?: string;
  hasEmail?: boolean;
  hasPhone?: boolean;
  minSpent?: number;
  minPoints?: number;
}
