import { offlineDb, type OfflineCacheScope, type OfflineProduct } from './offlineDb';
import { barcodeKey } from '@/lib/barcode';
import type { Product } from '@/types';

/**
 * The register's on-device product lookup. Scans are answered from the cached
 * catalog (kept current by syncService) without a network request, so they are
 * instant and keep working offline. The server still re-prices every sale at
 * checkout, so a price changed seconds ago can never be charged from a stale copy.
 */

export type LookupResult =
  | { kind: 'one'; product: Product }
  | { kind: 'many'; products: Product[] }
  | { kind: 'none' }
  /** No usable copy for this store yet (first sign-in, storage blocked). */
  | { kind: 'unavailable' };

interface Index { locationId: string; version: string | undefined; byBarcode: Map<string, OfflineProduct[]>; bySku: Map<string, OfflineProduct[]>; rows: OfflineProduct[] }

let current: Promise<Index | null> | null = null;
let currentKey = '';

const add = (map: Map<string, OfflineProduct[]>, key: string, row: OfflineProduct) => {
  const list = map.get(key);
  if (list) list.push(row); else map.set(key, [row]);
};

async function build(scope: OfflineCacheScope, version: string | undefined): Promise<Index | null> {
  const rows = (await offlineDb.getAllProducts(scope)).filter(row => row.isActive && row.sku !== 'MISC-001');
  if (!rows.length) return null;
  const byBarcode = new Map<string, OfflineProduct[]>(), bySku = new Map<string, OfflineProduct[]>();
  for (const row of rows) {
    if (row.barcode) add(byBarcode, barcodeKey(row.barcode), row);
    if (row.sku) add(bySku, row.sku.trim().toLowerCase(), row);
  }
  return { locationId: scope.locationId, version, byBarcode, bySku, rows };
}

/** The index for this store, rebuilt only when the cached catalog changed. */
async function index(scope: OfflineCacheScope): Promise<Index | null> {
  const state = await offlineDb.getCatalogState();
  if (state?.locationId !== scope.locationId) return null;
  const key = scope.locationId + ':' + (state.version ?? state.cachedAt);
  if (!current || key !== currentKey) {
    currentKey = key;
    current = build(scope, state.version).catch(() => null);
  }
  return current;
}

/** Build the index ahead of the first scan (after sign-in or a sync). */
export function warmRegisterCatalog(scope: OfflineCacheScope) {
  void index(scope).catch(() => undefined);
}

export function toRegisterProduct(row: OfflineProduct): Product {
  return {
    id: row.id, sku: row.sku, name: row.name, description: row.description ?? null,
    categoryId: row.categoryId ?? null,
    category: row.categoryName ? { id: row.categoryId || '', name: row.categoryName, description: null, color: null, icon: null, isActive: true } : undefined,
    cost: Number(row.cost) || 0, price: Number(row.price), compareAtPrice: null,
    trackInventory: row.trackInventory ?? true, stockQuantity: row.stockQuantity, stockVersion: row.stockVersion ?? 0,
    lowStockAlert: row.lowStockAlert, barcode: row.barcode ?? null, image: row.image ?? null,
    isActive: row.isActive, isTaxable: row.isTaxable, allowBackorder: false,
    saleBlockedReason: row.saleBlockedReason ?? null, minimumAge: row.minimumAge ?? null,
    ebtEligible: row.ebtEligible ?? false, priceEmbedded: row.priceEmbedded ?? false,
    inventoryProductId: row.inventoryProductId, sellingUnitId: row.sellingUnitId, unitsPerPackage: row.unitsPerPackage,
    createdAt: '', updatedAt: row.updatedAt ?? '',
  };
}

const result = (rows: OfflineProduct[] | undefined): LookupResult | null =>
  !rows?.length ? null : rows.length === 1 ? { kind: 'one', product: toRegisterProduct(rows[0]) } : { kind: 'many', products: rows.map(toRegisterProduct) };

/** A scanned code: exact barcode (UPC/EAN forms match each other), then an exact SKU. */
export async function lookupScan(code: string, scope: OfflineCacheScope): Promise<LookupResult> {
  try {
    const found = await index(scope);
    if (!found) return { kind: 'unavailable' };
    return result(found.byBarcode.get(barcodeKey(code))) ?? result(found.bySku.get(code.trim().toLowerCase())) ?? { kind: 'none' };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** A scale or deli label: the price-embedded product its item code belongs to. */
export async function lookupPriceEmbedded(itemCode: string, fullCode: string, scope: OfflineCacheScope): Promise<LookupResult> {
  try {
    const found = await index(scope);
    if (!found) return { kind: 'unavailable' };
    const rows = found.rows.filter(row => row.priceEmbedded && (row.barcode === itemCode || row.sku === itemCode || row.barcode === fullCode));
    return result(rows) ?? { kind: 'none' };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** Every cached product for this store (for searching while offline). */
export async function cachedProducts(scope: OfflineCacheScope): Promise<Product[]> {
  const found = await index(scope);
  return found ? found.rows.map(toRegisterProduct) : [];
}

/** Keep products the server found for a scan, so the next scan of them is local. */
export async function rememberProducts(products: Product[], scope: OfflineCacheScope, isCurrent: () => boolean) {
  if (!products.length) return;
  try { await offlineDb.applyProductDelta(products, scope, isCurrent); } catch { /* the next sync brings them anyway */ }
}
