import type { CartItem, Product } from '@/types';

type StockProduct = Pick<Product, 'id' | 'stockQuantity'> & Partial<Pick<Product,
  'inventoryProductId' | 'sellingUnitId' | 'unitsPerPackage' | 'baseStockQuantity' | 'looseStockQuantity' | 'trackInventory'>>;

export const inventoryProductId = (product: StockProduct) => product.inventoryProductId || product.id;
export const packageQuantity = (product: StockProduct) => product.sellingUnitId ? Math.max(1, product.unitsPerPackage || 1) : 1;

/** Sealed packages and loose units are physical stock, not interchangeable estimates. */
export function sellingStock(product: StockProduct): number {
  return Math.max(0, product.sellingUnitId ? product.stockQuantity : (product.looseStockQuantity ?? product.stockQuantity));
}

/** Maximum total for this cart line, accounting for every other selling format. */
export function maxCartQuantity(product: StockProduct, items: Pick<CartItem, 'product' | 'quantity'>[]): number {
  if (product.trackInventory === false) return Number.MAX_SAFE_INTEGER;
  const related = items.filter(item => inventoryProductId(item.product) === inventoryProductId(product));
  const totalStock = Math.min(...[product, ...related.map(item => item.product)].map(item =>
    item.baseStockQuantity ?? (item.sellingUnitId ? Number.MAX_SAFE_INTEGER : item.stockQuantity)));
  const usedByOthers = related.filter(item => item.product.id !== product.id)
    .reduce((sum, item) => sum + item.quantity * packageQuantity(item.product), 0);
  return Math.max(0, Math.min(sellingStock(product), Math.floor((totalStock - usedByOthers) / packageQuantity(product))));
}

/** Update every cached view of the same inventory after one offline sale line. */
export function applySellingStockChange<T extends StockProduct>(products: T[], soldId: string, quantityChange: number): T[] {
  const sold = products.find(product => product.id === soldId);
  if (!sold || sold.trackInventory === false) return products;
  const baseId = inventoryProductId(sold), baseChange = quantityChange * packageQuantity(sold);
  return products.map(product => {
    if (inventoryProductId(product) !== baseId) return product;
    const updated = { ...product };
    if (updated.baseStockQuantity !== undefined) updated.baseStockQuantity = Math.max(0, updated.baseStockQuantity + baseChange);
    if (!product.sellingUnitId) updated.stockQuantity = Math.max(0, product.stockQuantity + baseChange);
    else if (product.id === soldId) updated.stockQuantity = Math.max(0, product.stockQuantity + quantityChange);
    if (!sold.sellingUnitId && updated.looseStockQuantity !== undefined) updated.looseStockQuantity = Math.max(0, updated.looseStockQuantity + quantityChange);
    return updated;
  });
}
