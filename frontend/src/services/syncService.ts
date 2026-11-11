import { offlineDb, PendingSale } from './offlineDb';
import { saleService, productService, customerService } from './api';
import { useAuthStore } from '../store/authStore';
import { useAdminViewStore } from '../store/adminViewStore';
import { sessionGeneration } from './sessionGeneration';
import { storeContextGeneration } from './storeContextGeneration';
import { isOffline, subscribeConnection } from './connection';

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
  // "Online" means the POS server answers, not just that the computer has a network.
  private isOnline: boolean = !isOffline();
  private isSyncing: boolean = false;
  private syncInterval: number | null = null;
  private listeners: Set<SyncListener> = new Set();
  private state: SyncState = {
    status: 'idle',
    connectionStatus: isOffline() ? 'offline' : 'online',
    pendingSalesCount: 0,
  };

  constructor() {
    this.setupNetworkListeners();
    this.initializeState();
    useAuthStore.subscribe((state, previous) => {
      if (state.user?.id !== previous.user?.id || state.user?.locationId !== previous.user?.locationId) {
        this.updateState({ pendingSalesCount: 0, lastError: undefined, lastSyncTime: undefined, status: 'idle' });
        this.lastCustomerSync = null;
        void this.initializeState();
        // Bring the register's catalog up to date right after sign-in, not on the next timer tick.
        if (state.user && this.isOnline) window.setTimeout(() => { void this.syncAll(); }, 0);
      }
    });
  }

  /** Customers change rarely; the register refreshes its copy at most this often. */
  private static CUSTOMER_REFRESH_MS = 15 * 60 * 1000;
  /** A full catalog download replaces the copy at least this often, as a safety net. */
  private static FULL_CATALOG_MS = 12 * 60 * 60 * 1000;
  private lastCustomerSync: { key: string; at: number } | null = null;

  private async initializeState(): Promise<void> {
    const context = currentCacheScope();
    if (!context) return;
    try {
      const pending = await offlineDb.getPendingSales();
      if (context.isCurrent()) this.updateState({ pendingSalesCount: pending.filter(record => record.userId === context.scope.userId && record.locationId === context.scope.locationId).length });
    } catch { if (context.isCurrent()) this.updateState({ status: 'error', lastError: 'Unable to read saved register transactions.' }); }
  }

  private setupNetworkListeners(): void {
    subscribeConnection(offline => {
      if (offline === !this.isOnline) return;
      this.isOnline = !offline;
      console.log('Server connection: ' + (offline ? 'offline' : 'online'));
      this.updateState({ connectionStatus: offline ? 'offline' : 'online' });
      if (offline) this.stopAutoSync();
      else { this.startAutoSync(); void this.syncAll(); } // send queued sales as soon as the server is back
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

  /** Every page of the store's catalog for these filters, plus the server time and active count of the first page. */
  private async downloadCatalog(params: Record<string, unknown>, isCurrent: () => boolean) {
    const rows: any[] = [];
    let serverTime: string | undefined, activeTotal: number | undefined;
    for (let page = 1; ; page++) {
      const response = await productService.getAll({ ...params, limit: 100, page, includeSellingUnits: true });
      if (!isCurrent()) return null;
      if (page === 1) { serverTime = response.data.serverTime; activeTotal = response.data.activeTotal; }
      const batch = response.data.data;
      rows.push(...batch);
      // Pack rows are appended to each page; only base products count toward the page size.
      if (batch.filter((p: { sellingUnitId?: string | null }) => !p.sellingUnitId).length < 100) break;
    }
    return { rows, serverTime, activeTotal };
  }

  /**
   * Keep the register's copy of the catalog current. Normally only products
   * changed since the last sync are fetched (one small request). The whole
   * catalog is downloaded when there is no copy for this store, the copy is
   * over 12 hours old, or the copy no longer has as many items as the server
   * (a product deleted outright does not show up as a change).
   */
  async cacheProducts(forceFull = false): Promise<void> {
    if (!this.isOnline || !useAuthStore.getState().isAuthenticated || useAdminViewStore.getState().isAdminViewing) {
      console.log('Cannot cache products: offline');
      return;
    }

    const context = currentCacheScope();
    if (!context) return;
    try {
      const state = await offlineDb.getCatalogState();
      const fresh = !forceFull && state?.locationId === context.scope.locationId && !!state.syncedThrough
        && Date.now() - (state.fullAt ?? 0) < SyncService.FULL_CATALOG_MS;
      if (fresh) {
        // Overlap a few seconds so a change saved during the previous sync is not missed.
        const since = new Date(new Date(state!.syncedThrough!).getTime() - 5000).toISOString();
        const delta = await this.downloadCatalog({ updatedSince: since }, context.isCurrent);
        if (!delta) return;
        if (!await offlineDb.applyProductDelta(delta.rows, context.scope, context.isCurrent, delta.serverTime)) return this.cacheProducts(true);
        if (delta.activeTotal === undefined || delta.activeTotal === await offlineDb.countActiveProducts()) {
          if (delta.rows.length) console.log(`Updated ${delta.rows.length} catalog rows`);
          return;
        }
      }
      const full = await this.downloadCatalog({ isActive: true }, context.isCurrent);
      if (!full) return;
      await offlineDb.cacheProducts(full.rows, context.scope, context.isCurrent, full.serverTime);
      console.log(`Cached ${full.rows.length} products`);
    } catch (error) {
      console.error('Failed to cache products:', error);
      throw error;
    }
  }

  async cacheCustomers(force = false): Promise<void> {
    if (!this.isOnline) {
      console.log('Cannot cache customers: offline');
      return;
    }

    const context = currentCacheScope();
    if (!context) return;
    const key = context.scope.userId + ':' + context.scope.locationId;
    if (!force && this.lastCustomerSync?.key === key && Date.now() - this.lastCustomerSync.at < SyncService.CUSTOMER_REFRESH_MS) return;
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
      this.lastCustomerSync = { key, at: Date.now() };
      console.log(`Cached ${customers.length} customers`);
    } catch (error) {
      console.error('Failed to cache customers:', error);
      throw error;
    }
  }

  /** Normal sync: catalog changes and (every 15 minutes) customers. `force` downloads both in full. */
  async cacheAllData(force = false): Promise<void> {
    await Promise.all([
      this.cacheProducts(force),
      this.cacheCustomers(force),
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
