import Dexie, { Table } from 'dexie';
import type { PaymentSession } from './paymentSession';

// Types for offline data
export interface OfflineProduct {
  id: string;
  sku: string;
  name: string;
  description?: string;
  categoryId?: string;
  categoryName?: string;
  cost: number;
  price: number;
  stockQuantity: number;
  lowStockAlert: number;
  barcode?: string;
  image?: string;
  isActive: boolean;
  isTaxable: boolean;
  trackInventory?: boolean;
  minimumAge?: number;
  ebtEligible?: boolean;
  priceEmbedded?: boolean;
  syncedAt: number;
}

export interface OfflineCustomer {
  id: string;
  email?: string;
  phone: string;
  firstName: string;
  lastName: string;
  loyaltyPoints: number;
  totalSpent: number;
  visitCount: number;
  syncedAt: number;
}

export interface PendingSale {
  id?: number;  // Auto-incremented
  localId: string;  // Stable checkout idempotency key
  userId?: string;
  payload?: Record<string, any>;
  locationId?: string | null; // store this sale was rung up at, tagged at queue-time
  customerId?: string;
  items: PendingSaleItem[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paymentMethod: string;
  amountPaid: number;
  changeDue: number;
  notes?: string;
  createdAt: number;
  synced: boolean;
  syncAttempts: number;
  lastSyncAttempt?: number;
  syncError?: string;
  serverId?: string;  // ID from server after sync
  reconciliation?: { receiptId: string; status: 'HOLD' | 'FINAL'; disposition: string; recordedAt: number };
  originalReceipt?: Record<string, any>;
}

export interface PendingSaleItem {
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  price: number;
  discount: number;
  tax: number;
  total: number;
  isTaxable?: boolean;
}

export interface SyncLog {
  id?: number;
  type: 'sale' | 'product' | 'customer';
  action: 'create' | 'update' | 'delete' | 'sync';
  localId: string;
  serverId?: string;
  timestamp: number;
  success: boolean;
  error?: string;
}

export interface OfflineSettings {
  key: string;
  value: any;
}

/** A terminal has already taken payment; retry only this exact POS submission. */
export interface TerminalCheckout {
  paymentSessionId?: string;
  key: string;
  userId: string;
  locationId: string;
  createdAt: number;
  payload: Record<string, unknown>;
  cartSnapshot: string;
  total: number;
  references: string[];
  reconciliation?: { receiptId: string; status: 'HOLD' | 'FINAL'; disposition: string; recordedAt: number };
}

export interface OfflineCacheScope { userId: string; locationId: string }

// Dexie Database Class
export class POSDatabase extends Dexie {
  products!: Table<OfflineProduct, string>;
  customers!: Table<OfflineCustomer, string>;
  pendingSales!: Table<PendingSale, number>;
  syncLogs!: Table<SyncLog, number>;
  settings!: Table<OfflineSettings, string>;
  terminalCheckouts!: Table<TerminalCheckout, string>;
  paymentSessions!: Table<PaymentSession, string>;

  constructor() {
    super('POSOfflineDB');

    this.version(1).stores({
      products: 'id, sku, barcode, categoryId, name, syncedAt',
      customers: 'id, phone, email, syncedAt',
      pendingSales: '++id, localId, createdAt, synced, customerId',
      syncLogs: '++id, type, localId, timestamp',
      settings: 'key',
    });
    this.version(2).stores({
      terminalCheckouts: 'key, [userId+locationId], createdAt',
    });
    this.version(3).stores({ paymentSessions: 'id, [userId+locationId], status, createdAt' });
  }
}

// Create database instance
export const db = new POSDatabase();

// Database operations
export const offlineDb = {
  // Products
  async cacheProducts(products: any[], scope: OfflineCacheScope, isCurrent: () => boolean): Promise<void> {
    const offlineProducts: OfflineProduct[] = products.map(p => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      description: p.description,
      categoryId: p.categoryId,
      categoryName: p.category?.name,
      cost: p.cost,
      price: p.price,
      stockQuantity: p.stockQuantity,
      lowStockAlert: p.lowStockAlert,
      barcode: p.barcode,
      image: p.image,
      isActive: p.isActive ?? false,
      isTaxable: p.isTaxable ?? false,
      trackInventory: p.trackInventory,
      minimumAge: p.minimumAge,
      ebtEligible: p.ebtEligible,
      priceEmbedded: p.priceEmbedded,
      syncedAt: Date.now(),
    }));

