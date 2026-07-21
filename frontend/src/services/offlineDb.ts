import Dexie, { Table } from 'dexie';

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
  localId: string;  // UUID for tracking
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

// Dexie Database Class
export class POSDatabase extends Dexie {
  products!: Table<OfflineProduct, string>;
  customers!: Table<OfflineCustomer, string>;
  pendingSales!: Table<PendingSale, number>;
  syncLogs!: Table<SyncLog, number>;
  settings!: Table<OfflineSettings, string>;

  constructor() {
    super('POSOfflineDB');

    this.version(1).stores({
      products: 'id, sku, barcode, categoryId, name, syncedAt',
      customers: 'id, phone, email, syncedAt',
      pendingSales: '++id, localId, createdAt, synced, customerId',
      syncLogs: '++id, type, localId, timestamp',
      settings: 'key',
    });
  }
}

// Create database instance
export const db = new POSDatabase();

// Database operations
export const offlineDb = {
  // Products
  async cacheProducts(products: any[]): Promise<void> {
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
      syncedAt: Date.now(),
    }));

    await db.transaction('rw', db.products, async () => {
      await db.products.clear();
      await db.products.bulkPut(offlineProducts);
    });

    await this.setSetting('products_cached_at', Date.now());
    console.log(`Cached ${products.length} products to IndexedDB`);
  },

  async getProducts(): Promise<OfflineProduct[]> {
    return db.products.where('isActive').equals(1).toArray();
  },

  async getAllProducts(): Promise<OfflineProduct[]> {
    return db.products.toArray();
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
        product.stockQuantity = Math.max(0, product.stockQuantity + quantityChange);
      });
  },

  // Customers
  async cacheCustomers(customers: any[]): Promise<void> {
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

    await db.transaction('rw', db.customers, async () => {
      await db.customers.clear();
      await db.customers.bulkPut(offlineCustomers);
    });

    await this.setSetting('customers_cached_at', Date.now());
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
  },

  async getPendingSales(): Promise<PendingSale[]> {
    return db.pendingSales.where('synced').equals(0).toArray();
  },

  async getAllPendingSales(): Promise<PendingSale[]> {
    return db.pendingSales.toArray();
  },

  async getPendingSaleCount(): Promise<number> {
    return db.pendingSales.where('synced').equals(0).count();
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
    return db.pendingSales.where('synced').equals(1).delete();
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
      db.pendingSales.where('synced').equals(0).count(),
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
    await Promise.all([
      db.products.clear(),
      db.customers.clear(),
      db.pendingSales.clear(),
      db.syncLogs.clear(),
      db.settings.clear(),
    ]);
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
  }> {
    const [products, customers, pendingSales, syncLogs] = await Promise.all([
      db.products.toArray(),
      db.customers.toArray(),
      db.pendingSales.toArray(),
      db.syncLogs.toArray(),
    ]);

    return { products, customers, pendingSales, syncLogs };
  },
};

export default offlineDb;
