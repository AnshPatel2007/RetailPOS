import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { AppError } from '../utils/errorHandler';
import { barcodeKey, barcodeVariants } from '../utils/barcode';
import { lineMoney } from '../utils/moneyNumbers';
import { assertSellingIdentifiersAvailable } from './productSellingUnit.service';
import {
  categoryIdFor, itemSelect, itemValues, linkPacks, listItemSelect, lockCatalog, matchProduct, memberSelect, ownerContext, presentItem,
} from './sharedCatalog.service';

/**
 * Shared catalog, changing items (UPGRADE_PLAN WP 5.2): an owner edits an item once
 * and every store that carries it changes with it; sets a shared price for the stores
 * that follow it (or all, or some); adds the item to another store; links or unlinks a
 * store's item; and manages the item's packs. Every change is all or nothing: a clash
 * in one store (an SKU or barcode it already uses) refuses the whole change and names
 * the store. Variety-pack contents stay per store.
 */

type Context = Awaited<ReturnType<typeof ownerContext>>;
const money = z.number().finite().gt(0).max(1_000_000);
const recordId = z.string().trim().min(1).max(100);
const blank = <T extends z.ZodTypeAny>(schema: T) => schema.nullable().optional()
  .transform((value: z.infer<T> | null | undefined) => value === undefined ? undefined : value === '' ? null : value);
const text = (max: number) => blank(z.string().trim().max(max));

const fieldsSchema = z.object({
  name: z.string().trim().min(1).max(250).optional(),
  sku: z.string().trim().min(1).max(100).optional(),
  barcode: text(100),
  description: text(2000),
  brand: text(100), productFamily: text(100), variant: text(100), size: text(100),
  baseUnitName: z.string().trim().min(1).max(40).optional(),
  categoryName: text(100),
  isTaxable: z.boolean().optional(),
  minimumAge: z.number().int().min(1).max(99).nullable().optional(),
  ebtEligible: z.boolean().optional(),
  priceEmbedded: z.boolean().optional(),
  saleBlockedReason: blank(z.string().trim().min(3).max(200)),
}).strict();
type Fields = z.infer<typeof fieldsSchema>;

const storeNameOf = (context: Context, id: string | null) => context.stores.find(store => store.id === id)?.name ?? 'A store';

/** The usual SKU and barcode check, with the store named; a clash refuses the whole change. */
async function checkIdentifiers(tx: Prisma.TransactionClient, storeName: string, input: Parameters<typeof assertSellingIdentifiersAvailable>[1]) {
  try {
    await assertSellingIdentifiersAvailable(tx, input);
  } catch (error) {
    if (error instanceof AppError) throw new AppError(`${storeName}: ${error.message.replace(' in this store', '')}. Nothing was changed.`, error.statusCode, error.details);
    throw error;
  }
}

/** One catalog change in one transaction, serialized per business; database clashes come back as a plain 409. */
async function catalogWrite<T>(context: Context, change: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async tx => {
    await lockCatalog(tx, context.organizationId);
    return change(tx);
  }, { timeout: 30000 }).catch(error => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError('An SKU or barcode changed while saving. Try again.', 409);
    throw error;
  });
}

async function loadItem(tx: Prisma.TransactionClient, context: Context, id: string) {
  const item = await tx.catalogItem.findFirst({ where: { id, organizationId: context.organizationId },
    select: { ...itemSelect, products: { select: { ...memberSelect, priceFollowsCatalog: true } } } });
  if (!item) throw new AppError('Shared item not found', 404);
  return item;
}
const checkVersion = (current: number, expected: number) => {
  if (current !== expected) throw new AppError('Someone else changed this item. Reload it to see their changes.', 409);
};
const present = async (tx: Prisma.TransactionClient, context: Context, id: string) =>
  presentItem(await tx.catalogItem.findUniqueOrThrow({ where: { id }, select: listItemSelect }), context.stores);
const log = (tx: Prisma.TransactionClient, req: AuthRequest, locationId: string | null, action: string, entityId: string, details: Prisma.InputJsonValue) =>
  tx.activityLog.create({ data: { userId: req.user!.id, locationId, action, entity: 'PRODUCT', entityId, details } });