    await db.transaction('rw', db.products, db.settings, async () => {
      if (!isCurrent()) throw new Error('Cache session changed');
      await db.products.clear();
      await db.products.bulkPut(offlineProducts);
      await db.settings.put({ key: 'products_cache_scope', value: { ...scope, cachedAt: Date.now() } });
      if (!isCurrent()) throw new Error('Cache session changed');
    });
    console.log(`Cached ${products.length} products to IndexedDB`);
  },

  async getProducts(): Promise<OfflineProduct[]> {
    return db.products.filter(p => p.isActive).toArray();
  },

  async getAllProducts(scope: OfflineCacheScope): Promise<OfflineProduct[]> {
    return db.transaction('r', db.products, db.settings, async () => {
      const cached = (await db.settings.get('products_cache_scope'))?.value;
      if (cached?.userId !== scope.userId || cached?.locationId !== scope.locationId) return [];
      return db.products.toArray();
    });
  },

  async getProductById(id: string): Promise<OfflineProduct | undefined> {
    return db.products.get(id);
  },

  async getProductByBarcode(barcode: string): Promise<OfflineProduct | undefined> {
    return db.products.where('barcode').equals(barcode).first();
  },

  async searchProducts(query: string): Promise<OfflineProduct[]> {
    const lowerQuery = query.toLowerCase();
    return db.products
      .filter(p =>
        p.name.toLowerCase().includes(lowerQuery) ||
        p.sku.toLowerCase().includes(lowerQuery) ||
        Boolean(p.barcode && p.barcode.includes(query))
      )
      .toArray();
  },

  async updateProductStock(productId: string, quantityChange: number): Promise<void> {
    await db.products
      .where('id')
      .equals(productId)
      .modify(product => {
        // Mirrors the server: recorded stock may go negative.
        product.stockQuantity = product.stockQuantity + quantityChange;
      });
  },

  // Customers
  async cacheCustomers(customers: any[], scope: OfflineCacheScope, isCurrent: () => boolean): Promise<void> {
    const offlineCustomers: OfflineCustomer[] = customers.map(c => ({
      id: c.id,
      email: c.email,
      phone: c.phone,
      firstName: c.firstName,
      lastName: c.lastName,
      loyaltyPoints: c.loyaltyPoints,
      totalSpent: c.totalSpent,
      visitCount: c.visitCount,
      syncedAt: Date.now(),
    }));

    await db.transaction('rw', db.customers, db.settings, async () => {
      if (!isCurrent()) throw new Error('Cache session changed');
      await db.customers.clear();
      await db.customers.bulkPut(offlineCustomers);
      await db.settings.put({ key: 'customers_cache_scope', value: { ...scope, cachedAt: Date.now() } });
      if (!isCurrent()) throw new Error('Cache session changed');
    });
    console.log(`Cached ${customers.length} customers to IndexedDB`);
  },

  async getCustomers(): Promise<OfflineCustomer[]> {
    return db.customers.toArray();
  },

  async getCustomerById(id: string): Promise<OfflineCustomer | undefined> {
    return db.customers.get(id);
  },

  async searchCustomerByPhone(phone: string): Promise<OfflineCustomer | undefined> {
    return db.customers.where('phone').equals(phone).first();
  },

  // Pending Sales
  async savePendingSale(sale: Omit<PendingSale, 'id'>): Promise<number> {
    return db.transaction('rw', db.pendingSales, db.products, db.syncLogs, async () => {
      const existing = await db.pendingSales.where('localId').equals(sale.localId).first();
      if (existing?.id) return existing.id;
      const id = await db.pendingSales.add(sale as PendingSale);

      // Update local stock
      for (const item of sale.items) {
        await this.updateProductStock(item.productId, -item.quantity);
      }

      // Log the action
      await this.addSyncLog({
        type: 'sale',
        action: 'create',
        localId: sale.localId,
        timestamp: Date.now(),
        success: true,
      });

      console.log(`Saved pending sale with local ID: ${sale.localId}`);
      return id;
    });
  },

  async getPendingSales(): Promise<PendingSale[]> {
    return db.pendingSales.filter(sale => !sale.synced).toArray();
  },

  async getAllPendingSales(): Promise<PendingSale[]> {
    return db.pendingSales.toArray();
  },

  async getPendingSaleCount(): Promise<number> {
    return db.pendingSales.filter(sale => !sale.synced).count();
  },

  async resetSaleAttempts(id: number): Promise<void> {
    await db.pendingSales.update(id, { syncAttempts: 0, syncError: undefined });
  },

  async markSaleAsSynced(id: number, serverId: string): Promise<void> {
    await db.pendingSales.update(id, {
      synced: true,
      serverId,
      lastSyncAttempt: Date.now(),
      syncError: undefined,
    });
  },

  async markSaleSyncFailed(id: number, error: string): Promise<void> {
    const sale = await db.pendingSales.get(id);
    if (sale) {
      await db.pendingSales.update(id, {
        syncAttempts: sale.syncAttempts + 1,
        lastSyncAttempt: Date.now(),
        syncError: error,
      });
    }
  },

  async deleteSyncedSales(): Promise<number> {
    // Keep original checkout evidence on this register. Explicit clearing remains
    // available only after every unresolved payment has been reconciled.
    return 0;
  },

  // Sync Logs
  async addSyncLog(log: Omit<SyncLog, 'id'>): Promise<void> {
    await db.syncLogs.add(log as SyncLog);
  },

  async getSyncLogs(limit: number = 100): Promise<SyncLog[]> {
    return db.syncLogs
      .orderBy('timestamp')
      .reverse()
      .limit(limit)
      .toArray();
  },

  async clearOldSyncLogs(daysOld: number = 7): Promise<number> {
    const cutoff = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
    return db.syncLogs.where('timestamp').below(cutoff).delete();
  },

  // Settings
  async setSetting(key: string, value: any): Promise<void> {
    await db.settings.put({ key, value });
  },

  async getSetting<T>(key: string): Promise<T | undefined> {
    const setting = await db.settings.get(key);
    return setting?.value;
  },

  async deleteSetting(key: string): Promise<void> {
    await db.settings.delete(key);
  },

  // Database Management
  async getStats(): Promise<{
    products: number;
    customers: number;
    pendingSales: number;
    syncLogs: number;
    dbSize?: number;
  }> {
    const [products, customers, pendingSales, syncLogs] = await Promise.all([
      db.products.count(),
      db.customers.count(),
      db.pendingSales.filter(sale => !sale.synced).count(),
      db.syncLogs.count(),
    ]);

    // Estimate database size
    let dbSize: number | undefined;
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      dbSize = estimate.usage;
    }

    return { products, customers, pendingSales, syncLogs, dbSize };
  },

  async clearAll(): Promise<void> {
    await db.transaction('rw', db.tables, async () => {
    if (await db.pendingSales.filter(record => !record.synced).count() || await db.terminalCheckouts.filter(record=>record.reconciliation?.status!=='FINAL').count() || await db.paymentSessions.where('status').anyOf('OPEN', 'SUBMITTED').count()) {
      throw new Error('Unconfirmed payments must be reconciled before clearing register data');
    }
    await Promise.all([
      db.products.clear(),
      db.customers.clear(),
      db.pendingSales.clear(),
      db.syncLogs.clear(),
      db.settings.clear(),
      db.terminalCheckouts.clear(),
      db.paymentSessions.clear(),
    ]);
    });
    console.log('All offline data cleared');
  },

  // Logout-safe variant: clears the cached product/customer catalog (so a
  // different cashier logging into a different store never sees stale
  // pricing/inventory) but deliberately leaves pendingSales untouched —
  // wiping unsynced sales would permanently lose revenue records.
  async clearCachesForLogout(): Promise<void> {
    await Promise.all([
      db.products.clear(),
      db.customers.clear(),
      db.settings.clear(),
    ]);
  },

  async exportData(): Promise<{
    products: OfflineProduct[];
    customers: OfflineCustomer[];
    pendingSales: PendingSale[];
    syncLogs: SyncLog[];
    terminalCheckouts: TerminalCheckout[];
    paymentSessions: PaymentSession[];
  }> {
    const [products, customers, pendingSales, syncLogs, terminalCheckouts, paymentSessions] = await Promise.all([
      db.products.toArray(),
      db.customers.toArray(),
      db.pendingSales.toArray(),
      db.syncLogs.toArray(),
      db.terminalCheckouts.toArray(),
      db.paymentSessions.toArray(),
    ]);

    return { products, customers, pendingSales, syncLogs, terminalCheckouts, paymentSessions };
  },
};

export default offlineDb;
