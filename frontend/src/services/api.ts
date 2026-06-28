import axios, { AxiosInstance, AxiosError } from 'axios';

/**
 * API client configuration
 */
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

/**
 * Create axios instance
 */
export const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Request interceptor to add auth token
 */
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Response interceptor to handle errors
 */
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      // Don't interfere with login requests
      const isLoginRequest = error.config?.url?.includes('/auth/login');

      if (!isLoginRequest) {
        // Unauthorized - clear token and redirect to login
        localStorage.removeItem('token');
        localStorage.removeItem('user');

        // Avoid redundant redirects
        if (!window.location.pathname.includes('/login')) {
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

/**
 * Auth service
 */
export const authService = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),

  logout: () => api.post('/auth/logout'),

  getMe: () => api.get('/auth/me'),

  register: (data: any) => api.post('/auth/register', data),
};

/**
 * Product service
 */
export const productService = {
  getAll: (params?: any) => api.get('/products', { params }),

  getById: (id: string) => api.get(`/products/${id}`),

  create: (data: any) => api.post('/products', data),

  update: (id: string, data: any) => api.put(`/products/${id}`, data),

  delete: (id: string) => api.delete(`/products/${id}`),

  getLowStock: () => api.get('/products/low-stock'),

  adjustInventory: (id: string, data: any) =>
    api.post(`/products/${id}/adjust-inventory`, data),

  bulkUpdateStock: (updates: any[]) =>
    api.post('/products/bulk-update-stock', { updates }),

  bulkUpdatePrice: (productIds: string[], priceUpdate?: number, costUpdate?: number) =>
    api.post('/products/bulk-update-price', { productIds, priceUpdate, costUpdate }),

  bulkUpdateCategory: (productIds: string[], categoryId: string) =>
    api.post('/products/bulk-update-category', { productIds, categoryId }),

  bulkToggleActive: (productIds: string[], isActive: boolean) =>
    api.post('/products/bulk-toggle-active', { productIds, isActive }),
};

/**
 * Category service
 */
export const categoryService = {
  getAll: (params?: any) => api.get('/categories', { params }),

  getById: (id: string) => api.get(`/categories/${id}`),

  create: (data: any) => api.post('/categories', data),

  update: (id: string, data: any) => api.put(`/categories/${id}`, data),

  delete: (id: string) => api.delete(`/categories/${id}`),
};

/**
 * Sale service
 */
export const saleService = {
  getAll: (params?: any) => api.get('/sales', { params }),

  getById: (id: string) => api.get(`/sales/${id}`),

  create: (data: any) => api.post('/sales', data),

  refund: (id: string, data: any) => api.post(`/sales/${id}/refund`, data),

  void: (id: string) => api.post(`/sales/${id}/void`),

  bulkVoid: (saleIds: string[]) => api.post('/sales/bulk-void', { saleIds }),

  bulkRefund: (saleIds: string[]) => api.post('/sales/bulk-refund', { saleIds }),
};

/**
 * Customer service
 */
export const customerService = {
  getAll: (params?: any) => api.get('/customers', { params }),

  getById: (id: string) => api.get(`/customers/${id}`),

  create: (data: any) => api.post('/customers', data),

  update: (id: string, data: any) => api.put(`/customers/${id}`, data),

  delete: (id: string) => api.delete(`/customers/${id}`),

  getHistory: (id: string) => api.get(`/customers/${id}/history`),

  searchByPhone: (phone: string) => api.get('/customers/search/phone', { params: { phone } }),
};

/**
 * Shift service
 */
export const shiftService = {
  getAll: (params?: any) => api.get('/shifts', { params }),

  getCurrent: () => api.get('/shifts/current'),

  clockIn: (data: any) => api.post('/shifts/clock-in', data),

  clockOut: (data: any) => api.post('/shifts/clock-out', data),

  close: (id: string, data: any) => api.post(`/shifts/${id}/close`, data),

  getEmployeePerformance: (params?: any) => api.get('/shifts/employee-performance', { params }),
};

/**
 * Report service
 */
