import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { AppError } from '../utils/errorHandler';
import { barcodeKey, barcodeVariants } from '../utils/barcode';
import { isOwner, organizationIdOf } from './organization.service';
import { recordOperation } from './operationReceipt.service';
import { assertSellingIdentifiersAvailable } from './productSellingUnit.service';

/**
 * Shared catalog (UPGRADE_PLAN Phase 5). Each store keeps its own products: stock,
 * cost and price. A catalog item, managed by an owner of the organization, links
 * the same item across its stores and owns the shared fields (name, SKU, barcode,
 * selling rules). This file holds the owner check, the catalog list and linking
 * existing products (WP 5.1); editing, prices and adding to a store follow in 5.2.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** What a catalog item shares with every linked store product. Never stock, cost or the store's price. */
export const SHARED_FIELDS = ['name', 'sku', 'barcode', 'description', 'brand', 'productFamily', 'variant', 'size', 'baseUnitName',
  'isTaxable', 'minimumAge', 'ebtEligible', 'priceEmbedded', 'saleBlockedReason'] as const;
export type SharedField = typeof SHARED_FIELDS[number];

export const FIELD_LABELS: Record<SharedField | 'categoryName' | 'price', string> = {
  name: 'Name', sku: 'SKU', barcode: 'Barcode', description: 'Description', brand: 'Brand', productFamily: 'Product family', variant: 'Variety',
  size: 'Size', baseUnitName: 'Sold as', isTaxable: 'Taxed', minimumAge: 'Age limit', ebtEligible: 'SNAP/EBT', priceEmbedded: 'Price in the barcode',
  saleBlockedReason: 'Sale hold', categoryName: 'Category', price: 'Price',
};

export type SharedValues = {
  name: string; sku: string; barcode: string | null; description: string | null; brand: string | null; productFamily: string | null;
  variant: string | null; size: string | null; baseUnitName: string; isTaxable: boolean; minimumAge: number | null; ebtEligible: boolean;
  priceEmbedded: boolean; saleBlockedReason: string | null; categoryName: string | null;
};

const memberSelect = {
  id: true, locationId: true, name: true, sku: true, barcode: true, description: true, brand: true, productFamily: true, variant: true, size: true,
  baseUnitName: true, isTaxable: true, minimumAge: true, ebtEligible: true, priceEmbedded: true, saleBlockedReason: true,
  price: true, stockQuantity: true, updatedAt: true, catalogItemId: true,
  category: { select: { name: true } },
  sellingUnits: { where: { isActive: true }, select: { id: true, name: true, sku: true, barcode: true, unitsPerPackage: true, price: true, catalogPackId: true }, orderBy: { id: 'asc' as const } },
} satisfies Prisma.ProductSelect;
type Member = Prisma.ProductGetPayload<{ select: typeof memberSelect }>;

const itemSelect = {
  id: true, organizationId: true, name: true, sku: true, barcode: true, description: true, brand: true, productFamily: true, variant: true, size: true,
  baseUnitName: true, categoryName: true, isTaxable: true, minimumAge: true, ebtEligible: true, priceEmbedded: true, saleBlockedReason: true,
  defaultPrice: true, isActive: true, version: true, updatedAt: true,
  packs: { select: { id: true, name: true, sku: true, barcode: true, unitsPerPackage: true, defaultPrice: true, isActive: true, version: true }, orderBy: { unitsPerPackage: 'asc' as const } },
  products: { select: { id: true, locationId: true } },
} satisfies Prisma.CatalogItemSelect;
type Item = Prisma.CatalogItemGetPayload<{ select: typeof itemSelect }>;

export function sharedValues(source: Pick<Member, SharedField> & { category: { name: string } | null }): SharedValues {
  return { name: source.name, sku: source.sku, barcode: source.barcode, description: source.description, brand: source.brand,
    productFamily: source.productFamily, variant: source.variant, size: source.size, baseUnitName: source.baseUnitName, isTaxable: source.isTaxable,
    minimumAge: source.minimumAge, ebtEligible: source.ebtEligible, priceEmbedded: source.priceEmbedded, saleBlockedReason: source.saleBlockedReason,
    categoryName: source.category?.name ?? null };
}
const itemValues = (item: Item | SharedValues): SharedValues => ({ name: item.name, sku: item.sku, barcode: item.barcode, description: item.description,
  brand: item.brand, productFamily: item.productFamily, variant: item.variant, size: item.size, baseUnitName: item.baseUnitName, isTaxable: item.isTaxable,
  minimumAge: item.minimumAge, ebtEligible: item.ebtEligible, priceEmbedded: item.priceEmbedded, saleBlockedReason: item.saleBlockedReason, categoryName: item.categoryName });