/* ------------------------------------------------------------------ */
/* Editing the shared fields                                           */
/* ------------------------------------------------------------------ */

/** PUT /catalog/:id { expectedVersion, fields }: the given shared fields change in every store that carries the item. */
export async function updateCatalogItem(req: AuthRequest) {
  const body = z.object({ expectedVersion: z.number().int().min(0), fields: fieldsSchema }).parse(req.body ?? {});
  const fields = Object.fromEntries(Object.entries(body.fields).filter(([, value]) => value !== undefined)) as Fields;
  if (!Object.keys(fields).length) throw new AppError('Nothing to change', 400);
  const context = await ownerContext(req);
  const id = recordId.parse(req.params.id);
  return catalogWrite(context, async tx => {
    const item = await loadItem(tx, context, id);
    checkVersion(item.version, body.expectedVersion);
    if (fields.sku && fields.sku !== item.sku && await tx.catalogItem.findFirst({ where: { organizationId: context.organizationId, sku: fields.sku, id: { not: id } }, select: { id: true } }))
      throw new AppError('Another shared item already has this SKU', 409);
    if (fields.barcode && fields.barcode !== item.barcode && await tx.catalogItem.findFirst({ where: { organizationId: context.organizationId, barcode: { in: barcodeVariants(fields.barcode) }, id: { not: id } }, select: { id: true } }))
      throw new AppError('Another shared item already has this barcode', 409);
    await tx.$queryRaw`SELECT id FROM products WHERE "catalogItemId" = ${id} ORDER BY id FOR UPDATE`;
    const { categoryName, ...productFields } = fields;
    for (const product of item.products) {
      const storeName = storeNameOf(context, product.locationId);
      if (fields.sku && fields.sku !== product.sku) await checkIdentifiers(tx, storeName, { locationId: product.locationId, sku: fields.sku, excludeProductId: product.id });
      if (fields.barcode && fields.barcode !== product.barcode) await checkIdentifiers(tx, storeName, { locationId: product.locationId, barcode: fields.barcode, excludeProductId: product.id });
      const data: Prisma.ProductUncheckedUpdateInput = { ...productFields };
      if (categoryName !== undefined && product.locationId) data.categoryId = await categoryIdFor(tx, product.locationId, categoryName);
      await tx.product.update({ where: { id: product.id }, data });
      await log(tx, req, product.locationId, 'CATALOG_ITEM_UPDATED', product.id, { catalogItemId: id, fields: Object.keys(fields) });
    }
    await tx.catalogItem.update({ where: { id }, data: { ...fields, version: { increment: 1 } } });
    return present(tx, context, id);
  });
}

/* ------------------------------------------------------------------ */
/* Shared prices                                                       */
/* ------------------------------------------------------------------ */

const applyTo = z.union([z.literal('FOLLOWING'), z.literal('ALL'), z.object({ locationIds: z.array(recordId).min(1).max(100) })]);
const priceSchema = z.object({ expectedVersion: z.number().int().min(0), defaultPrice: money, apply: applyTo });
type ApplyTo = z.infer<typeof applyTo>;

/** Which store rows a shared price reaches; naming a store that does not carry the item is refused. */
function priceTargets<T extends { locationId: string | null; priceFollowsCatalog: boolean }>(rows: T[], apply: ApplyTo, context: Context) {
  if (typeof apply === 'object') {
    const missing = apply.locationIds.filter(locationId => !rows.some(row => row.locationId === locationId));
    if (missing.length) throw new AppError(`${missing.map(locationId => storeNameOf(context, locationId)).join(', ')} does not carry this item`, 400);
    return rows.filter(row => apply.locationIds.includes(row.locationId || ''));
  }
  return apply === 'ALL' ? rows : rows.filter(row => row.priceFollowsCatalog);
}

/**
 * PUT /catalog/:id/price { expectedVersion, defaultPrice, apply }: the shared price, and
 * the price in the stores it reaches: FOLLOWING (stores that follow it), ALL, or named
 * stores. ALL and named stores also start following it.
 */