export const reportService = {
  getDashboard: () => api.get('/reports/dashboard'),
  getDashboardHourly: () => api.get('/reports/dashboard/hourly'),

  getOverall: (params?: any) => api.get('/reports/overall', { params }),

  getSales: (params?: any) => api.get('/reports/sales', { params }),

  getInventory: (params?: any) => api.get('/reports/inventory', { params }),

  getEmployees: (params?: any) => api.get('/reports/employees', { params }),

  getProducts: (params?: any) => api.get('/reports/products', { params }),

  getExpenses: (params?: any) => api.get('/reports/expenses', { params }),

  exportSalesCSV: (params?: any) => {
    return api.get('/reports/sales/export/csv', {
      params,
      responseType: 'blob',
    });
  },

  exportSalesPDF: (params?: any) => {
    return api.get('/reports/sales/export/pdf', {
      params,
      responseType: 'blob',
    });
  },

  exportInventoryCSV: (params?: any) => {
    return api.get('/reports/inventory/export/csv', {
      params,
      responseType: 'blob',
    });
  },

  exportInventoryPDF: (params?: any) => {
    return api.get('/reports/inventory/export/pdf', {
      params,
      responseType: 'blob',
    });
  },
};

/**
 * Expense service
 */
export const expenseService = {
  getAll: (params?: any) => api.get('/expenses', { params }),

  getById: (id: string) => api.get(`/expenses/${id}`),

  create: (data: any) => api.post('/expenses', data),

  update: (id: string, data: any) => api.put(`/expenses/${id}`, data),

  delete: (id: string) => api.delete(`/expenses/${id}`),

  approve: (id: string) => api.post(`/expenses/${id}/approve`),

  reject: (id: string) => api.post(`/expenses/${id}/reject`),

  uploadReceipt: (file: File) => {
    const formData = new FormData();
    formData.append('receipt', file);
    return api.post('/expenses/upload-receipt', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  bulkApprove: (expenseIds: string[]) =>
    api.post('/expenses/bulk-approve', { expenseIds }),

  bulkReject: (expenseIds: string[]) =>
    api.post('/expenses/bulk-reject', { expenseIds }),

  exportCSV: (params?: any) => {
    return api.get('/expenses/export/csv', {
      params,
      responseType: 'blob',
    });
  },

  exportPDF: (params?: any) => {
    return api.get('/expenses/export/pdf', {
      params,
      responseType: 'blob',
    });
  },
};

/**
 * Supplier service
 */
export const supplierService = {
  getAll: (params?: any) => api.get('/suppliers', { params }),

  getById: (id: string) => api.get(`/suppliers/${id}`),

  create: (data: any) => api.post('/suppliers', data),

  update: (id: string, data: any) => api.put(`/suppliers/${id}`, data),

  delete: (id: string) => api.delete(`/suppliers/${id}`),

  getPerformance: (id: string) => api.get(`/suppliers/${id}/performance`),

  linkProduct: (id: string, data: any) => api.post(`/suppliers/${id}/products`, data),

  updateProductLink: (id: string, productId: string, data: any) =>
    api.put(`/suppliers/${id}/products/${productId}`, data),

  unlinkProduct: (id: string, productId: string) =>
    api.delete(`/suppliers/${id}/products/${productId}`),
};

/**
 * Purchase Order service
 */
export const purchaseOrderService = {
  getAll: (params?: any) => api.get('/purchase-orders', { params }),

  getById: (id: string) => api.get(`/purchase-orders/${id}`),

  create: (data: any) => api.post('/purchase-orders', data),

  update: (id: string, data: any) => api.put(`/purchase-orders/${id}`, data),

  delete: (id: string) => api.delete(`/purchase-orders/${id}`),

  updateStatus: (id: string, status: string) =>
    api.post(`/purchase-orders/${id}/status`, { status }),

  receive: (id: string, receivedItems?: any[]) =>
    api.post(`/purchase-orders/${id}/receive`, { receivedItems }),

  cancel: (id: string, reason?: string) =>
    api.post(`/purchase-orders/${id}/cancel`, { reason }),

  autoGenerate: () => api.post('/purchase-orders/auto-generate'),
};

/**
 * Analytics service
 */
export const analyticsService = {
  getComparison: () => api.get('/analytics/comparison'),

  getABCAnalysis: (params?: any) => api.get('/analytics/abc-analysis', { params }),

  getProductMatrix: (params?: any) => api.get('/analytics/product-matrix', { params }),

  getForecast: (params?: any) => api.get('/analytics/forecast', { params }),

  getCustomerInsights: () => api.get('/analytics/customer-insights'),

  getRealtime: () => api.get('/analytics/realtime'),

  // New AI Analytics endpoints
  getInventoryPredictions: () => api.get('/analytics/inventory-predictions'),

  getAnomalies: () => api.get('/analytics/anomalies'),

  getBundleRecommendations: () => api.get('/analytics/bundle-recommendations'),

  getEmployeePerformance: (params?: any) => api.get('/analytics/employee-performance', { params }),

  getBusinessHealth: () => api.get('/analytics/business-health'),

  getWhatIfAnalysis: (data: { priceChange?: number; costChange?: number; volumeChange?: number }) =>
    api.post('/analytics/what-if', data),
};

/**
 * Financial service
 */
export const financialService = {
  // Budgets
  getBudgets: (params?: any) => api.get('/financial/budgets', { params }),
  getBudgetSummary: () => api.get('/financial/budgets/summary'),
  createBudget: (data: any) => api.post('/financial/budgets', data),
  updateBudget: (id: string, data: any) => api.put(`/financial/budgets/${id}`, data),
  deleteBudget: (id: string) => api.delete(`/financial/budgets/${id}`),

  // Recurring Expenses
  getRecurringExpenses: (params?: any) => api.get('/financial/recurring-expenses', { params }),
  createRecurringExpense: (data: any) => api.post('/financial/recurring-expenses', data),
  updateRecurringExpense: (id: string, data: any) => api.put(`/financial/recurring-expenses/${id}`, data),
  deleteRecurringExpense: (id: string) => api.delete(`/financial/recurring-expenses/${id}`),
  generateRecurringExpenses: () => api.post('/financial/recurring-expenses/generate'),

  // Accounting Exports
  getExportHistory: () => api.get('/financial/exports'),
  exportSales: (params?: any) => api.get('/financial/export/sales', { params }),
  exportExpenses: (params?: any) => api.get('/financial/export/expenses', { params }),
  getProfitAndLoss: (params?: any) => api.get('/financial/reports/pnl', { params }),
};

/**
 * Location service (Super Admin)
 */
export const locationService = {
  getAll: () => api.get('/locations'),
  getById: (id: string) => api.get(`/locations/${id}`),
  getStats: (id: string, period?: number) => api.get(`/locations/${id}/stats`, { params: { period } }),
  getCrossLocationStats: (period?: number) => api.get('/locations/stats/overview', { params: { period } }),
  create: (data: any) => api.post('/locations', data),
  update: (id: string, data: any) => api.put(`/locations/${id}`, data),
  delete: (id: string) => api.delete(`/locations/${id}`),
};

/**
 * User management service (Admin)
 */
export const userService = {
  getAll: (params?: any) => api.get('/users', { params }),
  getById: (id: string) => api.get(`/users/${id}`),
  getPerformance: (id: string, period?: number) => api.get(`/users/${id}/performance`, { params: { period } }),
  create: (data: any) => api.post('/users', data),
  update: (id: string, data: any) => api.put(`/users/${id}`, data),
  resetPassword: (id: string, newPassword: string) => api.post(`/users/${id}/reset-password`, { newPassword }),
  delete: (id: string) => api.delete(`/users/${id}`),

  // Current user profile management
  getProfile: () => api.get('/users/profile'),
  updateProfile: (data: { firstName: string; lastName: string; email: string }) =>
    api.put('/users/profile', data),
  changePassword: (data: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
    api.post('/users/change-password', data),
};

/**
 * Gift Card service
 */
export const giftCardService = {
  getAll: (params?: any) => api.get('/gift-cards', { params }),
  getById: (id: string) => api.get(`/gift-cards/${id}`),
  checkBalance: (code: string) => api.get(`/gift-cards/check/${code}`),
  issue: (data: any) => api.post('/gift-cards/issue', data),
  reload: (id: string, data: { amount: number }) => api.post(`/gift-cards/${id}/reload`, data),
  redeem: (id: string, data: { amount: number; saleId?: string }) => api.post(`/gift-cards/${id}/redeem`, data),
  deactivate: (id: string) => api.post(`/gift-cards/${id}/deactivate`),
};

/**
 * Store Credit service
 */
export const storeCreditService = {
  getBalance: (customerId: string) => api.get(`/store-credit/${customerId}`),
  addCredit: (customerId: string, data: { amount: number; notes?: string; saleId?: string }) =>
    api.post(`/store-credit/${customerId}/credit`, data),
  debit: (customerId: string, data: { amount: number; saleId?: string }) =>
    api.post(`/store-credit/${customerId}/debit`, data),
};

/**
 * Exchange / Return service
 */
export const exchangeService = {
  getAll: (params?: any) => api.get('/exchanges', { params }),
  getById: (id: string) => api.get(`/exchanges/${id}`),
  create: (data: any) => api.post('/exchanges', data),
};

/**
 * Inventory Transfer service
 */
export const inventoryTransferService = {
  getAll: (params?: any) => api.get('/inventory-transfers', { params }),
  getById: (id: string) => api.get(`/inventory-transfers/${id}`),
  create: (data: any) => api.post('/inventory-transfers', data),
  ship: (id: string) => api.post(`/inventory-transfers/${id}/ship`),
  receive: (id: string, data?: { receivedItems?: any[] }) =>
    api.post(`/inventory-transfers/${id}/receive`, data),
  cancel: (id: string) => api.post(`/inventory-transfers/${id}/cancel`),
};

/**
 * Cycle Count service
 */
export const cycleCountService = {
  getAll: (params?: any) => api.get('/cycle-counts', { params }),
  getById: (id: string) => api.get(`/cycle-counts/${id}`),
  create: (data: any) => api.post('/cycle-counts', data),
  updateItems: (id: string, items: any[]) => api.put(`/cycle-counts/${id}/items`, { items }),
  submit: (id: string) => api.post(`/cycle-counts/${id}/submit`),
  approve: (id: string) => api.post(`/cycle-counts/${id}/approve`),
  cancel: (id: string) => api.post(`/cycle-counts/${id}/cancel`),
};

/**
 * Lottery service
 */
export const lotteryService = {
  // Batches
  getBatches: (params?: any) => api.get('/lottery/batches', { params }),
  getBatchById: (id: string) => api.get(`/lottery/batches/${id}`),
  createBatch: (data: any) => api.post('/lottery/batches', data),
  updateBatch: (id: string, data: any) => api.put(`/lottery/batches/${id}`, data),
  deleteBatch: (id: string) => api.delete(`/lottery/batches/${id}`),

  // Transactions
  getTransactions: (params?: any) => api.get('/lottery/transactions', { params }),
  getTransactionById: (id: string) => api.get(`/lottery/transactions/${id}`),
  upsertTransaction: (data: any) => api.post('/lottery/transactions', data),
  closeTransaction: (id: string, data: any) => api.post(`/lottery/transactions/${id}/close`, data),

  // Scans
  scanTicket: (data: any) => api.post('/lottery/scan', data),
  getScans: (params?: any) => api.get('/lottery/scans', { params }),

  // Reports
  getDailySummary: (params?: any) => api.get('/lottery/reports/daily-summary', { params }),

  // Ticket Types
  getTicketTypes: (params?: any) => api.get('/lottery/ticket-types', { params }),
  getTicketTypeById: (id: string) => api.get(`/lottery/ticket-types/${id}`),
  createTicketType: (data: any) => api.post('/lottery/ticket-types', data),
  updateTicketType: (id: string, data: any) => api.put(`/lottery/ticket-types/${id}`, data),
  deleteTicketType: (id: string) => api.delete(`/lottery/ticket-types/${id}`),

  // Daily Entries
  getDailyEntries: (params?: any) => api.get('/lottery/daily-entries', { params }),
  createDailyEntry: (data: any) => api.post('/lottery/daily-entries', data),
  updateDailyEntry: (id: string, data: any) => api.put(`/lottery/daily-entries/${id}`, data),
  deleteDailyEntry: (id: string) => api.delete(`/lottery/daily-entries/${id}`),
  getCarryForwardInfo: (params?: any) => api.get('/lottery/daily-entries/carry-forward', { params }),

  // Day Status
  getDayStatus: (params?: any) => api.get('/lottery/day-status', { params }),
  updateDayStatusCashout: (id: string, data: any) => api.put(`/lottery/day-status/${id}`, data),
  closeDay: (data: any) => api.post('/lottery/day-status/close', data),
  reopenDay: (id: string, data: any) => api.post(`/lottery/day-status/${id}/reopen`, data),
};