/* ------------------------------------------------------------------ */
/* Who may manage the catalog                                          */
/* ------------------------------------------------------------------ */

/** The organization of the store this session works in; only its owners manage the shared catalog. */
export async function ownerContext(req: AuthRequest, db: Db = prisma) {
  const locationId = req.user?.locationId;
  if (!locationId || req.user?.role === 'SUPER_ADMIN') throw new AppError('Only an owner manages the shared catalog', 403);
  const organizationId = await organizationIdOf(locationId, db);
  if (!await isOwner(req.user!.id, organizationId, db)) throw new AppError('Only an owner manages the shared catalog', 403);
  const stores = await db.location.findMany({ where: { organizationId }, select: { id: true, name: true, isActive: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  return { organizationId, stores };
}
type OwnerContext = Awaited<ReturnType<typeof ownerContext>>;

/** One catalog writer per organization at a time. */
export const lockCatalog = (tx: Prisma.TransactionClient, organizationId: string) =>
  tx.$queryRaw`SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext(${'shared-catalog:' + organizationId}))`;

/** The store's category with this name (any case), made when it has none. */
export async function categoryIdFor(tx: Prisma.TransactionClient, locationId: string, categoryName: string | null) {
  const name = categoryName?.trim();
  if (!name) return null;
  const found = await tx.category.findFirst({ where: { locationId, name: { equals: name, mode: 'insensitive' } }, select: { id: true }, orderBy: { id: 'asc' } });
  return found?.id ?? (await tx.category.create({ data: { name, locationId }, select: { id: true } })).id;
}

/* ------------------------------------------------------------------ */
/* The catalog                                                         */
/* ------------------------------------------------------------------ */

/** GET /catalog?search&page: shared items with each store's listing, and the stores that do not carry them. */
export async function listCatalog(req: AuthRequest) {
  const context = await ownerContext(req);
  const query = z.object({ search: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).max(10000).catch(1) }).parse(req.query);
  const limit = 50;
  const search = query.search || '';
  const where: Prisma.CatalogItemWhereInput = { organizationId: context.organizationId, ...(search ? { OR: [
    { name: { contains: search, mode: 'insensitive' } }, { sku: { contains: search, mode: 'insensitive' } }, { barcode: { in: barcodeVariants(search) } },
  ] } : {}) };
  const [items, total, unlinked] = await Promise.all([
    prisma.catalogItem.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * limit, take: limit,
      select: { ...itemSelect, products: { select: { id: true, locationId: true, price: true, priceFollowsCatalog: true, stockQuantity: true, isActive: true } } } }),
    prisma.catalogItem.count({ where }),
    prisma.product.count({ where: { locationId: { in: context.stores.map(store => store.id) }, catalogItemId: null, isActive: true, sku: { not: 'MISC-001' } } }),
  ]);
  const storeName = (id: string | null) => context.stores.find(store => store.id === id)?.name ?? 'A store';
  return {
    stores: context.stores,
    unlinkedProducts: unlinked,
    items: items.map(item => ({
      ...itemValues(item), id: item.id, defaultPrice: item.defaultPrice === null ? null : Number(item.defaultPrice), isActive: item.isActive, version: item.version,
      packs: item.packs.map(pack => ({ ...pack, defaultPrice: pack.defaultPrice === null ? null : Number(pack.defaultPrice) })),
      listings: item.products.map(product => ({ locationId: product.locationId, storeName: storeName(product.locationId), productId: product.id,
        price: Number(product.price), priceFollowsCatalog: product.priceFollowsCatalog, stockQuantity: product.stockQuantity, isActive: product.isActive }))
        .sort((a, b) => a.storeName.localeCompare(b.storeName)),
      missingStores: context.stores.filter(store => !item.products.some(product => product.locationId === store.id)).map(store => ({ locationId: store.id, storeName: store.name })),
    })),
    pagination: { page: query.page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

/* ------------------------------------------------------------------ */
/* Linking existing products                                           */
/* ------------------------------------------------------------------ */

export interface GroupInput { id: string; locationId: string | null; name: string; sku: string; barcode: string | null }
export interface ExistingInput { id: string; name: string; sku: string; barcode: string | null }
export interface LinkGroup<T extends GroupInput, E extends ExistingInput> { match: 'BARCODE' | 'SKU_NAME'; key: string; members: T[]; existing: E | null }

const skuAndName = (row: { sku: string; name: string }) => `${row.sku.trim().toLowerCase()}|${row.name.trim().toLowerCase().replace(/\s+/g, ' ')}`;

/**
 * Which unlinked products are the same item: first the same barcode (any UPC/EAN form),
 * then the same SKU and name. A group is offered when it spans two or more stores, or
 * when the catalog already has the item (then it joins it). Pure; unit tested.
 */
export function groupForLinking<T extends GroupInput, E extends ExistingInput>(products: T[], existing: E[]): LinkGroup<T, E>[] {
  const byBarcode = new Map<string, T[]>(), bySkuName = new Map<string, T[]>();
  const add = (map: Map<string, T[]>, key: string, row: T) => map.set(key, [...(map.get(key) || []), row]);
  for (const row of products) if (row.barcode?.trim()) add(byBarcode, barcodeKey(row.barcode), row);
  const existingByBarcode = new Map(existing.flatMap(item => item.barcode ? [[barcodeKey(item.barcode), item] as const] : []));
  const existingBySkuName = new Map(existing.map(item => [skuAndName(item), item] as const));
  const groups: LinkGroup<T, E>[] = [];
  const grouped = new Set<string>();
  for (const [key, members] of byBarcode) {
    const found = existingByBarcode.get(key) ?? null;
    if (new Set(members.map(row => row.locationId)).size < 2 && !found) continue;
    groups.push({ match: 'BARCODE', key, members, existing: found });
    members.forEach(row => grouped.add(row.id));
  }
  for (const row of products) if (!grouped.has(row.id)) add(bySkuName, skuAndName(row), row);
  for (const [key, members] of bySkuName) {
    const found = existingBySkuName.get(key) ?? null;
    if (new Set(members.map(row => row.locationId)).size < 2 && !found) continue;
    groups.push({ match: 'SKU_NAME', key, members, existing: found });
  }
  return groups.sort((a, b) => a.members[0].name.localeCompare(b.members[0].name) || a.key.localeCompare(b.key));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Everything the review shows: proposed shared fields, the stores' items, their differences and a fingerprint. */
async function buildLinkPreview(db: Db, context: OwnerContext, primaryLocationId: string) {
  const storeIds = context.stores.map(store => store.id);
  const [products, items] = await Promise.all([
    db.product.findMany({ where: { locationId: { in: storeIds }, catalogItemId: null, isActive: true, sku: { not: 'MISC-001' } }, select: memberSelect, orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
    db.catalogItem.findMany({ where: { organizationId: context.organizationId }, select: itemSelect }),
  ]);
  const storeName = (id: string | null) => context.stores.find(store => store.id === id)?.name ?? 'A store';
  const order = (id: string | null) => id === primaryLocationId ? -1 : storeIds.indexOf(id || '');
  const groups = groupForLinking(products, items).map(group => {
    const members = [...group.members].sort((a, b) => order(a.locationId) - order(b.locationId) || a.id.localeCompare(b.id));
    const item = group.existing;
    const shared = item ? itemValues(item) : sharedValues(members[0]);
    const problems: string[] = [];
    const perStore = new Map<string, Member[]>();
    for (const member of members) perStore.set(member.locationId || '', [...(perStore.get(member.locationId || '') || []), member]);
    for (const [locationId, rows] of perStore) if (rows.length > 1)
      problems.push(`${storeName(locationId)} has more than one matching item (${rows.map(row => row.name).join(', ')}). Link them one at a time from the item.`);
    if (item) for (const member of members) if (item.products.some(product => product.locationId === member.locationId))
      problems.push(`${storeName(member.locationId)} already has an item linked to ${item.name}.`);
    const fields = [...SHARED_FIELDS, 'categoryName', 'price'] as const;
    const differences = fields.flatMap(field => {
      const values = members.map(member => ({ locationId: member.locationId, storeName: storeName(member.locationId),
        value: field === 'categoryName' ? member.category?.name ?? null : field === 'price' ? Number(member.price) : member[field] }));
      const sharedValue = field === 'price' ? null : shared[field];
      const distinct = new Set([...(field === 'price' ? [] : [sharedValue]), ...values.map(entry => entry.value)].map(value => JSON.stringify(value ?? null)));
      return distinct.size > 1 ? [{ field, label: FIELD_LABELS[field], shared: field === 'price' ? null : sharedValue ?? null, stores: values }] : [];
    });
    const fingerprint = createHash('sha256').update(JSON.stringify([item?.id ?? null, item?.version ?? null,
      ...[...members].sort((a, b) => a.id.localeCompare(b.id)).map(member => [member.id, member.updatedAt.toISOString()])])).digest('hex');
    return {
      match: group.match, existingCatalogItemId: item?.id ?? null, existingName: item?.name ?? null, shared, fingerprint,
      problem: problems.length ? problems.join(' ') : null,
      differences,
      members: members.map(member => ({ productId: member.id, locationId: member.locationId, storeName: storeName(member.locationId), name: member.name,
        sku: member.sku, barcode: member.barcode, price: Number(member.price), stockQuantity: member.stockQuantity,
        packs: member.sellingUnits.map(unit => ({ id: unit.id, name: unit.name, barcode: unit.barcode, unitsPerPackage: unit.unitsPerPackage, price: Number(unit.price) })) })),
      source: members[0],
      memberRows: members,
      item,
    };
  });
  return { groups, unlinkedProducts: products.length };
}

const publicGroup = ({ source: _source, memberRows: _rows, item: _item, ...group }: Awaited<ReturnType<typeof buildLinkPreview>>['groups'][number]) => group;

/** POST /catalog/link/preview { primaryLocationId }: what linking would do; nothing is saved. */
export async function previewLinks(req: AuthRequest) {
  const { primaryLocationId } = z.object({ primaryLocationId: z.string().trim().min(1).max(100) }).parse(req.body ?? {});
  const context = await ownerContext(req);
  if (!context.stores.some(store => store.id === primaryLocationId)) throw new AppError('Choose one of your stores', 400);
  const preview = await buildLinkPreview(prisma, context, primaryLocationId);
  return { primaryLocationId, stores: context.stores, unlinkedProducts: preview.unlinkedProducts, groups: preview.groups.map(publicGroup) };
}

/** Copy the shared fields onto a store's product; SKU and barcode only when that store has them free. */
async function matchProduct(tx: Prisma.TransactionClient, product: Member, shared: SharedValues, storeName: string) {
  const data: Prisma.ProductUncheckedUpdateInput = { name: shared.name, description: shared.description, brand: shared.brand, productFamily: shared.productFamily,
    variant: shared.variant, size: shared.size, baseUnitName: shared.baseUnitName, isTaxable: shared.isTaxable, minimumAge: shared.minimumAge,
    ebtEligible: shared.ebtEligible, priceEmbedded: shared.priceEmbedded, saleBlockedReason: shared.saleBlockedReason };
  try {
    if (shared.sku !== product.sku) { await assertSellingIdentifiersAvailable(tx, { locationId: product.locationId, sku: shared.sku, excludeProductId: product.id }); data.sku = shared.sku; }
    if (shared.barcode && shared.barcode !== product.barcode) { await assertSellingIdentifiersAvailable(tx, { locationId: product.locationId, barcode: shared.barcode, excludeProductId: product.id }); data.barcode = shared.barcode; }
  } catch (error) {
    if (error instanceof AppError) throw new AppError(`${storeName}: ${error.message.replace(' in this store', '')}. Nothing was linked.`, 409, error.details);
    throw error;
  }
  if (shared.categoryName && product.locationId) data.categoryId = await categoryIdFor(tx, product.locationId, shared.categoryName);
  await tx.product.update({ where: { id: product.id }, data });
}

/** Link each store's packs to the item's packs by barcode (any UPC/EAN form). */
async function linkPacks(tx: Prisma.TransactionClient, members: Member[], packs: { id: string; barcode: string }[]) {
  for (const member of members) for (const unit of member.sellingUnits) {
    const pack = packs.find(candidate => barcodeKey(candidate.barcode) === barcodeKey(unit.barcode));
    if (pack && unit.catalogPackId !== pack.id) await tx.productSellingUnit.update({ where: { id: unit.id }, data: { catalogPackId: pack.id } });
  }
}

async function createItem(tx: Prisma.TransactionClient, organizationId: string, source: Member, userId: string) {
  const values = sharedValues(source);
  const clash = await tx.catalogItem.findFirst({ where: { organizationId, OR: [{ sku: values.sku }, ...(values.barcode ? [{ barcode: { in: barcodeVariants(values.barcode) } }] : [])] },
    select: { id: true, name: true, sku: true } });
  if (clash) throw new AppError(`The shared catalog already has ${clash.name} with this ${clash.sku === values.sku ? 'SKU' : 'barcode'}. Link the item to it instead.`, 409, { catalogItemId: clash.id });
  return tx.catalogItem.create({ data: { organizationId, ...values, defaultPrice: source.price, createdById: userId,
    packs: { create: source.sellingUnits.map(unit => ({ name: unit.name, sku: unit.sku, barcode: unit.barcode, unitsPerPackage: unit.unitsPerPackage, defaultPrice: unit.price })) } },
  select: { id: true, name: true, packs: { select: { id: true, barcode: true } } } });
}

const applySchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(100),
  primaryLocationId: z.string().trim().min(1).max(100),
  groups: z.array(z.object({ fingerprint: z.string().length(64), productIds: z.array(z.string().min(1).max(100)).min(1).max(50),
    makeStoresMatch: z.boolean() })).min(1).max(200),
});

/**
 * POST /catalog/link/apply: link the reviewed groups. Each group is checked again and
 * refused (409) if anything changed since the review. A retry with the same key returns
 * the first result. With makeStoresMatch the shared fields are copied onto every store's
 * item (never prices); otherwise each store keeps its own values until the item is edited.
 */
export async function applyLinks(req: AuthRequest) {
  const input = applySchema.parse(req.body ?? {});
  const context = await ownerContext(req);
  if (!context.stores.some(store => store.id === input.primaryLocationId)) throw new AppError('Choose one of your stores', 400);
  return recordOperation(req, 'CATALOG_LINK', context.organizationId, input.idempotencyKey, input, async tx => {
    await lockCatalog(tx, context.organizationId);
    const preview = await buildLinkPreview(tx, context, input.primaryLocationId);
    const storeName = (id: string | null) => context.stores.find(store => store.id === id)?.name ?? 'A store';
    const linked: { catalogItemId: string; name: string; productIds: string[]; joined: boolean }[] = [];
    for (const wanted of input.groups) {
      const ids = [...new Set(wanted.productIds)].sort();
      const group = preview.groups.find(candidate => same(candidate.memberRows.map(member => member.id).sort(), ids));
      if (!group || group.fingerprint !== wanted.fingerprint) throw new AppError('Some items changed since you reviewed them. Review the matches again.', 409);
      if (group.problem) throw new AppError(group.problem, 409);
      await tx.$queryRaw`SELECT id FROM products WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
      const item = group.item
        ? { id: group.item.id, name: group.item.name, packs: group.item.packs.map(pack => ({ id: pack.id, barcode: pack.barcode })) }
        : await createItem(tx, context.organizationId, group.source, req.user!.id);
      const shared = group.item ? itemValues(group.item) : sharedValues(group.source);
      for (const member of group.memberRows) {
        if (wanted.makeStoresMatch && (group.item || member.id !== group.source.id)) await matchProduct(tx, member, shared, storeName(member.locationId));
        await tx.product.update({ where: { id: member.id }, data: { catalogItemId: item.id } });
      }
      await linkPacks(tx, group.memberRows, item.packs);
      linked.push({ catalogItemId: item.id, name: item.name, productIds: ids, joined: !!group.item });
    }
    return { linked: linked.length, products: linked.reduce((sum, row) => sum + row.productIds.length, 0), items: linked };
  });
}

/** POST /catalog/from-product { productId }: start a shared item from one store's item, linked to it. */
export async function createFromProduct(req: AuthRequest) {
  const { productId } = z.object({ productId: z.string().trim().min(1).max(100) }).parse(req.body ?? {});
  const context = await ownerContext(req);
  return prisma.$transaction(async tx => {
    await lockCatalog(tx, context.organizationId);
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`;
    const product = await tx.product.findFirst({ where: { id: productId, locationId: { in: context.stores.map(store => store.id) } }, select: memberSelect });
    if (!product) throw new AppError('Product not found in your stores', 404);
    if (product.catalogItemId) return { catalogItemId: product.catalogItemId, created: false };
    if (product.sku === 'MISC-001') throw new AppError('The misc item stays in each store', 400);
    const item = await createItem(tx, context.organizationId, product, req.user!.id);
    await tx.product.update({ where: { id: product.id }, data: { catalogItemId: item.id } });
    await linkPacks(tx, [product], item.packs);
    await tx.activityLog.create({ data: { userId: req.user!.id, locationId: req.user!.locationId, action: 'CATALOG_ITEM_CREATED', entity: 'CATALOG_ITEM', entityId: item.id,
      details: { productId: product.id, storeId: product.locationId } } });
    return { catalogItemId: item.id, created: true };
  }, { timeout: 30000 });
}