export async function setCatalogPrice(req: AuthRequest) {
  const body = priceSchema.parse(req.body ?? {});
  const context = await ownerContext(req);
  const id = recordId.parse(req.params.id);
  return catalogWrite(context, async tx => {
    const item = await loadItem(tx, context, id);
    checkVersion(item.version, body.expectedVersion);
    const targets = priceTargets(item.products, body.apply, context);
    await tx.catalogItem.update({ where: { id }, data: { defaultPrice: body.defaultPrice, version: { increment: 1 } } });
    for (const product of targets) {
      await tx.product.update({ where: { id: product.id }, data: { price: body.defaultPrice, ...(body.apply === 'FOLLOWING' ? {} : { priceFollowsCatalog: true }) } });
      await log(tx, req, product.locationId, 'CATALOG_PRICE_SET', product.id, { catalogItemId: id, from: Number(product.price), to: body.defaultPrice });
    }
    return { item: await present(tx, context, id), updated: targets.length };
  });
}

/** PUT /catalog/packs/:packId/price { expectedVersion, defaultPrice, apply }: the same for one shared pack. */
export async function setCatalogPackPrice(req: AuthRequest) {
  const body = priceSchema.parse(req.body ?? {});
  const context = await ownerContext(req);
  const packId = recordId.parse(req.params.packId);
  return catalogWrite(context, async tx => {
    const pack = await tx.catalogPack.findFirst({ where: { id: packId, catalogItem: { organizationId: context.organizationId } },
      select: { id: true, version: true, catalogItemId: true, sellingUnits: { select: { id: true, locationId: true, price: true, priceFollowsCatalog: true } } } });
    if (!pack) throw new AppError('Shared pack not found', 404);
    checkVersion(pack.version, body.expectedVersion);
    const targets = priceTargets(pack.sellingUnits, body.apply, context);
    await tx.catalogPack.update({ where: { id: packId }, data: { defaultPrice: body.defaultPrice, version: { increment: 1 } } });
    await tx.catalogItem.update({ where: { id: pack.catalogItemId }, data: { version: { increment: 1 } } });
    for (const unit of targets) {
      await tx.productSellingUnit.update({ where: { id: unit.id }, data: { price: body.defaultPrice, version: { increment: 1 }, ...(body.apply === 'FOLLOWING' ? {} : { priceFollowsCatalog: true }) } });
      await log(tx, req, unit.locationId, 'CATALOG_PACK_PRICE_SET', unit.id, { catalogPackId: packId, from: Number(unit.price), to: body.defaultPrice });
    }
    return { item: await present(tx, context, pack.catalogItemId), updated: targets.length };
  });
}

/* ------------------------------------------------------------------ */
/* Adding an item to a store, linking and unlinking                    */
/* ------------------------------------------------------------------ */

const publishSchema = z.object({ locationId: recordId, price: money.optional(), followPrice: z.boolean(), lowStockAlert: z.number().int().min(0).max(1_000_000).optional() });

