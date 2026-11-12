import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../config/database';

/**
 * Shelf labels that no longer show the price. The products_price_changed and
 * product_selling_units_price_changed triggers stamp `priceChangedAt` on every
 * price change, whatever wrote it; printing a label stamps `labelPrintedAt`.
 * An active item or pack is listed while its price changed after its last label.
 */
type Db = Prisma.TransactionClient | typeof prisma;
const SHOWN = 500;

async function pendingIds(db: Db, locationId: string) {
  const [products, packs] = await Promise.all([
    db.$queryRaw<{ id: string }[]>`SELECT id FROM "products"
      WHERE "locationId" = ${locationId} AND "isActive" AND sku <> 'MISC-001' AND "priceChangedAt" IS NOT NULL
        AND ("labelPrintedAt" IS NULL OR "labelPrintedAt" < "priceChangedAt")`,
    db.$queryRaw<{ id: string }[]>`SELECT u.id FROM "product_selling_units" u JOIN "products" p ON p.id = u."productId"
      WHERE u."locationId" = ${locationId} AND u."isActive" AND p."isActive" AND u."priceChangedAt" IS NOT NULL
        AND (u."labelPrintedAt" IS NULL OR u."labelPrintedAt" < u."priceChangedAt")`,
  ]);
  return { products: products.map(row => row.id), packs: packs.map(row => row.id) };
}

export async function countPendingLabels(db: Db, locationId: string) {
  const ids = await pendingIds(db, locationId);
  return ids.products.length + ids.packs.length;
}

/** Newest price change first. `priceChangedAt` goes back with POST /labels/printed. */
export async function listPendingLabels(db: Db, locationId: string) {
  const ids = await pendingIds(db, locationId);
  const [products, packs] = await Promise.all([
    db.product.findMany({ where: { id: { in: ids.products } }, select: { id: true, name: true, sku: true, barcode: true, price: true, priceChangedAt: true } }),
    db.productSellingUnit.findMany({ where: { id: { in: ids.packs } },
      select: { id: true, name: true, sku: true, barcode: true, price: true, priceChangedAt: true, productId: true, product: { select: { name: true } } } }),
  ]);
  const items = [
    ...products.map(product => ({ kind: 'PRODUCT' as const, id: product.id, productId: product.id, sellingUnitId: null as string | null,
      name: product.name, sku: product.sku, barcode: product.barcode, price: Number(product.price), priceChangedAt: product.priceChangedAt! })),
    // Packs read like the register shows them: "Cola Can (12-pack)".
    ...packs.map(pack => ({ kind: 'PACK' as const, id: pack.id, productId: pack.productId, sellingUnitId: pack.id as string | null,
      name: pack.name.toLowerCase().includes(pack.product.name.toLowerCase()) ? pack.name : `${pack.product.name} (${pack.name})`,
      sku: pack.sku || pack.barcode, barcode: pack.barcode as string | null, price: Number(pack.price), priceChangedAt: pack.priceChangedAt! })),
  ].sort((a, b) => b.priceChangedAt.getTime() - a.priceChangedAt.getTime() || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { items: items.slice(0, SHOWN), total: items.length };
}

const printed = z.object({ id: z.string().min(1).max(100), priceChangedAt: z.string().datetime() });
const printedBody = z.object({
  products: z.array(printed).max(1000).default([]),
  sellingUnits: z.array(printed).max(1000).default([]),
}).refine(body => body.products.length + body.sellingUnits.length > 0, { message: 'Choose the labels that printed' });
// The column holds UTC without a zone; compare like with like whatever the session time zone is.
const utc = (iso: string) => new Date(iso).toISOString().replace('Z', '');

/**
 * Marks labels printed for the prices they were printed with: an item whose
 * price changed again after the list was read stays on the list.
 */
export async function markLabelsPrinted(locationId: string, userId: string, body: unknown) {
  const input = printedBody.parse(body);
  return prisma.$transaction(async tx => {
    let marked = 0;
    for (const item of input.products) marked += await tx.$executeRaw`UPDATE "products"
      SET "labelPrintedAt" = GREATEST(now() AT TIME ZONE 'UTC', "priceChangedAt")
      WHERE id = ${item.id} AND "locationId" = ${locationId} AND "priceChangedAt" <= ${utc(item.priceChangedAt)}::timestamp(3)`;
    for (const item of input.sellingUnits) marked += await tx.$executeRaw`UPDATE "product_selling_units"
      SET "labelPrintedAt" = GREATEST(now() AT TIME ZONE 'UTC', "priceChangedAt")
      WHERE id = ${item.id} AND "locationId" = ${locationId} AND "priceChangedAt" <= ${utc(item.priceChangedAt)}::timestamp(3)`;
    await tx.activityLog.create({ data: { userId, locationId, action: 'SHELF_LABELS_PRINTED', entity: 'PRODUCT', details: { marked } } });
    return { marked };
  });
}
