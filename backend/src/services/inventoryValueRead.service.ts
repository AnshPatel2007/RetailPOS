import { Prisma } from '@prisma/client';

/** Supplier prices describe purchases, never the value of stock already held. */
export async function valueProducts<T extends { id: string; stockQuantity: number; trackInventory?: boolean }>(db: Pick<Prisma.TransactionClient, 'inventoryValuation'>, products: T[]) {
  const balances = await db.inventoryValuation.findMany({ where: { productId: { in: products.map(p => p.id) } } });
  const byId = new Map(balances.map(v => [v.productId, v]));
  return products.map(product => {
    const balance = byId.get(product.id);
    const inventoryValue = product.trackInventory === false || product.stockQuantity === 0 ? 0 : balance?.value == null ? null : Number(balance.value);
    return { ...product, inventoryValue, averageCost: inventoryValue === null || !product.stockQuantity ? null : Number(balance?.value?.div(product.stockQuantity) || 0) };
  });
}
export const sumInventoryValue = (products: { inventoryValue: number | null }[]) => products.some(p => p.inventoryValue === null) ? null
  : Math.round((products.reduce((sum, p) => sum + (p.inventoryValue || 0), 0) + Number.EPSILON) * 100) / 100;