/** The store's own product for this item, created with stock 0 and the item's packs. */
async function publishOne(tx: Prisma.TransactionClient, req: AuthRequest, context: Context, itemId: string, input: z.infer<typeof publishSchema>) {
  const store = context.stores.find(entry => entry.id === input.locationId);
  if (!store) throw new AppError('Choose one of your stores', 400);
  if (!store.isActive) throw new AppError(`${store.name} is turned off`, 409);
  const item = await loadItem(tx, context, itemId);
  if (!item.isActive) throw new AppError(`${item.name} is turned off in the shared catalog`, 409);
  if (item.products.some(product => product.locationId === store.id)) throw new AppError(`${store.name} already carries ${item.name}`, 409);
  const existing = await tx.product.findFirst({ where: { locationId: store.id, OR: [{ sku: item.sku }, ...(item.barcode ? [{ barcode: { in: barcodeVariants(item.barcode) } }] : [])] },
    select: { id: true, name: true, sku: true, catalogItemId: true } });
  if (existing) throw new AppError(existing.catalogItemId
    ? `${store.name} already has ${existing.name} with this ${existing.sku === item.sku ? 'SKU' : 'barcode'}, linked to another shared item`
    : `${store.name} already has ${existing.name} with this ${existing.sku === item.sku ? 'SKU' : 'barcode'}. Link it instead.`, 409,
  { code: 'PRODUCT_EXISTS', ...(existing.catalogItemId ? {} : { existingProductId: existing.id }), storeName: store.name });
  await checkIdentifiers(tx, store.name, { locationId: store.id, sku: item.sku, barcode: item.barcode });
  const packs = item.packs.filter(pack => pack.isActive);
  for (const pack of packs) await checkIdentifiers(tx, store.name, { locationId: store.id, sku: pack.sku, barcode: pack.barcode });
  const shared = item.defaultPrice === null ? null : Number(item.defaultPrice);
  const price = input.followPrice ? shared : input.price ?? shared;
  if (!price || price <= 0) throw new AppError(input.followPrice ? `${item.name} has no shared price yet` : `Enter ${store.name}'s price for ${item.name}`, 400);
  const values = itemValues(item);
  const { categoryName, ...fields } = values;
  const product = await tx.product.create({ data: { ...fields, locationId: store.id, catalogItemId: item.id, priceFollowsCatalog: input.followPrice,
    categoryId: await categoryIdFor(tx, store.id, categoryName), price, cost: 0, stockQuantity: 0, trackInventory: true, isActive: true,
    ...(input.lowStockAlert !== undefined ? { lowStockAlert: input.lowStockAlert } : {}) } });
  for (const pack of packs) await tx.productSellingUnit.create({ data: { productId: product.id, locationId: store.id, name: pack.name, sku: pack.sku, barcode: pack.barcode,
    unitsPerPackage: pack.unitsPerPackage, price: pack.defaultPrice ?? lineMoney(price, pack.unitsPerPackage), catalogPackId: pack.id,
    priceFollowsCatalog: input.followPrice && pack.defaultPrice !== null } });
  await log(tx, req, store.id, 'CATALOG_ITEM_PUBLISHED', product.id, { catalogItemId: item.id, followPrice: input.followPrice });
  return { productId: product.id, locationId: store.id, storeName: store.name };
}

/** POST /catalog/:id/publish { locationId, price?, followPrice, lowStockAlert? }: add the item to a store. */
export async function publishItem(req: AuthRequest) {
  const input = publishSchema.parse(req.body ?? {});
  const context = await ownerContext(req);
  const id = recordId.parse(req.params.id);
  return catalogWrite(context, async tx => {
    const created = await publishOne(tx, req, context, id, input);
    return { ...created, item: await present(tx, context, id) };
  });
}

/**
 * POST /catalog/publish { itemIds, locationId, followPrice }: add many items to a store
 * (opening a new one). Each item is added on its own; the ones that cannot be are
 * listed with the reason (and the store's own item when it already has one).
 */
export async function publishMany(req: AuthRequest) {
  const input = z.object({ itemIds: z.array(recordId).min(1).max(500), locationId: recordId, followPrice: z.boolean() }).parse(req.body ?? {});
  const context = await ownerContext(req);
  const created: { catalogItemId: string; productId: string }[] = [];
  const skipped: { catalogItemId: string; reason: string; existingProductId: string | null }[] = [];
  for (const itemId of [...new Set(input.itemIds)]) {
    try {
      const result = await catalogWrite(context, tx => publishOne(tx, req, context, itemId, { locationId: input.locationId, followPrice: input.followPrice }));
      created.push({ catalogItemId: itemId, productId: result.productId });
    } catch (error) {
      if (!(error instanceof AppError) || error.statusCode === 400 && /Choose one of your stores/.test(error.message)) throw error;
      skipped.push({ catalogItemId: itemId, reason: error.message, existingProductId: (error.details?.existingProductId as string | undefined) ?? null });
    }
  }
  return { created, skipped };
}

