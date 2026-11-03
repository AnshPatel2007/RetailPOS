import type { Product } from '@/types';

type StockProduct = Pick<Product, 'id' | 'stockQuantity'> & Partial<Pick<Product,
  'inventoryProductId' | 'sellingUnitId' | 'unitsPerPackage' | 'baseStockQuantity' | 'looseStockQuantity' | 'trackInventory'>>;

export const inventoryProductId = (product: StockProduct) => product.inventoryProductId || product.id;
export const packageQuantity = (product: StockProduct) => product.sellingUnitId ? Math.max(1, product.unitsPerPackage || 1) : 1;

/** Sealed packages and loose units are physical stock, not interchangeable estimates. */
export function sellingStock(product: StockProduct): number {
  return Math.max(0, product.sellingUnitId ? product.stockQuantity : (product.looseStockQuantity ?? product.stockQuantity));
}

/** Update every cached view of the same inventory after one offline sale line.
 * Cached stock may go negative, mirroring the server: sales are never blocked. */
export function applySellingStockChange<T extends StockProduct>(products: T[], soldId: string, quantityChange: number): T[] {
  const sold = products.find(product => product.id === soldId);
  if (!sold || sold.trackInventory === false) return products;
  const baseId = inventoryProductId(sold), baseChange = quantityChange * packageQuantity(sold);
  return products.map(product => {
    if (inventoryProductId(product) !== baseId) return product;
    const updated = { ...product };
    if (updated.baseStockQuantity !== undefined) updated.baseStockQuantity = updated.baseStockQuantity + baseChange;
    if (!product.sellingUnitId) updated.stockQuantity = product.stockQuantity + baseChange;
    else if (product.id === soldId) updated.stockQuantity = product.stockQuantity + quantityChange;
    if (!sold.sellingUnitId && updated.looseStockQuantity !== undefined) updated.looseStockQuantity = updated.looseStockQuantity + quantityChange;
    return updated;
  });
}
