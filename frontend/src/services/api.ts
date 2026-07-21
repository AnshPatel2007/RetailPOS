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
 * Response interceptor — attempt token refresh on 401 before logging out
 */
let isRefreshing = false;
let failedQueue: { resolve: (v: any) => void; reject: (e: any) => void }[] = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((p) => {
    if (error) p.reject(error);
    else p.resolve(token);
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as any;
    const isLoginRequest = originalRequest?.url?.includes('/auth/login');
    const isRefreshRequest = originalRequest?.url?.includes('/auth/refresh');

    if (error.response?.status === 401 && !isLoginRequest && !isRefreshRequest && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { data } = await api.post('/auth/refresh', {}, { withCredentials: true });
        const newToken = data.data?.token || data.token;
        if (newToken) {
          localStorage.setItem('token', newToken);
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          processQueue(null, newToken);
          return api(originalRequest);
        }
      } catch {
        processQueue(error, null);
      } finally {
        isRefreshing = false;
      }

      // Refresh failed — log out. Dynamic import avoids a circular
      // dependency (session.ts's stores import this file for API calls).
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      try {
        const { clearSessionState } = await import('./session');
        await clearSessionState();
      } catch {
        // Best-effort — still redirect to login even if this fails
      }
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

/**
 * Auth service
 */
export const authService = {
  login: (email: string, password: string, twoFactorCode?: string) =>
    api.post('/auth/login', { email, password, ...(twoFactorCode ? { twoFactorCode } : {}) }),

  logout: () => api.post('/auth/logout'),

  getMe: () => api.get('/auth/me'),

  register: (data: any) => api.post('/auth/register', data),

  // Sending an email can be slow to fail (SMTP connection issues); bound it
  // client-side too so the UI never appears to hang indefinitely.
  forgotPassword: (email: string) =>
    api.post('/auth/forgot-password', { email }, { timeout: 20000 }),

  resetPassword: (token: string, password: string) =>
    api.post('/auth/reset-password', { token, password }, { timeout: 20000 }),
};

/**
 * Two-factor authentication service
 */
export const twoFactorService = {
  getStatus: () => api.get('/auth/2fa/status'),

  setup: () => api.post('/auth/2fa/setup'),

  verify: (code: string) => api.post('/auth/2fa/verify', { code }),

  disable: (password: string, code?: string) =>
    api.post('/auth/2fa/disable', { password, ...(code ? { code } : {}) }),

  regenerateBackupCodes: (password: string) =>
    api.post('/auth/2fa/backup-codes', { password }),
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

  getStats: () => api.get('/products/stats'),

  adjustInventory: (id: string, data: any) =>
    api.post(`/products/${id}/adjust-inventory`, data),

  identify: (data: { barcode?: string; image?: string; mediaType?: string }) =>
    api.post('/products/identify', data, { timeout: 60000 }),

  bulkUpdateStock: (updates: any[]) =>
    api.post('/products/bulk-update-stock', { updates }),

  bulkUpdatePrice: (productIds: string[], priceUpdate?: number, costUpdate?: number) =>
    api.post('/products/bulk-update-price', { productIds, priceUpdate, costUpdate }),

  bulkUpdateCategory: (productIds: string[], categoryId: string) =>
    api.post('/products/bulk-update-category', { productIds, categoryId }),

  bulkToggleActive: (productIds: string[], isActive: boolean) =>
    api.post('/products/bulk-toggle-active', { productIds, isActive }),

  scanReceipt: (file: File) => {
    const formData = new FormData();
    formData.append('receipt', file);
    return api.post('/products/scan-receipt', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000, // 60s timeout for AI processing
    });
  },

  applyReceipt: (data: any) =>
    api.post('/products/apply-receipt', data),
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

  emailReceipt: (id: string, email: string) => api.post(`/sales/${id}/email-receipt`, { email }),
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

  previewCampaign: (segment: string) =>
    api.get('/customers/campaign/preview', { params: { segment } }),

  sendCampaign: (data: { segment: string; subject: string; message: string }) =>
    api.post('/customers/campaign', data, { timeout: 120000 }),
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

  cashMovement: (data: { type: string; amount: number; reason: string }) =>
    api.post('/shifts/cash-movement', data),

  getZReport: (id: string) => api.get(`/shifts/${id}/z-report`),
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

  getEmployeeSales: (params?: any) => api.get('/reports/employee-sales', { params }),

  getStockHealth: (params?: { days?: number }) => api.get('/reports/stock-health', { params }),

  sendDailyDigest: () => api.post('/reports/daily-digest/send'),

  exportScanDataCSV: (params: { startDate: string; endDate: string; categoryIds: string }) =>
    api.get('/reports/scan-data/export/csv', { params, responseType: 'blob' }),

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

  getSuggested: () => api.get('/purchase-orders/suggested'),
};

/**
 * Analytics service
 */
export const analyticsService = {
  getComparison: (params?: any) => api.get('/analytics/comparison', { params }),

  getABCAnalysis: (params?: any) => api.get('/analytics/abc-analysis', { params }),

  getProductMatrix: (params?: any) => api.get('/analytics/product-matrix', { params }),

  getForecast: (params?: any) => api.get('/analytics/forecast', { params }),

  getCustomerInsights: (params?: any) => api.get('/analytics/customer-insights', { params }),

  getRealtime: (params?: any) => api.get('/analytics/realtime', { params }),

  // New AI Analytics endpoints
  getInventoryPredictions: (params?: any) => api.get('/analytics/inventory-predictions', { params }),

  getAnomalies: (params?: any) => api.get('/analytics/anomalies', { params }),

  getBundleRecommendations: (params?: any) => api.get('/analytics/bundle-recommendations', { params }),

  getEmployeePerformance: (params?: any) => api.get('/analytics/employee-performance', { params }),

  getBusinessHealth: (params?: any) => api.get('/analytics/business-health', { params }),

  getWhatIfAnalysis: (data: { priceChange?: number; costChange?: number; volumeChange?: number; locationId?: string }) =>
    api.post('/analytics/what-if', data),

  chat: (data: { question: string; history?: { role: string; content: string }[] }) =>
    api.post('/analytics/chat', data, { timeout: 120000 }),
};

/**
 * Financial service
 */
export const financialService = {
  // Budgets
  getBudgets: (params?: any) => api.get('/financial/budgets', { params }),
  getBudgetSummary: (params?: any) => api.get('/financial/budgets/summary', { params }),
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
  getMySettings: (locationId?: string) => api.get('/locations/my-settings', { params: locationId ? { locationId } : {} }),
  updateMySettings: (data: any) => api.put('/locations/my-settings', data),
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
  getStats: () => api.get('/gift-cards/stats'),
  getById: (id: string) => api.get(`/gift-cards/${id}`),
  checkBalance: (code: string) => api.get(`/gift-cards/balance/${code}`),
  issue: (data: { amount: number; customerId?: string; expiresAt?: string }) =>
    api.post('/gift-cards', data),
  reload: (id: string, data: { amount: number }) => api.post(`/gift-cards/${id}/reload`, data),
  redeem: (id: string, data: { amount: number; saleId?: string }) => api.post(`/gift-cards/${id}/redeem`, data),
  deactivate: (id: string) => api.post(`/gift-cards/${id}/deactivate`),
};

/**
 * Store Credit service
 */
export const storeCreditService = {
  getAll: (params?: any) => api.get('/store-credit', { params }),
  getBalance: (customerId: string) => api.get(`/store-credit/${customerId}`),
  getTransactions: (customerId: string, params?: any) => api.get(`/store-credit/${customerId}/transactions`, { params }),
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

export const auditLogService = {
  getAll: (params?: any) => api.get('/audit-logs', { params }),
  getActions: () => api.get('/audit-logs/actions'),
  getEntities: () => api.get('/audit-logs/entities'),
};

/**
 * Developer service (API keys + webhooks, admin only)
 */
export const developerService = {
  listApiKeys: () => api.get('/developer/api-keys'),
  createApiKey: (name: string) => api.post('/developer/api-keys', { name }),
  revokeApiKey: (id: string) => api.delete(`/developer/api-keys/${id}`),

  listWebhooks: () => api.get('/developer/webhooks'),
  createWebhook: (data: { url: string; events: string[] }) => api.post('/developer/webhooks', data),
  updateWebhook: (id: string, data: { url?: string; events?: string[]; isActive?: boolean }) =>
    api.put(`/developer/webhooks/${id}`, data),
  deleteWebhook: (id: string) => api.delete(`/developer/webhooks/${id}`),
  testWebhook: (id: string) => api.post(`/developer/webhooks/${id}/test`),
};

/**
 * House Account service (charge-to-account / AR)
 */
export const houseAccountService = {
  getAll: (params?: any) => api.get('/house-accounts', { params }),
  create: (data: { customerId: string; creditLimit: number }) => api.post('/house-accounts', data),
  update: (id: string, data: { creditLimit?: number; isActive?: boolean }) =>
    api.put(`/house-accounts/${id}`, data),
  recordPayment: (id: string, data: { amount: number; notes?: string }) =>
    api.post(`/house-accounts/${id}/payment`, data),
  getTransactions: (id: string) => api.get(`/house-accounts/${id}/transactions`),
  emailStatement: (id: string) => api.post(`/house-accounts/${id}/statement`),
};

/**
 * Promotion service
 */
export const promotionService = {
  getAll: (params?: any) => api.get('/promotions', { params }),
  getActive: () => api.get('/promotions/active'),
  getById: (id: string) => api.get(`/promotions/${id}`),
  create: (data: any) => api.post('/promotions', data),
  update: (id: string, data: any) => api.put(`/promotions/${id}`, data),
  toggle: (id: string) => api.post(`/promotions/${id}/toggle`),
  delete: (id: string) => api.delete(`/promotions/${id}`),
};
