import { v4 as uuidv4 } from 'uuid';
import { offlineDb, PendingSale, PendingSaleItem } from './offlineDb';
import { saleService, productService, customerService } from './api';

type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';
type ConnectionStatus = 'online' | 'offline';

interface SyncState {
  status: SyncStatus;
  connectionStatus: ConnectionStatus;
  pendingSalesCount: number;
  lastSyncTime?: number;
  lastError?: string;
}

type SyncListener = (state: SyncState) => void;

class SyncService {
  private isOnline: boolean = navigator.onLine;
  private isSyncing: boolean = false;
  private syncInterval: number | null = null;
  private listeners: Set<SyncListener> = new Set();
  private state: SyncState = {
    status: 'idle',
    connectionStatus: navigator.onLine ? 'online' : 'offline',
    pendingSalesCount: 0,
  };

  constructor() {
    this.setupNetworkListeners();
    this.initializeState();
  }

  private async initializeState(): Promise<void> {
    const pendingSalesCount = await offlineDb.getPendingSaleCount();
    this.updateState({ pendingSalesCount });
  }

  private setupNetworkListeners(): void {
    window.addEventListener('online', () => {
      console.log('Network status: online');
      this.isOnline = true;
      this.updateState({ connectionStatus: 'online' });
      this.startAutoSync();
      this.syncAll(); // Trigger immediate sync
    });

    window.addEventListener('offline', () => {
      console.log('Network status: offline');
      this.isOnline = false;
      this.updateState({ connectionStatus: 'offline' });
      this.stopAutoSync();
    });

    // Initial check
    if (this.isOnline) {
      this.startAutoSync();
    }
  }

