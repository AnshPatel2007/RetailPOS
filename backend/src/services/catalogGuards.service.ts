import { Prisma, Product, ProductSellingUnit } from '@prisma/client';
import type prisma from '../config/database';
import { AuthRequest } from '../types';
import { AppError } from '../utils/errorHandler';
import { SHARED_FIELDS } from './sharedCatalog.service';

/**
 * Store-side guards for items linked to the shared catalog (UPGRADE_PLAN WP 5.3).
 * A linked product takes its shared fields (name, SKU, barcode, selling rules,
 * category) from the catalog item, so a store cannot change them; and while its
 * price follows the shared price, the store cannot set its own. Turning "Follow
 * shared price" on or off is for the owner or a store admin; on, the store price
 * becomes the shared one.
 */

type Db = Prisma.TransactionClient | typeof prisma;
export const SHARED_MESSAGE = 'This is managed in the Shared Catalog.';
export const FOLLOWING_MESSAGE = 'This price follows the shared catalog. Turn off Follow shared price to set a store price.';

const plain = (value: unknown) => {
  if (value === undefined) return undefined;
  if (value === '' || value === null) return null;
  if (value instanceof Prisma.Decimal) return Number(value);
  return typeof value === 'string' ? value.trim() : value;
};
const samePrice = (a: unknown, b: unknown) => Math.round(Number(a) * 10000) === Math.round(Number(b) * 10000);

/** The shared fields a change would alter on this product (pure). */
export function sharedFieldChanges(current: Pick<Product, typeof SHARED_FIELDS[number] | 'categoryId'>, data: Record<string, unknown>) {
  const fields: string[] = [];
  for (const field of [...SHARED_FIELDS, 'categoryId'] as const) {
    if (!(field in data) || data[field] === undefined) continue;
    if (JSON.stringify(plain(data[field])) !== JSON.stringify(plain(current[field]))) fields.push(field);
  }
  return fields;
}

/**
 * Check a store-side change to a product and return it ready to save: refuses shared
 * fields on a linked product and a price set while it follows the shared price;
 * turning Follow on sets the shared price.
 */
export async function guardProductChange(db: Db, req: AuthRequest, current: Product, input: Record<string, unknown>) {
  const data = { ...input };
  const toggling = data.priceFollowsCatalog !== undefined && data.priceFollowsCatalog !== current.priceFollowsCatalog;
  if (current.catalogItemId) {
    const changed = sharedFieldChanges(current, data);
    if (changed.length) throw new AppError(SHARED_MESSAGE, 409, { code: 'SHARED_FIELD', fields: changed });
  }
  if (data.priceFollowsCatalog !== undefined && !current.catalogItemId && data.priceFollowsCatalog) throw new AppError('Only items in the shared catalog can follow a shared price', 400);
  if (toggling) {
    if (req.user?.role !== 'ADMIN') throw new AppError('Only the owner or a store admin changes whether a price follows the shared catalog', 403);
    if (data.priceFollowsCatalog) {
      const item = await db.catalogItem.findUnique({ where: { id: current.catalogItemId! }, select: { defaultPrice: true } });
      if (!item?.defaultPrice) throw new AppError('This item has no shared price yet', 409);
      data.price = Number(item.defaultPrice);
      return data;
    }
  }
  const follows = data.priceFollowsCatalog !== undefined ? !!data.priceFollowsCatalog : current.priceFollowsCatalog;
  if (follows && data.price !== undefined && !samePrice(data.price, current.price)) throw new AppError(FOLLOWING_MESSAGE, 409, { code: 'PRICE_FOLLOWS_CATALOG' });
  return data;
}

/** The same for a store pack linked to a shared pack: its name, SKU and barcode are shared. */
export function guardPackChange(current: ProductSellingUnit, input: { name?: string; sku?: string | null; barcode?: string; price?: number }) {
  if (current.catalogPackId) {
    const changed = (['name', 'sku', 'barcode'] as const).filter(field => input[field] !== undefined && JSON.stringify(plain(input[field])) !== JSON.stringify(plain(current[field])));
    if (changed.length) throw new AppError(SHARED_MESSAGE, 409, { code: 'SHARED_FIELD', fields: changed });
  }
  if (current.priceFollowsCatalog && input.price !== undefined && !samePrice(input.price, current.price)) throw new AppError(FOLLOWING_MESSAGE, 409, { code: 'PRICE_FOLLOWS_CATALOG' });
}