/** POST /catalog/:id/link { productId, makeMatch }: a store's own item becomes this shared item's listing there. */
export async function linkProduct(req: AuthRequest) {
  const input = z.object({ productId: recordId, makeMatch: z.boolean().default(true) }).parse(req.body ?? {});
  const context = await ownerContext(req);
  const id = recordId.parse(req.params.id);
  return catalogWrite(context, async tx => {
    const item = await loadItem(tx, context, id);
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${input.productId} FOR UPDATE`;
    const product = await tx.product.findFirst({ where: { id: input.productId, locationId: { in: context.stores.map(store => store.id) } }, select: memberSelect });
    if (!product) throw new AppError('Product not found in your stores', 404);
    if (product.catalogItemId === id) return present(tx, context, id);
    if (product.catalogItemId) throw new AppError(`${product.name} is linked to another shared item. Unlink it first.`, 409);
    const storeName = storeNameOf(context, product.locationId);
    if (item.products.some(row => row.locationId === product.locationId)) throw new AppError(`${storeName} already has an item linked to ${item.name}`, 409);
    if (input.makeMatch) {
      try { await matchProduct(tx, product, itemValues(item), storeName); }
      catch (error) { if (error instanceof AppError) throw new AppError(error.message.replace('Nothing was linked.', 'Nothing was changed.'), error.statusCode, error.details); throw error; }
    }
    await tx.product.update({ where: { id: product.id }, data: { catalogItemId: id } });
    await linkPacks(tx, [product], item.packs);
    await log(tx, req, product.locationId, 'CATALOG_ITEM_LINKED', product.id, { catalogItemId: id, makeMatch: input.makeMatch });
    return present(tx, context, id);
  });
}

/** POST /catalog/:id/unlink { productId }: the store's item stops following the shared item and becomes its own again. */
export async function unlinkProduct(req: AuthRequest) {
  const { productId } = z.object({ productId: recordId }).parse(req.body ?? {});
  const context = await ownerContext(req);
  const id = recordId.parse(req.params.id);
  return catalogWrite(context, async tx => {
    await loadItem(tx, context, id);
    const product = await tx.product.findFirst({ where: { id: productId, catalogItemId: id }, select: { id: true, locationId: true } });
    if (!product) throw new AppError('That store item is not linked to this shared item', 404);
    await tx.product.update({ where: { id: product.id }, data: { catalogItemId: null, priceFollowsCatalog: false } });
    await tx.productSellingUnit.updateMany({ where: { productId: product.id, catalogPackId: { not: null } }, data: { catalogPackId: null, priceFollowsCatalog: false } });
    await log(tx, req, product.locationId, 'CATALOG_ITEM_UNLINKED', product.id, { catalogItemId: id });
    return present(tx, context, id);
  });
}

/* ------------------------------------------------------------------ */
/* Shared packs                                                        */
/* ------------------------------------------------------------------ */

const newPackSchema = z.object({ expectedVersion: z.number().int().min(0), name: z.string().trim().min(1).max(100), sku: text(100),
  barcode: z.string().trim().min(1).max(100), unitsPerPackage: z.number().int().min(2).max(100000), defaultPrice: money.nullable().optional() });

/**
 * POST /catalog/:id/packs: a new shared pack (a 12-pack, a carton), added to every store
 * that carries the item. A store's own pack with the same barcode is linked instead; a
 * store that already sells another pack of that size refuses the change.
 */
export async function addCatalogPack(req: AuthRequest) {
  const input = newPackSchema.parse(req.body ?? {});
  const context = await ownerContext(req);
  const id = recordId.parse(req.params.id);
  return catalogWrite(context, async tx => {
    const item = await loadItem(tx, context, id);
    checkVersion(item.version, input.expectedVersion);
    if (item.packs.some(pack => pack.isActive && pack.unitsPerPackage === input.unitsPerPackage)) throw new AppError(`${item.name} already has a ${input.unitsPerPackage}-unit pack`, 409);
    if (item.packs.some(pack => barcodeKey(pack.barcode) === barcodeKey(input.barcode))) throw new AppError(`${item.name} already has a pack with this barcode`, 409);
    const pack = await tx.catalogPack.create({ data: { catalogItemId: id, name: input.name, sku: input.sku ?? null, barcode: input.barcode,
      unitsPerPackage: input.unitsPerPackage, defaultPrice: input.defaultPrice ?? null } });
    await tx.$queryRaw`SELECT id FROM products WHERE "catalogItemId" = ${id} ORDER BY id FOR UPDATE`;
    for (const product of item.products) {
      const storeName = storeNameOf(context, product.locationId);
      const same = product.sellingUnits.find(unit => barcodeKey(unit.barcode) === barcodeKey(input.barcode));
      if (same) {
        if (same.unitsPerPackage !== input.unitsPerPackage) throw new AppError(`${storeName}: the pack ${same.name} has this barcode but holds ${same.unitsPerPackage}. Nothing was changed.`, 409);
        await tx.productSellingUnit.update({ where: { id: same.id }, data: { catalogPackId: pack.id } });
        continue;
      }
      const sized = product.sellingUnits.find(unit => unit.unitsPerPackage === input.unitsPerPackage);
      if (sized) throw new AppError(`${storeName} already sells ${sized.name}, a ${input.unitsPerPackage}-unit pack of this item. Give it this barcode, or turn it off, first. Nothing was changed.`, 409);
      await checkIdentifiers(tx, storeName, { locationId: product.locationId, barcode: input.barcode, sku: input.sku ?? null });
      const unit = await tx.productSellingUnit.create({ data: { productId: product.id, locationId: product.locationId!, name: input.name, sku: input.sku ?? null, barcode: input.barcode,
        unitsPerPackage: input.unitsPerPackage, price: input.defaultPrice ?? lineMoney(Number(product.price), input.unitsPerPackage), catalogPackId: pack.id,
        priceFollowsCatalog: input.defaultPrice != null } });
      await log(tx, req, product.locationId, 'CATALOG_PACK_ADDED', unit.id, { catalogPackId: pack.id });
    }
    await tx.catalogItem.update({ where: { id }, data: { version: { increment: 1 } } });
    return present(tx, context, id);
  });
}

const packEditSchema = z.object({ expectedVersion: z.number().int().min(0), name: z.string().trim().min(1).max(100).optional(), sku: text(100),
  barcode: z.string().trim().min(1).max(100).optional() }).strict();

/** PUT /catalog/packs/:packId { expectedVersion, name?, sku?, barcode? }: rename or re-code a shared pack in every store. Its size stays. */
export async function updateCatalogPack(req: AuthRequest) {
  const input = packEditSchema.parse(req.body ?? {});
  const context = await ownerContext(req);
  const packId = recordId.parse(req.params.packId);
  return catalogWrite(context, async tx => {
    const pack = await tx.catalogPack.findFirst({ where: { id: packId, catalogItem: { organizationId: context.organizationId } },
      select: { id: true, version: true, catalogItemId: true, barcode: true, sellingUnits: { select: { id: true, locationId: true, sku: true, barcode: true } },
        catalogItem: { select: { packs: { select: { id: true, barcode: true } } } } } });
    if (!pack) throw new AppError('Shared pack not found', 404);
    checkVersion(pack.version, input.expectedVersion);
    if (input.barcode && pack.catalogItem.packs.some(other => other.id !== pack.id && barcodeKey(other.barcode) === barcodeKey(input.barcode!)))
      throw new AppError('Another pack of this item already has this barcode', 409);
    for (const unit of pack.sellingUnits) {
      const storeName = storeNameOf(context, unit.locationId);
      if (input.barcode && input.barcode !== unit.barcode) await checkIdentifiers(tx, storeName, { locationId: unit.locationId, barcode: input.barcode, excludeSellingUnitId: unit.id });
      if (input.sku && input.sku !== unit.sku) await checkIdentifiers(tx, storeName, { locationId: unit.locationId, sku: input.sku, excludeSellingUnitId: unit.id });
      await tx.productSellingUnit.update({ where: { id: unit.id }, data: { ...(input.name ? { name: input.name } : {}), ...(input.sku !== undefined ? { sku: input.sku } : {}),
        ...(input.barcode ? { barcode: input.barcode } : {}), version: { increment: 1 } } });
      await log(tx, req, unit.locationId, 'CATALOG_PACK_UPDATED', unit.id, { catalogPackId: pack.id });
    }
    await tx.catalogPack.update({ where: { id: packId }, data: { ...(input.name ? { name: input.name } : {}), ...(input.sku !== undefined ? { sku: input.sku } : {}),
      ...(input.barcode ? { barcode: input.barcode } : {}), version: { increment: 1 } } });
    await tx.catalogItem.update({ where: { id: pack.catalogItemId }, data: { version: { increment: 1 } } });
    return present(tx, context, pack.catalogItemId);
  });
}