  // State management
  private updateState(partial: Partial<SyncState>): void {
    this.state = { ...this.state, ...partial };
    this.notifyListeners();
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.state));
  }

  subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    listener(this.state); // Send current state immediately
    return () => this.listeners.delete(listener);
  }

  getState(): SyncState {
    return { ...this.state };
  }

  // Auto sync management
  startAutoSync(intervalMs: number = 30000): void {
    if (this.syncInterval) return;

    this.syncInterval = window.setInterval(() => {
      if (this.isOnline && !this.isSyncing) {
        this.syncAll();
      }
    }, intervalMs);

    console.log(`Auto-sync started (every ${intervalMs / 1000}s)`);
  }

  stopAutoSync(): void {
    if (this.syncInterval) {
      window.clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('Auto-sync stopped');
    }
  }

  // Cache data from server
  async cacheProducts(): Promise<void> {
    if (!this.isOnline) {
      console.log('Cannot cache products: offline');
      return;
    }

    try {
      const response = await productService.getAll({ limit: 1000, isActive: true });
      const products = response.data.data;
      await offlineDb.cacheProducts(products);
      console.log(`Cached ${products.length} products`);
    } catch (error) {
      console.error('Failed to cache products:', error);
      throw error;
    }
  }

  async cacheCustomers(): Promise<void> {
    if (!this.isOnline) {
      console.log('Cannot cache customers: offline');
      return;
    }

    try {
      const response = await customerService.getAll({ limit: 1000 });
      const customers = response.data.data;
      await offlineDb.cacheCustomers(customers);
      console.log(`Cached ${customers.length} customers`);
    } catch (error) {
      console.error('Failed to cache customers:', error);
      throw error;
    }
  }

  async cacheAllData(): Promise<void> {
    await Promise.all([
      this.cacheProducts(),
      this.cacheCustomers(),
    ]);
  }

  // Create offline sale
  async createOfflineSale(saleData: {
    customerId?: string;
    items: Array<{
      productId: string;
      sku: string;
      productName: string;
      quantity: number;
      price: number;
      discount: number;
      isTaxable?: boolean;
    }>;
    paymentMethod: string;
    amountPaid: number;
    notes?: string;
    taxRate?: number; // fraction, e.g. 0.0825
  }): Promise<PendingSale> {
    const taxRate = saleData.taxRate ?? 0.0825; // Default 8.25% tax

    // Calculate totals
    let subtotal = 0;
    let totalDiscount = 0;
    let totalTax = 0;

    const items: PendingSaleItem[] = saleData.items.map(item => {
      const itemSubtotal = item.price * item.quantity;
      const itemDiscount = item.discount || 0;
      const taxableAmount = itemSubtotal - itemDiscount;
      // Non-taxable items (isTaxable === false) carry no tax
      const itemTax = item.isTaxable === false ? 0 : taxableAmount * taxRate;
      const itemTotal = taxableAmount + itemTax;

      subtotal += itemSubtotal;
      totalDiscount += itemDiscount;
      totalTax += itemTax;

      return {
        productId: item.productId,
        sku: item.sku,
        productName: item.productName,
        quantity: item.quantity,
        price: item.price,
        discount: itemDiscount,
        tax: itemTax,
        total: itemTotal,
        isTaxable: item.isTaxable,
      };
    });

    const total = subtotal - totalDiscount + totalTax;
    const changeDue = saleData.amountPaid - total;

    const pendingSale: Omit<PendingSale, 'id'> = {
      localId: uuidv4(),
      customerId: saleData.customerId,
      items,
      subtotal,
      tax: totalTax,
      discount: totalDiscount,
      total,
      paymentMethod: saleData.paymentMethod,
      amountPaid: saleData.amountPaid,
      changeDue: Math.max(0, changeDue),
      notes: saleData.notes,
      createdAt: Date.now(),
      synced: false,
      syncAttempts: 0,
    };

    const id = await offlineDb.savePendingSale(pendingSale);
    const savedSale = { ...pendingSale, id };

    // Update state
    const pendingSalesCount = await offlineDb.getPendingSaleCount();
    this.updateState({ pendingSalesCount });

    // Try to sync immediately if online
    if (this.isOnline) {
      this.syncSale(savedSale);
    }

    return savedSale;
  }

  // Sync single sale
  private async syncSale(sale: PendingSale): Promise<boolean> {
    if (!sale.id) return false;

    try {
      // Transform to API format. The localId doubles as the idempotency key so
      // a retry after an ambiguous failure can't create a duplicate sale.
      const apiSale = {
        idempotencyKey: sale.localId,
        customerId: sale.customerId,
        items: sale.items.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
          price: item.price,
          discount: item.discount,
        })),
        paymentMethod: sale.paymentMethod,
        amountPaid: sale.amountPaid,
        notes: sale.notes,
        offlineCreatedAt: new Date(sale.createdAt).toISOString(),
      };

      const response = await saleService.create(apiSale);
      const serverId = response.data.data.id;

      await offlineDb.markSaleAsSynced(sale.id, serverId);
      await offlineDb.addSyncLog({
        type: 'sale',
        action: 'sync',
        localId: sale.localId,
        serverId,
        timestamp: Date.now(),
        success: true,
      });

      console.log(`Sale synced: ${sale.localId} -> ${serverId}`);
      return true;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || error.message || 'Unknown error';
      await offlineDb.markSaleSyncFailed(sale.id, errorMessage);
      await offlineDb.addSyncLog({
        type: 'sale',
        action: 'sync',
        localId: sale.localId,
        timestamp: Date.now(),
        success: false,
        error: errorMessage,
      });

      console.error(`Failed to sync sale ${sale.localId}:`, errorMessage);
      return false;
    }
  }

  // Sync all pending sales
  async syncPendingSales(): Promise<{ synced: number; failed: number }> {
    const pendingSales = await offlineDb.getPendingSales();

    if (pendingSales.length === 0) {
      return { synced: 0, failed: 0 };
    }

    console.log(`Syncing ${pendingSales.length} pending sales...`);

    let synced = 0;
    let failed = 0;

    // Sort by created time (oldest first)
    pendingSales.sort((a, b) => a.createdAt - b.createdAt);

    for (const sale of pendingSales) {
      // Skip sales with too many failed attempts
      if (sale.syncAttempts >= 5) {
        console.warn(`Skipping sale ${sale.localId}: too many failed attempts`);
        failed++;
        continue;
      }

      const success = await this.syncSale(sale);
      if (success) {
        synced++;
      } else {
        failed++;
      }

      // Small delay between syncs to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Update state
    const pendingSalesCount = await offlineDb.getPendingSaleCount();
    this.updateState({ pendingSalesCount });

    return { synced, failed };
  }

  // Full sync
  async syncAll(): Promise<void> {
    if (!this.isOnline || this.isSyncing) {
      return;
    }

    this.isSyncing = true;
    this.updateState({ status: 'syncing' });

    try {
      // Sync pending sales
      const result = await this.syncPendingSales();

      // Refresh cache
      await this.cacheAllData();

      // Clean up old sync logs
      await offlineDb.clearOldSyncLogs(7);

      // Delete synced sales older than 24 hours
      await offlineDb.deleteSyncedSales();

      this.updateState({
        status: 'success',
        lastSyncTime: Date.now(),
        lastError: undefined,
      });

      console.log(`Sync complete: ${result.synced} synced, ${result.failed} failed`);
    } catch (error: any) {
      const errorMessage = error.message || 'Sync failed';
      this.updateState({
        status: 'error',
        lastError: errorMessage,
      });
      console.error('Sync failed:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  // Manual sync trigger
  async manualSync(): Promise<void> {
    if (!this.isOnline) {
      throw new Error('Cannot sync while offline');
    }
    await this.syncAll();
  }

  // Check if we can process sales offline
  canProcessOffline(): boolean {
    return true; // IndexedDB is always available
  }

  // Get sync statistics
  async getStats() {
    return offlineDb.getStats();
  }
}

// Export singleton instance
export const syncService = new SyncService();

// Also export for direct use
export default syncService;
