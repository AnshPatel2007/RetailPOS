/**
 * The shared catalog (backend services/sharedCatalog*.service.ts): one list of items an
 * owner manages for every store of the business. Each store keeps its own stock, cost
 * and price; a store's price may follow the shared price.
 */

export interface CatalogStore { id: string; name: string; isActive: boolean }

/** The fields a shared item gives every store that carries it. */
export interface SharedFields {
  name: string; sku: string; barcode: string | null; description: string | null; brand: string | null; productFamily: string | null;
  variant: string | null; size: string | null; baseUnitName: string; isTaxable: boolean; minimumAge: number | null; ebtEligible: boolean;
  priceEmbedded: boolean; saleBlockedReason: string | null; categoryName: string | null;
}

export interface CatalogPack {
  id: string; name: string; sku: string | null; barcode: string; unitsPerPackage: number; defaultPrice: number | null; isActive: boolean; version: number;
}

/** One store's own product for a shared item. */
export interface CatalogListing {
  locationId: string; storeName: string; productId: string; price: number; priceFollowsCatalog: boolean; stockQuantity: number; isActive: boolean;
}

export interface CatalogItem extends SharedFields {
  id: string; defaultPrice: number | null; isActive: boolean; version: number;
  packs: CatalogPack[];
  listings: CatalogListing[];
  missingStores: { locationId: string; storeName: string }[];
}

export interface CatalogList {
  stores: CatalogStore[];
  /** Items in the business's stores that are not in the shared catalog yet. */
  unlinkedProducts: number;
  items: CatalogItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export type LinkField = keyof SharedFields | 'price';

/** The same item found in several stores (or a store's item that matches a shared item). */
export interface LinkGroup {
  match: 'BARCODE' | 'SKU_NAME';
  existingCatalogItemId: string | null;
  existingName: string | null;
  shared: SharedFields;
  fingerprint: string;
  /** Why this group cannot be linked as it is (it is shown, never applied). */
  problem: string | null;
  differences: { field: LinkField; label: string; shared: unknown; stores: { locationId: string; storeName: string; value: unknown }[] }[];
  members: { productId: string; locationId: string; storeName: string; name: string; sku: string; barcode: string | null; price: number; stockQuantity: number;
    packs: { id: string; name: string; barcode: string; unitsPerPackage: number; price: number }[] }[];
}

export interface LinkPreview { primaryLocationId: string; stores: CatalogStore[]; unlinkedProducts: number; groups: LinkGroup[] }

export interface LinkResult { linked: number; products: number; items: { catalogItemId: string; name: string; productIds: string[]; joined: boolean }[] }

/** FOLLOWING: stores that follow the shared price; ALL or named stores also start following it. */
export type PriceApply = 'FOLLOWING' | 'ALL' | { locationIds: string[] };

/** Only the fields that change; an emptied optional field is null. */
export type CatalogFieldsPatch = Partial<SharedFields>;
