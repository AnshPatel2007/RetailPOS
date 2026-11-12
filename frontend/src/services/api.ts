import axios, { AxiosInstance, AxiosError, CanceledError } from 'axios';
import { sessionGeneration, changeSessionGeneration, signInSettled } from './sessionGeneration';
import { storeContextGeneration } from './storeContextGeneration';
import { invalidateScopedQueries } from './queryCache';
import { serverAnswered, serverDidNotAnswer, setServerCheck } from './connection';
import { rememberOpenShift } from './openShift';

/**
 * API client configuration
 */
const API_URL = import.meta.env.VITE_API_URL || '/api';

/**
 * Create axios instance
 */
export const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Request interceptor to add auth token
 */
api.interceptors.request.use(
  async (config) => {
    const request = config as typeof config & { _sessionGeneration?: number; _storeGeneration?: number };
    request._sessionGeneration ??= sessionGeneration();
    request._storeGeneration ??= storeContextGeneration();
    const token = localStorage.getItem('token');
    const { useAdminViewStore } = await import('../store/adminViewStore');
    const { useAuthStore } = await import('../store/authStore');
    if (request._storeGeneration !== storeContextGeneration()) throw new CanceledError('Store context changed');
    if (request._sessionGeneration !== sessionGeneration() || (useAuthStore.getState().isSigningOut && config.url !== '/auth/logout')) throw new CanceledError('Session changed');
    const view = useAdminViewStore.getState();
    const scopePath = /^\/(products|categories|sales|customers|shifts|reports|expenses|suppliers|purchase-orders|analytics|financial|gift-cards|store-credit|exchanges|inventory-transfers|cycle-counts|payroll|lottery|audit-logs|promotions|house-accounts)(\/|$)/;
    if (useAuthStore.getState().user?.role === 'SUPER_ADMIN' && view.isAdminViewing && view.viewingLocationId && scopePath.test(config.url || '')) {
      if (config.method?.toLowerCase() !== 'get') throw new Error('Store viewing mode is read-only');
      config.params = { ...config.params, locationId: view.viewingLocationId };
    }
    if (token && !config.headers.Authorization) {
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
let refreshingGeneration: number | null = null;
let failedQueue: { generation: number; resolve: (v: any) => void; reject: (e: any) => void }[] = [];

const processQueue = (generation: number, error: any, token: string | null = null) => {
  const queue = failedQueue.filter(p => p.generation === generation);
  failedQueue = failedQueue.filter(p => p.generation !== generation);
  queue.forEach((p) => {
    if (error) p.reject(error);
    else p.resolve(token);
  });
};

// The register watches whether the POS server answers (see services/connection.ts).
setServerCheck(async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(API_URL + '/health', { cache: 'no-store', signal: controller.signal });
    return response.ok && (await response.json())?.success === true;
  } finally { clearTimeout(timeout); }
});

/** No answer from the POS server itself: no network path, a timeout, or a gateway/proxy error page. */
const gotNoAnswer = (error: AxiosError) => error.response
  ? error.response.status >= 500 && typeof (error.response.data as { success?: unknown } | undefined)?.success !== 'boolean'
  : ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'].includes(error.code || '');

api.interceptors.response.use(
  (response) => {
    serverAnswered();
    if ((response.config as typeof response.config & { _storeGeneration?: number })._storeGeneration !== storeContextGeneration()) throw new CanceledError('Store context changed');
    if ((response.config as typeof response.config & { _sessionGeneration?: number })._sessionGeneration !== sessionGeneration()) throw new CanceledError('Session changed');
    const method = response.config.method?.toUpperCase() || 'GET';
    const path = response.config.url?.split('?')[0] || '';
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)
      && !/\/(quote|preview|what-if|chat|search)(\/|$)/.test(path)
      && !/^\/auth\/refresh(\/|$)/.test(path)) invalidateScopedQueries();
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as any;
    if (!originalRequest) return Promise.reject(error);
    if (gotNoAnswer(error)) serverDidNotAnswer(); else if (error.response) serverAnswered();
    if (originalRequest._storeGeneration !== storeContextGeneration()) return Promise.reject(new CanceledError('Store context changed', originalRequest));
    if (originalRequest._sessionGeneration !== sessionGeneration()) return Promise.reject(new CanceledError('Session changed', originalRequest));
    // Access to the store this sign-in switched to was removed: the server moved the
    // session home; reload the person there (stale store screens are cancelled).
    if (error.response?.status === 403 && (error.response.data as { details?: { code?: string } } | undefined)?.details?.code === 'STORE_ACCESS_ENDED') {
      const { useAuthStore } = await import('../store/authStore');
      void useAuthStore.getState().storeAccessEnded();
      return Promise.reject(error);
    }
    if (error.response?.status === 428 && originalRequest && !originalRequest._approvalRetried) {
      const { requestManagerApproval } = await import('../store/approvalStore');
      const body = typeof originalRequest.data === 'string' ? JSON.parse(originalRequest.data) : originalRequest.data || {};
      let token: string;
      try {
        token = await requestManagerApproval({ method: 'POST', path: `/api${originalRequest.url}`, body });
      } catch (approvalError) {
        // A cancelled approval is never an offline checkout/network failure.
        throw new AxiosError('Manager approval cancelled', 'ERR_CANCELED', originalRequest, error.request, {
          ...error.response, data: { success: false, error: approvalError instanceof Error ? approvalError.message : 'Manager approval cancelled' },
        });
      }
      originalRequest._approvalRetried = true;
      originalRequest.headers['X-Manager-Approval'] = token;
      return api(originalRequest);
    }
    const isCredentialAction = /^\/(auth\/(login|refresh|logout|forgot-password|reset-password|change-password|2fa|pin-login|register-staff)|users\/change-password|approvals)(\/|$)/.test(originalRequest.url || '');

    if (error.response?.status === 401 && !isCredentialAction && !originalRequest._retry && localStorage.getItem('token')) {
      const generation = originalRequest._sessionGeneration as number;
      originalRequest._retry = true;
      if (refreshingGeneration === generation) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ generation, resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      refreshingGeneration = generation;

      try {
        const { data } = await api.post('/auth/refresh', {}, { withCredentials: true });
        if (originalRequest._sessionGeneration !== sessionGeneration()) throw new CanceledError('Session changed');
        const newToken = data.data?.token || data.token;
        if (newToken) {
          localStorage.setItem('token', newToken);
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          processQueue(generation, null, newToken);
          return api(originalRequest);
        }
        throw new Error('Refresh response did not include an access token');
      } catch {
        processQueue(generation, error, null);
      } finally {
        if (refreshingGeneration === generation) refreshingGeneration = null;
      }

      // A cashier switch in progress replaced this session: let it finish first.
      await signInSettled();
      if (originalRequest._sessionGeneration !== sessionGeneration()) return Promise.reject(error);

      // Refresh failed — log out. Dynamic import avoids a circular
      // dependency (session.ts's stores import this file for API calls).
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      const clearedGeneration = changeSessionGeneration();
      try {
        const [{ clearSessionState }, { useAuthStore }] = await Promise.all([import('./session'), import('../store/authStore')]);
        if (sessionGeneration() !== clearedGeneration) return Promise.reject(error);
        useAuthStore.setState({ user: null, token: null, isAuthenticated: false, isLoading: false });
        await clearSessionState();
      } catch {
        // Best-effort — still redirect to login even if this fails
      }
      if (sessionGeneration() === clearedGeneration && !window.location.pathname.includes('/login')) {
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

  logout: (token?: string | null) => api.post('/auth/logout', {}, { timeout: 10000, headers: token ? { Authorization: `Bearer ${token}` } : {} }),

  getMe: () => api.get('/auth/me'),
  // Stores this person may work in, and moving this sign-in to one of them.
  getStores: () => api.get('/auth/stores'),
  switchStore: (locationId: string) => api.post('/auth/switch-store', { locationId }),

  register: (data: any) => api.post('/auth/register', data),

  // Sending an email can be slow to fail (SMTP connection issues); bound it
  // client-side too so the UI never appears to hang indefinitely.
  forgotPassword: (email: string) =>
    api.post('/auth/forgot-password', { email }, { timeout: 20000 }),

  resetPassword: (token: string, password: string) =>
    api.post('/auth/reset-password', { token, password }, { timeout: 20000 }),

  // Register PIN sign-in (works only on a computer set up as a register)
  setPin: (currentPassword: string, pin: string) => api.put('/auth/pin', { currentPassword, pin }),
  removePin: () => api.delete('/auth/pin'),
  verifyPin: (pin: string) => api.post('/auth/pin/verify', { pin }),
  registerStaff: (deviceToken: string) => api.post('/auth/register-staff', { deviceToken }),
  pinLogin: (deviceToken: string, userId: string, pin: string) =>
    api.post('/auth/pin-login', { deviceToken, userId, pin }, { withCredentials: true }),
  listRegisters: () => api.get('/auth/registers'),
  createRegister: (name: string) => api.post('/auth/registers', { name }),
  removeRegister: (id: string) => api.delete('/auth/registers/' + id),
};

/**
 * Two-factor authentication service
 */
export const twoFactorService = {
  getStatus: () => api.get('/auth/2fa/status'),

  setup: (password: string) => api.post('/auth/2fa/setup', { password }),
  cancelSetup: () => api.delete('/auth/2fa/setup'),

  verify: (code: string) => api.post('/auth/2fa/verify', { code }),

  disable: (password: string, code?: string) =>
    api.post('/auth/2fa/disable', { password, ...(code ? { code } : {}) }),

  regenerateBackupCodes: (password: string, code: string) =>
    api.post('/auth/2fa/backup-codes', { password, code }),
};

/**
 * Pricing: target-margin rules, suggested prices and the price review list.
 */
/**
 * One barcode hit: a product, one of its packs, or (managers) a supplier's case of it.
 * For managers, `openExceptionId` names the item's open stock exception, if any.
 */
export type BarcodeMatch =
  | { kind: 'PRODUCT' | 'PACK'; product: import('@/types').Product; openExceptionId?: string | null }
  | { kind: 'SUPPLIER_CASE'; product: import('@/types').Product; openExceptionId?: string | null; supplierCase: { supplierId: string; supplierName: string; packSize: number; packCost: number | null } };

/** An item or pack whose shelf label shows an old price. */
export interface PendingLabel {
  kind: 'PRODUCT' | 'PACK'; id: string; productId: string; sellingUnitId: string | null;
  name: string; sku: string; barcode: string | null; price: number; priceChangedAt: string;
}

export type PriceRounding = 'CENT' | 'NICKEL' | 'NINE' | 'NINETY_NINE';
export interface PriceRule { id: string; scope: 'STORE' | 'CATEGORY' | 'BRAND' | 'PRODUCT' | 'SELLING_UNIT'; scopeId: string; label: string; targetMargin: number; minMargin: number | null; rounding: PriceRounding }
export const pricingService = {
  rules: (signal?: AbortSignal) => api.get('/pricing/rules', { signal }),
  saveRule: (data: { scope: PriceRule['scope']; scopeId?: string; targetMargin: number; minMargin?: number | null; rounding: PriceRounding }) => api.put('/pricing/rules', data),
  deleteRule: (id: string) => api.delete(`/pricing/rules/${id}`),
  suggest: (params: { productId?: string; sellingUnitId?: string; categoryId?: string; brand?: string; cost?: number; price?: number }, signal?: AbortSignal) =>
    api.get('/pricing/suggest', { params, signal }),
  review: (signal?: AbortSignal) => api.get('/pricing/review', { signal }),
  apply: (changes: { productId: string; sellingUnitId?: string | null; price: number; expectedPrice: number }[]) => api.post('/pricing/apply', { changes }),
};

/**
 * Product service
 */
export const productService = {
  movements: (params: Record<string, string | number | undefined>) => api.get('/products/movements', { params }),
  getAll: (params?: any, signal?: AbortSignal) => api.get('/products', { params, signal }),

  getById: (id: string, signal?: AbortSignal) => api.get(`/products/${id}`, { signal }),

  /** Exact barcode lookup (UPC/EAN forms match). Supplier case matches are returned to managers only. */
  resolveBarcode: (code: string, signal?: AbortSignal) => api.get<{ success: boolean; data: { code: string; matches: BarcodeMatch[] } }>('/products/resolve-barcode', { params: { code }, signal }),

  /** Shelf labels whose price changed since they were printed (newest change first). */
  pendingLabels: (signal?: AbortSignal) => api.get<{ success: boolean; data: { items: PendingLabel[]; total: number } }>('/products/labels/pending', { signal }),
  /** Marks labels printed for the price change each was printed for (its `priceChangedAt`). */
  labelsPrinted: (data: { products: { id: string; priceChangedAt: string }[]; sellingUnits: { id: string; priceChangedAt: string }[] }) =>
    api.post('/products/labels/printed', data),

  getSellingUnits: (id: string, signal?: AbortSignal) => api.get(`/products/${id}/selling-units`, { signal }),
  // packCost: what one pack costs the store; the single's cost price becomes packCost / units.
  createSellingUnit: (id: string, data: { name: string; barcode: string; sku?: string; unitsPerPackage: number; price: number; baseUnitName?: string; packCost?: number }) =>
    api.post(`/products/${id}/selling-units`, data),
  updateSellingUnit: (id: string, unitId: string, data: { name?: string; barcode?: string; sku?: string | null; price?: number; isActive?: boolean; packCost?: number; expectedVersion: number }) =>
    api.put(`/products/${id}/selling-units/${unitId}`, data),
  // Packs and variety packs listed on their own (Inventory > Packs).
  getPacks: (params: { search?: string; page?: number; limit?: number; locationId?: string }, signal?: AbortSignal) => api.get('/products/packs', { params, signal }),
  // Turn a standalone product (e.g. a carton sold as its own item) into a pack of another product.
  previewMergeIntoPack: (sourceId: string, data: { baseProductId: string; unitsPerPackage: number; name?: string; price?: number; barcode?: string }) =>
    api.post(`/products/${sourceId}/merge-into-pack/preview`, data),
  mergeIntoPack: (sourceId: string, data: { baseProductId: string; unitsPerPackage: number; name?: string; price?: number; barcode?: string; idempotencyKey: string }) =>
    api.post(`/products/${sourceId}/merge-into-pack`, data),
  updateBaseUnitName: (id: string, baseUnitName: string) => api.patch(`/products/${id}/selling-units`, { baseUnitName }),
  updatePackaging: (id: string, unitId: string, data: { action: 'count' | 'open'; quantity: number; expectedVersion: number; expectedStockVersion: number; requestKey: string; reason?: string }) =>
    api.post(`/products/${id}/selling-units/${unitId}/packaging`, data),
  // Variety packs: what a pack contains, and opening packs into their contents.
  getBundle: (id: string, signal?: AbortSignal) => api.get(`/products/${id}/bundle`, { signal }),
  setBundle: (id: string, components: { productId: string; quantity: number }[]) => api.put(`/products/${id}/bundle`, { components }),
  openBundle: (id: string, data: { quantity: number; idempotencyKey: string }) => api.post(`/products/${id}/open-bundle`, data),

  create: (data: any) => api.post('/products', data),

  update: (id: string, data: any) => api.put(`/products/${id}`, data),

  delete: (id: string) => api.delete(`/products/${id}`),

  getLowStock: () => api.get('/products/low-stock'),

  getStats: () => api.get('/products/stats'),

  adjustInventory: (id: string, data: any) =>
    api.post(`/products/${id}/adjust-inventory`, data),

  identify: (data: { barcode?: string; image?: string; mediaType?: string }, signal?: AbortSignal) =>
    api.post('/products/identify', data, { timeout: 60000, signal }),

  bulkUpdateStock: (updates: any[], reason: string, notes?: string) =>
    api.post('/products/bulk-update-stock', { updates, reason, notes }),

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
  getAll: (params?: any, signal?: AbortSignal) => api.get('/categories', { params, signal }),

  getById: (id: string) => api.get(`/categories/${id}`),

  create: (data: any) => api.post('/categories', data),

  update: (id: string, data: any) => api.put(`/categories/${id}`, data),

  delete: (id: string) => api.delete(`/categories/${id}`),
};

/**
 * Sale service
 */
export const saleService = {
  quote: (items: import('@/types/checkout').CheckoutItem[], intent: import('@/types/checkout').CheckoutQuoteIntent = {}, signal?: AbortSignal) => api.post('/sales/quote', { items, ...intent }, { signal }),
  getAll: (params?: any, signal?: AbortSignal) => api.get('/sales', { params, signal }),

  getById: (id: string, signal?: AbortSignal) => api.get(`/sales/${encodeURIComponent(id)}`, { signal }),

  /** `config` carries a manager's register approval header when the sale has an approved discount. */
  create: (data: any, config?: { headers?: Record<string, string> }) => api.post('/sales', data, config),

  refund: (id: string, data: any) => api.post(`/sales/${id}/refund`, data),

  void: (id: string, data?: { reason: string; idempotencyKey: string; expectedAmount: number }) => api.post(`/sales/${id}/void`, data),

  bulkVoid: (data: import('./pendingBulkVoid').BulkVoidRequest) => api.post('/sales/bulk-void', data),

  previewBulkRefund: (saleIds: string[], signal?: AbortSignal) => api.post('/sales/bulk-refund/preview', { saleIds }, { signal }),

  emailReceipt: (id: string, email: string) => api.post(`/sales/${id}/email-receipt`, { email }),
};

/**
 * Customer service
 */
export const customerService = {
  getAll: (params?: any, signal?: AbortSignal) => api.get('/customers', { params, signal }),

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
  getAll: (params?: any, signal?: AbortSignal) => api.get('/shifts', { params, signal }),

  // Each answer about the cashier's own drawer is remembered on the register (services/openShift.ts),
  // so a start without a connection still knows which drawer offline cash sales belong to.
  getCurrent: (signal?: AbortSignal) => api.get('/shifts/current', { signal })
    .then(response => { void rememberOpenShift(response.data?.data?.id ?? null); return response; }),

  clockIn: (data: any) => api.post('/shifts/clock-in', data)
    .then(response => { void rememberOpenShift(response.data?.data?.id ?? null); return response; }),

  clockOut: (data: any) => api.post('/shifts/clock-out', data)
    .then(response => { void rememberOpenShift(null); return response; }),

  close: (id: string, data: any) => api.post(`/shifts/${id}/close`, data),

  getEmployeePerformance: (params?: any, signal?: AbortSignal) => api.get('/shifts/employee-performance', { params, signal }),

  cashMovement: (data: { type: string; amount: number; reason: string; idempotencyKey?: string }) =>
    api.post('/shifts/cash-movement', data),

  getZReport: (id: string) => api.get(`/shifts/${id}/z-report`),
};

/**
 * Report service
 */
export const reportService = {
  getDashboard: (signal?: AbortSignal) => api.get('/reports/dashboard', { signal }),
  getDashboardHourly: () => api.get('/reports/dashboard/hourly'),

  getOverall: (params?: any, signal?: AbortSignal) => api.get('/reports/overall', { params, signal }),

  getSales: (params?: any, signal?: AbortSignal) => api.get('/reports/sales', { params, signal }),

  getInventory: (params?: any, signal?: AbortSignal) => api.get('/reports/inventory', { params, signal }),

  getEmployees: (params?: any, signal?: AbortSignal) => api.get('/reports/employees', { params, signal }),

  getProducts: (params?: any, signal?: AbortSignal) => api.get('/reports/products', { params, signal }),

  getExpenses: (params?: any, signal?: AbortSignal) => api.get('/reports/expenses', { params, signal }),

  getEmployeeSales: (params?: any, signal?: AbortSignal) => api.get('/reports/employee-sales', { params, signal }),

  getStockHealth: (params?: { days?: number }) => api.get('/reports/stock-health', { params }),

  /** What needs attention at this store today (Dashboard). */
  getAttention: (signal?: AbortSignal) => api.get('/reports/attention', { signal }),
  sendDailyDigest: (idempotencyKey: string) => api.post('/reports/daily-digest/send', { idempotencyKey }),
  getDigestDeliveries: (page = 1, signal?: AbortSignal) => api.get('/reports/daily-digest/deliveries', { params: { page }, signal }),
  retryDigestDelivery: (id: string, input: { reason: string; confirmedNotDelivered: boolean }) => api.post(`/reports/daily-digest/deliveries/${id}/retry`, input),

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
  getAll: (params?: any, signal?: AbortSignal) => api.get('/expenses', { params, signal }),

  getById: (id: string) => api.get(`/expenses/${id}`),

  create: (data: any) => api.post('/expenses', data),

  update: (id: string, data: any) => api.put(`/expenses/${id}`, data),

  delete: (id: string) => api.delete(`/expenses/${id}`),

  approve: (id: string) => api.post(`/expenses/${id}/approve`),

  reject: (id: string) => api.post(`/expenses/${id}/reject`),

  downloadReceipt: (filename: string) => api.get(`/expenses/receipts/${encodeURIComponent(filename)}`, { responseType: 'blob' }),
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
  getAll: (params?: any, signal?: AbortSignal) => api.get('/suppliers', { params, signal }),

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
  getAll: (params?: any, signal?: AbortSignal) => api.get('/purchase-orders', { params, signal }),

  getById: (id: string) => api.get(`/purchase-orders/${id}`),

  create: (data: any) => api.post('/purchase-orders', data),

  update: (id: string, data: any) => api.put(`/purchase-orders/${id}`, data),

  delete: (id: string) => api.delete(`/purchase-orders/${id}`),

  updateStatus: (id: string, status: string) =>
    api.post(`/purchase-orders/${id}/status`, { status }),

  receive: (id: string, delivery: import('@/types/purchasing').PurchaseReceiptRequest) =>
    api.post(`/purchase-orders/${id}/receive`, delivery),

  cancel: (id: string, reason?: string) =>
    api.post(`/purchase-orders/${id}/cancel`, { reason }),

  autoGenerate: () => api.post('/purchase-orders/auto-generate'),

  getSuggested: (locationId?: string, signal?: AbortSignal) => api.get('/purchase-orders/suggested', { params: { locationId }, signal }),
};

/**
 * Analytics service
 */
export const analyticsService = {
  // The other analysis screens (comparison, ABC, forecast, what-if, anomalies, bundles) were removed
  // at the owner's request, so their client calls are gone too; only Customer Insights reads this API.
  getCustomerInsights: (params?: any, signal?: AbortSignal) => api.get('/analytics/customer-insights', { params, signal }),
};

/**
 * Financial service
 */
export const financialService = {
  // Budgets
  getBudgets: (params?: any, signal?: AbortSignal) => api.get('/financial/budgets', { params, signal }),
  getBudgetSummary: (params?: any, signal?: AbortSignal) => api.get('/financial/budgets/summary', { params, signal }),
  createBudget: (data: any) => api.post('/financial/budgets', data),
  updateBudget: (id: string, data: any) => api.put(`/financial/budgets/${id}`, data),
  deleteBudget: (id: string) => api.delete(`/financial/budgets/${id}`),

  // Recurring Expenses
  getRecurringExpenses: (params?: any, signal?: AbortSignal) => api.get('/financial/recurring-expenses', { params, signal }),
  createRecurringExpense: (data: any) => api.post('/financial/recurring-expenses', data),
  updateRecurringExpense: (id: string, data: any) => api.put(`/financial/recurring-expenses/${id}`, data),
  deleteRecurringExpense: (id: string) => api.delete(`/financial/recurring-expenses/${id}`),
  generateRecurringExpenses: () => api.post('/financial/recurring-expenses/generate'),

  // Accounting Exports
  getExportHistory: () => api.get('/financial/exports'),
  exportSales: (params?: any, signal?: AbortSignal) => api.get('/financial/export/sales', { params, signal }),
  exportExpenses: (params?: any, signal?: AbortSignal) => api.get('/financial/export/expenses', { params, signal }),
  getProfitAndLoss: (params?: any, signal?: AbortSignal) => api.get('/financial/reports/pnl', { params, signal }),
};

/**
 * The reason the server gave for a failed request. The API answers
 * `{ error }`; older endpoints may send `{ message }`.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { error?: unknown; message?: unknown } } })?.response?.data;
  const reason = typeof data?.error === 'string' ? data.error : typeof data?.message === 'string' ? data.message : '';
  return reason.trim() || fallback;
}

/**
 * Location service (Super Admin)
 */
export const locationService = {
  getAll: (signal?: AbortSignal) => api.get('/locations', { signal }),
  /** Stores with today's and all-time sales after refunds (the same figures as each store's dashboard). */
  getAllWithStats: (signal?: AbortSignal) => api.get('/locations', { params: { include: 'stats' }, signal }),
  getById: (id: string) => api.get(`/locations/${id}`),
  getStats: (id: string, period?: number) => api.get(`/locations/${id}/stats`, { params: { period } }),
  getCrossLocationStats: (period?: number | string) => api.get('/locations/stats/overview', { params: { period } }),
  create: (data: any) => api.post('/locations', data),
  update: (id: string, data: any) => api.put(`/locations/${id}`, data),
  delete: (id: string) => api.delete(`/locations/${id}`),
  getMySettings: (locationId?: string) => api.get('/locations/my-settings', { params: locationId ? { locationId } : {} }),
  updateMySettings: (data: any) => api.put('/locations/my-settings', data),
  /** Platform admin: move a store to another business (null: one of its own). */
  moveToOrganization: (id: string, organizationId: string | null) => api.put(`/locations/${id}`, { organizationId }),
};

/** Owners of several stores: the My Stores overview and access to their other stores. */
export const organizationService = {
  getOverview: (signal?: AbortSignal) => api.get('/organization/overview', { signal }),
  listAccess: (signal?: AbortSignal) => api.get('/organization/access', { signal }),
  grantAccess: (data: { email: string; locationId: string; role: 'MANAGER' | 'CASHIER' }) => api.post('/organization/access', data),
  removeAccess: (id: string) => api.delete(`/organization/access/${id}`),
};

/** Platform admin: businesses and their owners. */
export const organizationAdminService = {
  getAll: (signal?: AbortSignal) => api.get('/organizations', { signal }),
  create: (name: string) => api.post('/organizations', { name }),
  addOwner: (id: string, email: string) => api.post(`/organizations/${id}/owners`, { email }),
  removeOwner: (id: string, userId: string) => api.delete(`/organizations/${id}/owners/${userId}`),
};

/**
 * User management service (Admin)
 */
export const userService = {
  getAll: (params?: any, signal?: AbortSignal) => api.get('/users', { params, signal }),
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
export interface AccountFundingRequest {
  amount: number; idempotencyKey: string; paymentMethod: 'CASH' | 'CARD' | 'PROMOTIONAL'; reference?: string; notes?: string;
}
export const giftCardService = {
  getAll: (params?: any, signal?: AbortSignal) => api.get('/gift-cards', { params, signal }),
  getStats: (signal?: AbortSignal) => api.get('/gift-cards/stats', { signal }),
  getById: (id: string) => api.get(`/gift-cards/${id}`),
  checkBalance: (code: string) => api.get(`/gift-cards/balance/${code}`),
  issue: (data: AccountFundingRequest & { customerId?: string; expiresAt?: string }) =>
    api.post('/gift-cards', data),
  reload: (id: string, data: AccountFundingRequest) => api.post(`/gift-cards/${id}/reload`, data),
  deactivate: (id: string) => api.post(`/gift-cards/${id}/deactivate`),
};

/**
 * Store Credit service
 */
export const storeCreditService = {
  getAll: (params?: any, signal?: AbortSignal) => api.get('/store-credit', { params, signal }),
  getBalance: (customerId: string) => api.get(`/store-credit/${customerId}`),
  getTransactions: (customerId: string, params?: any) => api.get(`/store-credit/${customerId}/transactions`, { params }),
  addCredit: (customerId: string, data: { amount: number; notes: string; source: 'GOODWILL' | 'CORRECTION'; idempotencyKey: string }) =>
    api.post(`/store-credit/${customerId}/credit`, data),
};

/**
 * Exchange / Return service
 */
export const exchangeService = {
  getAll: (params?: any, signal?: AbortSignal) => api.get('/exchanges', { params, signal }),
  getById: (id: string) => api.get(`/exchanges/${id}`),
  create: (data: any) => api.post('/exchanges', data),
};

/**
 * Inventory Transfer service
 */
export const inventoryTransferService = {
  options: (locationId?: string) => api.get('/inventory-transfers/options', { params: { locationId } }),
  connections: () => api.get('/inventory-transfers/connections'),
  connect: (fromLocationId: string, toLocationId: string) => api.post('/inventory-transfers/connections', { fromLocationId, toLocationId }),
  disconnect: (id: string) => api.delete('/inventory-transfers/connections/' + id),
  getAll: (params?: any, signal?: AbortSignal) => api.get('/inventory-transfers', { params, signal }),
  getById: (id: string) => api.get(`/inventory-transfers/${id}`),
  create: (data: any) => api.post('/inventory-transfers', data),
  ship: (id: string) => api.post(`/inventory-transfers/${id}/ship`),
  mappingOptions: (id: string) => api.get(`/inventory-transfers/${id}/mapping-options`),
  receipts: (id: string, page: number) => api.get(`/inventory-transfers/${id}/receipts`, { params: { page } }),
  recordReceipt: (id: string, kind: import('@/types/transfers').TransferReceiptKind, data: import('@/types/transfers').TransferReceiptRequest) =>
    api.post(`/inventory-transfers/${id}/${kind === 'RECEIVE' ? 'receive' : kind === 'SOURCE_RETURN' ? 'receive-return' : 'request-return'}`, data),
  cancel: (id: string) => api.post(`/inventory-transfers/${id}/cancel`),
};

/**
 * Cycle Count service
 */
export const cycleCountService = {
  getAll: (params?: any, signal?: AbortSignal) => api.get('/cycle-counts', { params, signal }),
  getById: (id: string) => api.get(`/cycle-counts/${id}`),
  create: (data: any) => api.post('/cycle-counts', data),
  updateItems: (id: string, items: any[]) => api.put(`/cycle-counts/${id}/items`, { items }),
  submit: (id: string) => api.post(`/cycle-counts/${id}/submit`),
  refresh: (id: string) => api.post(`/cycle-counts/${id}/refresh`),
  approve: (id: string) => api.post(`/cycle-counts/${id}/approve`),
  cancel: (id: string) => api.post(`/cycle-counts/${id}/cancel`),
};

/**
 * Inventory exceptions: negative-stock discrepancy alerts
 */
export const inventoryExceptionService = {
  getAll: (params?: { status?: 'open' | 'resolved' | 'all'; page?: number; limit?: number; locationId?: string }, signal?: AbortSignal) =>
    api.get('/inventory-exceptions', { params, signal }),
  summary: (params?: { locationId?: string }, signal?: AbortSignal) => api.get('/inventory-exceptions/summary', { params, signal }),
  getById: (id: string, params?: { locationId?: string }) => api.get(`/inventory-exceptions/${id}`, { params }),
  requestRecount: (id: string, assignedToId?: string | null) => api.post(`/inventory-exceptions/${id}/recount`, { assignedToId }),
  recordCount: (id: string, data: { countedQuantity: number; resolution: string; notes?: string; expectedVersion: number; idempotencyKey: string }) =>
    api.post(`/inventory-exceptions/${id}/count`, data),
  resolve: (id: string, data: { resolution: string; notes?: string }) => api.post(`/inventory-exceptions/${id}/resolve`, data),
  preview: (id: string, data: { action: 'count'; countedQuantity: number; resolution: string } | { action: 'reclass'; fromProductId: string; quantity: number }) =>
    api.post(`/inventory-exceptions/${id}/preview`, data),
  reclass: (id: string, data: { fromProductId: string; quantity: number; reason: 'SOLD_AS_OTHER' | 'RECEIVED_AS_OTHER' | 'RETURNED_AS_OTHER'; saleItemId?: string; notes?: string; idempotencyKey: string }) =>
    api.post(`/inventory-exceptions/${id}/reclass`, data),
  corrections: (params?: { locationId?: string }, signal?: AbortSignal) => api.get('/inventory-exceptions/corrections', { params, signal }),
  unmatched: (params?: { status?: 'open' | 'matched' | 'all'; locationId?: string }, signal?: AbortSignal) => api.get('/inventory-exceptions/unmatched', { params, signal }),
  matchUnmatched: (entryId: string, data: { actualUnitCost: number; notes?: string }) => api.post(`/inventory-exceptions/unmatched/${entryId}/match`, data),
  correctSaleLine: (saleId: string, itemId: string, data: { toProductId: string; quantity: number; reason: string; idempotencyKey: string }) =>
    api.post(`/sales/${saleId}/items/${itemId}/correct-product`, data),
};

/**
 * Lottery service
 */
export const lotteryService = {
  // Batches
  getBatches: (params?: any, signal?: AbortSignal) => api.get('/lottery/batches', { params, signal }),
  getBatchById: (id: string) => api.get(`/lottery/batches/${id}`),
  createBatch: (data: any) => api.post('/lottery/batches', data),
  updateBatch: (id: string, data: any) => api.put(`/lottery/batches/${id}`, data),
  deleteBatch: (id: string) => api.delete(`/lottery/batches/${id}`),

  // Transactions
  getTransactions: (params?: any, signal?: AbortSignal) => api.get('/lottery/transactions', { params, signal }),
  getTransactionById: (id: string) => api.get(`/lottery/transactions/${id}`),
  upsertTransaction: (data: any) => api.post('/lottery/transactions', data),
  closeTransaction: (id: string, data: any) => api.post(`/lottery/transactions/${id}/close`, data),

  // Scans
  scanTicket: (data: any) => api.post('/lottery/scan', data),
  getScans: (params?: any, signal?: AbortSignal) => api.get('/lottery/scans', { params, signal }),

  // Reports
  getDailySummary: (params?: any, signal?: AbortSignal) => api.get('/lottery/reports/daily-summary', { params, signal }),

  // Ticket Types
  getTicketTypes: (params?: any, signal?: AbortSignal) => api.get('/lottery/ticket-types', { params, signal }),
  getTicketTypeById: (id: string) => api.get(`/lottery/ticket-types/${id}`),
  createTicketType: (data: any) => api.post('/lottery/ticket-types', data),
  updateTicketType: (id: string, data: any) => api.put(`/lottery/ticket-types/${id}`, data),
  deleteTicketType: (id: string) => api.delete(`/lottery/ticket-types/${id}`),

  // Daily Entries
  getDailyEntries: (params?: any, signal?: AbortSignal) => api.get('/lottery/daily-entries', { params, signal }),
  createDailyEntry: (data: any) => api.post('/lottery/daily-entries', data),
  updateDailyEntry: (id: string, data: any) => api.put(`/lottery/daily-entries/${id}`, data),
  deleteDailyEntry: (id: string) => api.delete(`/lottery/daily-entries/${id}`),
  getCarryForwardInfo: (params?: any, signal?: AbortSignal) => api.get('/lottery/daily-entries/carry-forward', { params, signal }),

  // Day Status
  getDayStatus: (params?: any, signal?: AbortSignal) => api.get('/lottery/day-status', { params, signal }),
  updateDayStatusCashout: (id: string, data: any) => api.put(`/lottery/day-status/${id}`, data),
  closeDay: (data: any) => api.post('/lottery/day-status/close', data),
  reopenDay: (id: string, data: any) => api.post(`/lottery/day-status/${id}/reopen`, data),
};

export const auditLogService = {
  getAll: (params?: any, signal?: AbortSignal) => api.get('/audit-logs', { params, signal }),
  getActions: (locationId?: string) => api.get('/audit-logs/actions', { params: { locationId } }),
  getEntities: (locationId?: string) => api.get('/audit-logs/entities', { params: { locationId } }),
};

/**
 * Developer service (API keys + webhooks, admin only)
 */
export const developerService = {
  listApiKeys: (signal?: AbortSignal) => api.get('/developer/api-keys', { signal }),
  createApiKey: (name: string) => api.post('/developer/api-keys', { name }),
  revokeApiKey: (id: string) => api.delete(`/developer/api-keys/${id}`),

  listWebhooks: (signal?: AbortSignal) => api.get('/developer/webhooks', { signal }),
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
  getAll: (params?: any, signal?: AbortSignal) => api.get('/house-accounts', { params, signal }),
  create: (data: { customerId: string; creditLimit: number }) => api.post('/house-accounts', data),
  update: (id: string, data: { creditLimit?: number; isActive?: boolean }) =>
    api.put(`/house-accounts/${id}`, data),
  recordPayment: (id: string, data: Omit<AccountFundingRequest, 'paymentMethod'> & { paymentMethod: 'CASH' | 'CARD' }) =>
    api.post(`/house-accounts/${id}/payment`, data),
  getTransactions: (id: string) => api.get(`/house-accounts/${id}/transactions`),
  emailStatement: (id: string) => api.post(`/house-accounts/${id}/statement`),
};

/**
 * Promotion service
 */
export const promotionService = {
  getAll: (params?: any, signal?: AbortSignal) => api.get('/promotions', { params, signal }),
  getActive: (params?: { locationId?: string }) => api.get('/promotions/active', { params }),
  getById: (id: string) => api.get(`/promotions/${id}`),
  create: (data: any) => api.post('/promotions', data),
  update: (id: string, data: any) => api.put(`/promotions/${id}`, data),
  toggle: (id: string) => api.post(`/promotions/${id}/toggle`),
  delete: (id: string) => api.delete(`/promotions/${id}`),
};

export const payrollService = {
  get: (locationId?: string, page = 1, signal?: AbortSignal) => api.get('/payroll', { params: { locationId, page }, signal }),
  detail: (id: string, page = 1, signal?: AbortSignal) => api.get('/payroll/expenses/' + id, { params: { page }, signal }),
  setRate: (id: string, hourlyRate: number | null) => api.put('/payroll/employees/' + id + '/rate', { hourlyRate }),
  setSchedule: (locationId: string, frequency: string) => api.put('/payroll/schedule', { frequency }, { params: { locationId } }),
  process: (locationId: string) => api.post('/payroll/process', {}, { params: { locationId } }),
};
