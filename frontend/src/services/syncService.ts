import { offlineDb, PendingSale } from './offlineDb';
import { saleService, productService, customerService } from './api';
import { useAuthStore } from '../store/authStore';
import { useAdminViewStore } from '../store/adminViewStore';
import { sessionGeneration } from './sessionGeneration';
import { storeContextGeneration } from './storeContextGeneration';

function currentCacheScope() {
  const user = useAuthStore.getState().user;
  if (!user?.locationId || user.role === 'SUPER_ADMIN' || useAdminViewStore.getState().isAdminViewing) return null;
  const session = sessionGeneration(), store = storeContextGeneration();
  return { scope: { userId: user.id, locationId: user.locationId },
    isCurrent: () => session === sessionGeneration() && store === storeContextGeneration() && useAuthStore.getState().user?.id === user.id };
}

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
    useAuthStore.subscribe((state, previous) => {
      if (state.user?.id !== previous.user?.id || state.user?.locationId !== previous.user?.locationId) {
        this.updateState({ pendingSalesCount: 0, lastError: undefined, lastSyncTime: undefined, status: 'idle' });
        void this.initializeState();
      }
    });
  }

  private async initializeState(): Promise<void> {
    const context = currentCacheScope();
    if (!context) return;
    try {
      const pending = await offlineDb.getPendingSales();
      if (context.isCurrent()) this.updateState({ pendingSalesCount: pending.filter(record => record.userId === context.scope.userId && record.locationId === context.scope.locationId).length });
    } catch { if (context.isCurrent()) this.updateState({ status: 'error', lastError: 'Unable to read saved register transactions.' }); }
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
    if (!this.isOnline || !useAuthStore.getState().isAuthenticated || useAdminViewStore.getState().isAdminViewing) {
      console.log('Cannot cache products: offline');
      return;
    }

    const context = currentCacheScope();
    if (!context) return;
    try {
      const products: any[] = [];
      for (let page = 1; ; page++) {
        const response = await productService.getAll({ limit: 100, page, isActive: true });
        if (!context.isCurrent()) return;
        const batch = response.data.data;
        products.push(...batch);
        if (batch.length < 100) break;
      }
      await offlineDb.cacheProducts(products, context.scope, context.isCurrent);
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

    const context = currentCacheScope();
    if (!context) return;
    try {
      const customers: any[] = [];
      for (let page = 1; ; page++) {
        const response = await customerService.getAll({ limit: 100, page });
        if (!context.isCurrent()) return;
        const batch = response.data.data;
        customers.push(...batch);
        if (batch.length < 100) break;
      }
      await offlineDb.cacheCustomers(customers, context.scope, context.isCurrent);
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

  // Preserve the exact checkout payload, cashier, shift and original timestamp.
  async queueCheckout(data: { payload: Record<string, any>; userId: string; locationId: string; shiftId: string; createdAt: number; originalReceipt?: Record<string, any>; snapshot: { subtotal: number; tax: number; discount: number }; expectedTotal: number }): Promise<PendingSale> {
    const { payload, expectedTotal } = data;
    if (payload.paymentMethod !== 'CASH' || payload.payments?.some((p: any) => p.paymentMethod !== 'CASH') || payload.pointsRedeemed) {
      throw new Error('Offline checkout supports cash only without loyalty redemption');
    }
    const pending: Omit<PendingSale, 'id'> = {
      localId: payload.idempotencyKey, userId: data.userId, locationId: data.locationId,
      originalReceipt: data.originalReceipt,
      payload: { ...payload, offlineCreatedAt: new Date(data.createdAt).toISOString(), offlineShiftId: data.shiftId, expectedTotal },
      customerId: payload.customerId, items: payload.items, ...data.snapshot,
      total: expectedTotal, paymentMethod: 'CASH', amountPaid: payload.amountPaid,
      changeDue: Math.max(0, payload.amountPaid - expectedTotal), notes: payload.notes,
      createdAt: data.createdAt, synced: false, syncAttempts: 0,
    };
    const id = await offlineDb.savePendingSale(pending);
    await this.initializeState();
    return { ...pending, id };
  }

  // Sync single sale
  private async syncSale(sale: PendingSale): Promise<boolean> {
    if (!sale.id) return false;

    const user = useAuthStore.getState().user;
    // A different login must not consume retries or change the attribution.
    if (!user || user.id !== sale.userId || user.locationId !== sale.locationId) return false;
    try {
      if (!sale.payload) throw new Error('Legacy queued sale needs manual reconciliation; checkout details are missing');
      const apiSale = sale.payload;
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
      // Changing cashier cancels a request; retain its exact retry key and budget.
      if (error.code === 'ERR_CANCELED') return false;
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
    const context = currentCacheScope();
    if (!context) return { synced: 0, failed: 0 };
    const pendingSales = (await offlineDb.getPendingSales()).filter(record => record.userId === context.scope.userId && record.locationId === context.scope.locationId && record.reconciliation?.status !== 'HOLD');

    if (pendingSales.length === 0) {
      return { synced: 0, failed: 0 };
    }

    console.log(`Syncing ${pendingSales.length} pending sales...`);

    let synced = 0;
    let failed = 0;

    // Sort by created time (oldest first)
    pendingSales.sort((a, b) => a.createdAt - b.createdAt);

    for (const sale of pendingSales) {
      if (!context.isCurrent()) break;
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
    await this.initializeState();

    return { synced, failed };
  }

  // Full sync
  async syncAll(): Promise<void> {
    if (!this.isOnline || this.isSyncing || !useAuthStore.getState().isAuthenticated || useAdminViewStore.getState().isAdminViewing) {
      return;
    }

    const context = currentCacheScope();
    if (!context) return;
    this.isSyncing = true;
    this.updateState({ status: 'syncing' });

    try {
      // Sync pending sales
      const result = await this.syncPendingSales();
      if (!context.isCurrent()) return;

      // Refresh cache
      await this.cacheAllData();
      if (!context.isCurrent()) return;

      // Clean up old sync logs
      await offlineDb.clearOldSyncLogs(7);

      // Delete synced sales older than 24 hours
      await offlineDb.deleteSyncedSales();
      if (!context.isCurrent()) return;

      this.updateState({
        status: result.failed ? 'error' : 'success',
        lastSyncTime: Date.now(),
        lastError: result.failed ? 'Some sales remain queued. Sign in as the original cashier and retry, or review the sync log.' : undefined,
      });

      console.log(`Sync complete: ${result.synced} synced, ${result.failed} failed`);
    } catch (error: any) {
      if (!context.isCurrent()) return;
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
    const user = useAuthStore.getState().user;
    for (const sale of await offlineDb.getPendingSales()) {
      if (sale.userId === user?.id && sale.locationId === user?.locationId && sale.id) {
        await offlineDb.resetSaleAttempts(sale.id);
      }
    }
    await this.syncAll();
  }

  // Check if we can process sales offline
  canProcessOffline(): boolean {
    return typeof indexedDB !== 'undefined';
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
