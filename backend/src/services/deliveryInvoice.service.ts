import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../config/database';
import { config } from '../config';
import { AuthRequest } from '../types';
import { AppError } from '../utils/errorHandler';
import { logger } from '../utils/logger';
import { can } from '../policies/capabilities';
import { getLocationFilter, resolveWriteLocation } from '../utils/locationFilter.util';
import { pickRule, Rounding, storeRules, suggestPrice } from './pricing.service';
import { costChangeAlertPercent } from '../validators/storeSettings.validator';
import { InvoiceLine, Tier, invoiceWarnings, lineUnits, matchInvoiceLines, pickSupplier, rematchSupplier, unitsPerCase } from './invoiceMatching.service';
import {
  InvoiceFile, InvoiceMimeType, InvoiceReadError, InvoiceReading, MAX_IMAGE_BYTES, MAX_INVOICE_FILES, MAX_PDF_BYTES,
  cannedPicker, cannedReading, detectInvoiceType, invoiceReadingConfigured, pickWithAi, readCanned, readInvoice,
} from './invoiceReading.service';

/**
 * Delivery invoices: a photo of a supplier's invoice, read and matched, waiting
 * for an owner or manager to press OK. Anyone working in the store may send
 * one (a cashier at the register); nothing reaches stock until it is received
 * (deliveryInvoiceReceiving.service.ts), which goes through the reviewed
 * receipt import like every other delivery.
 *
 * READING -> READY (or FAILED, read again) -> RECEIVED or DISCARDED.
 * The photos are kept with the invoice (backend/uploads/invoices), and deleted
 * when an invoice is discarded.
 */

export const invoiceDirectory = path.resolve(__dirname, '../../uploads', config.nodeEnv === 'test' ? 'test-invoices' : 'invoices');
/** A read that has not finished by now stopped (the server restarted); it can be read again. */
export const STALE_READING_MS = 4 * 60_000;
const EXTENSIONS: Record<InvoiceMimeType, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'application/pdf': '.pdf' };

type InvoiceRow = Prisma.DeliveryInvoiceGetPayload<{ include: { pages: true } }>;
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const invoiceLines = (invoice: { lines: Prisma.JsonValue }) => (Array.isArray(invoice.lines) ? invoice.lines : []) as unknown as InvoiceLine[];
const numberOrNull = (value: Prisma.Decimal | null) => value === null ? null : Number(value);
const dateOnly = (value: Date | null) => value ? value.toISOString().slice(0, 10) : null;
const filePath = (filename: string) => {
  if (!/^[0-9a-f-]{36}\.(?:jpg|png|gif|webp|pdf)$/.test(filename)) throw new AppError('Invoice photo not found', 404);
  return path.join(invoiceDirectory, filename);
};

export const manages = (req: AuthRequest) => can(req.user?.role, 'inventory.manage');
const reads = (req: AuthRequest) => can(req.user?.role, 'inventory.read');

/** The status people see: a read that stopped counts as failed. */
export function effectiveStatus(invoice: { status: string; updatedAt: Date }, now = Date.now()) {
  return invoice.status === 'READING' && invoice.updatedAt.getTime() < now - STALE_READING_MS ? 'FAILED' : invoice.status;
}
const effectiveError = (invoice: { status: string; updatedAt: Date; error: string | null }) =>
  invoice.status === 'READING' && effectiveStatus(invoice) === 'FAILED' ? 'Reading stopped before it finished. Read it again.' : invoice.error;

/** How the lines stand: sure / to check / new, and what pressing OK would receive. */
export function lineCounts(lines: InvoiceLine[]) {
  const counts: Record<Lowercase<Tier>, number> = { sure: 0, check: 0, new: 0, credit: 0 };
  let waiting = 0, skipped = 0, units = 0, cost = 0, costKnown = true;
  for (const line of lines) {
    counts[line.tier.toLowerCase() as Lowercase<Tier>]++;
    if (line.skip) { skipped++; continue; }
    if (!line.confirmed) waiting++;
    const amounts = lineUnits(line);
    units += amounts.units;
    if (amounts.unitCost === null) costKnown = false; else cost += amounts.unitCost * amounts.units;
  }
  return { ...counts, lines: lines.length, waiting, skipped, units, cost: costKnown ? Math.round(cost * 100) / 100 : null };
}

async function names(invoices: { createdById: string; supplierId: string | null; receivedById?: string | null }[]) {
  const people = [...new Set(invoices.flatMap(invoice => [invoice.createdById, ...(invoice.receivedById ? [invoice.receivedById] : [])]))];
  const supplierIds = [...new Set(invoices.flatMap(invoice => invoice.supplierId ? [invoice.supplierId] : []))];
  const [users, suppliers] = await Promise.all([
    people.length ? prisma.user.findMany({ where: { id: { in: people } }, select: { id: true, firstName: true, lastName: true } }) : [],
    supplierIds.length ? prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true } }) : [],
  ]);
  return {
    person: (id: string | null | undefined) => { const user = users.find(entry => entry.id === id); return user ? { id: user.id, name: `${user.firstName} ${user.lastName}`.trim() } : null; },
    supplier: (id: string | null) => suppliers.find(entry => entry.id === id) ?? null,
  };
}

type Names = Awaited<ReturnType<typeof names>>;

function summary(invoice: InvoiceRow, lookup: Names, full: boolean) {
  const status = effectiveStatus(invoice);
  const base = { id: invoice.id, status, vendorName: invoice.vendorName, invoiceNumber: invoice.invoiceNumber, createdAt: invoice.createdAt,
    createdBy: lookup.person(invoice.createdById), pageCount: invoice.pages.length, lineCount: invoiceLines(invoice).length, error: effectiveError(invoice) };
  if (!full) return base;
  return { ...base, supplier: lookup.supplier(invoice.supplierId), invoiceDate: dateOnly(invoice.invoiceDate), total: numberOrNull(invoice.total),
    counts: lineCounts(invoiceLines(invoice)), version: invoice.version, receivedAt: invoice.receivedAt, receivedBy: lookup.person(invoice.receivedById),
    purchaseOrderId: invoice.purchaseOrderId, purchaseReceiptId: invoice.purchaseReceiptId };
}

/** Everything the review screen needs: the lines with today's cost and price, warnings and photo list. */
export async function deliveryInvoiceDetail(invoice: InvoiceRow) {
  const lookup = await names([invoice]);
  const lines = invoiceLines(invoice);
  const ids = [...new Set(lines.flatMap(line => line.product ? [line.product.productId] : []))];
  const [products, rules, warnings, categories, location] = await Promise.all([
    ids.length ? prisma.product.findMany({ where: { id: { in: ids }, locationId: invoice.locationId },
      select: { id: true, name: true, sku: true, cost: true, price: true, stockQuantity: true, isActive: true, trackInventory: true, categoryId: true, brand: true } }) : [],
    storeRules(prisma, invoice.locationId),
    invoice.status === 'READY' ? invoiceWarnings(prisma, { id: invoice.id, locationId: invoice.locationId, supplierId: invoice.supplierId, vendorName: invoice.vendorName,
      invoiceNumber: invoice.invoiceNumber, subtotal: numberOrNull(invoice.subtotal), tax: numberOrNull(invoice.tax), fees: numberOrNull(invoice.fees),
      discount: numberOrNull(invoice.discount), total: numberOrNull(invoice.total), lines }) : [],
    // New items go into the store's own categories (the receipt import accepts only those).
    prisma.category.findMany({ where: { locationId: invoice.locationId, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.location.findUnique({ where: { id: invoice.locationId }, select: { settings: true } }),
  ]);
  const priceFor = (unitCost: number | null, item: { productId?: string | null; categoryId?: string | null; brand?: string | null }) => {
    if (!unitCost || unitCost <= 0) return null;
    const picked = pickRule(rules, item);
    return picked ? suggestPrice(unitCost, picked.rule.targetMargin, picked.rule.rounding as Rounding)?.price ?? null : null;
  };
  const reading = (invoice.reading ?? {}) as { notes?: string[] };
  return {
    ...summary(invoice, lookup, true),
    subtotal: numberOrNull(invoice.subtotal), tax: numberOrNull(invoice.tax), fees: numberOrNull(invoice.fees), discount: numberOrNull(invoice.discount),
    notes: Array.isArray(reading.notes) ? reading.notes : [],
    warnings,
    categories,
    costAlertPercent: costChangeAlertPercent(location?.settings),
    pages: invoice.pages.sort((a, b) => a.pageNumber - b.pageNumber).map(page => ({ pageNumber: page.pageNumber, mimeType: page.mimeType })),
    lines: lines.map(line => {
      const { units, unitCost } = lineUnits(line);
      const current = line.product ? products.find(product => product.id === line.product!.productId) : undefined;
      const previousCost = current ? Number(current.cost) : null;
      return {
        ...line, units, unitCost,
        current: current ? { name: current.name, sku: current.sku, cost: previousCost, price: Number(current.price), stockQuantity: current.stockQuantity,
          available: current.isActive && current.trackInventory } : null,
        costChange: previousCost && unitCost !== null && previousCost > 0 ? Math.round(((unitCost - previousCost) / previousCost) * 1000) / 10 : null,
        suggestedPrice: priceFor(unitCost, { categoryId: line.newItem?.categoryId ?? line.suggestion?.categoryId ?? null }),
      };
    }),
  };
}

const storeOf = (req: AuthRequest) => getLocationFilter(req, typeof req.query?.locationId === 'string' ? req.query.locationId : undefined).locationId;

export async function loadInvoice(req: AuthRequest, id: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const valid = z.string().uuid().safeParse(id);
  if (!valid.success) throw new AppError('Invoice not found', 404);
  const invoice = await db.deliveryInvoice.findUnique({ where: { id: valid.data }, include: { pages: true } });
  const locationId = storeOf(req);
  if (!invoice || (locationId && invoice.locationId !== locationId)) throw new AppError('Invoice not found', 404);
  return invoice;
}

/** Managers see every invoice of the store; the person who sent one sees its status. */
function assertCanSee(req: AuthRequest, invoice: { createdById: string }) {
  if (!reads(req) && invoice.createdById !== req.user!.id) throw new AppError('Invoice not found', 404);
}

/* ------------------------------------------------------------------ */
/* Sending and reading                                                 */
/* ------------------------------------------------------------------ */

export interface InvoiceUpload { buffer: Buffer; size: number }

function checkFiles(uploads: InvoiceUpload[]): InvoiceFile[] {
  if (!uploads.length) throw new AppError('Take a photo of the invoice, or choose its PDF', 400);
  if (uploads.length > MAX_INVOICE_FILES) throw new AppError(`Send up to ${MAX_INVOICE_FILES} photos at a time`, 400);
  const files = uploads.map(upload => {
    const mimeType = detectInvoiceType(upload.buffer);
    if (!mimeType) throw new AppError('Send photos (JPEG, PNG, GIF or WebP) or a PDF of the invoice', 400);
    if (mimeType === 'application/pdf' ? upload.buffer.length > MAX_PDF_BYTES : upload.buffer.length > MAX_IMAGE_BYTES)
      throw new AppError(mimeType === 'application/pdf' ? 'Choose a PDF up to 15 MB' : 'Each photo must be under 5 MB', 400);
    return { bytes: upload.buffer, mimeType };
  });
  if (files.length > 1 && files.some(file => file.mimeType === 'application/pdf')) throw new AppError('Send a PDF on its own: it already holds every page', 400);
  return files;
}

/**
 * POST /delivery-invoices: keep the photos and a draft first, then read and
 * match. A read that fails leaves the draft FAILED (read it again), never lost.
 */
export async function createDeliveryInvoice(req: AuthRequest, uploads: InvoiceUpload[]) {
  const locationId = resolveWriteLocation(req);
  const files = checkFiles(uploads);
  const canned = cannedReading(req.body?.testReading);
  if (!canned && !invoiceReadingConfigured()) throw new AppError('Reading invoices is not set up on this server yet (it needs the AI key).', 503);
  const filenames = files.map(file => randomUUID() + EXTENSIONS[file.mimeType]);
  await fs.mkdir(invoiceDirectory, { recursive: true });
  let id: string;
  try {
    await Promise.all(files.map((file, index) => fs.writeFile(filePath(filenames[index]), file.bytes, { flag: 'wx' })));
    id = await prisma.$transaction(async tx => {
      const invoice = await tx.deliveryInvoice.create({ data: { locationId, createdById: req.user!.id, status: 'READING',
        pages: { create: files.map((file, index) => ({ pageNumber: index + 1, filename: filenames[index], mimeType: file.mimeType, size: file.bytes.length })) } } });
      await tx.activityLog.create({ data: { userId: req.user!.id, locationId, action: 'INVOICE_SENT', entity: 'DELIVERY_INVOICE', entityId: invoice.id, details: { pages: files.length } } });
      return invoice.id;
    });
  } catch (error) {
    await Promise.all(filenames.map(name => fs.unlink(filePath(name)).catch(() => undefined)));
    throw error;
  }
  await readAndMatch(id, locationId, files, canned);
  return present(req, await loadInvoice(req, id));
}

/** Read the photos, find the supplier and match every line. Only a draft still READING is updated. */
async function readAndMatch(id: string, locationId: string, files: InvoiceFile[], canned: ReturnType<typeof cannedReading>) {
  let reading: InvoiceReading;
  try {
    reading = canned ? readCanned(canned, files.length) : await readInvoice(files);
  } catch (error) {
    if (!(error instanceof InvoiceReadError)) logger.warn('Invoice reading stopped unexpectedly');
    const message = error instanceof InvoiceReadError ? error.message : 'The invoice could not be read. Try again.';
    await prisma.deliveryInvoice.updateMany({ where: { id, status: 'READING' }, data: { status: 'FAILED', error: message, version: { increment: 1 } } });
    return;
  }
  try {
    const suppliers = await prisma.supplier.findMany({ where: { locationId, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    const supplier = pickSupplier(reading.header.vendorName, suppliers);
    const lines = await matchInvoiceLines(prisma, { locationId, supplierId: supplier?.id ?? null, lines: reading.lines },
      { pick: canned ? cannedPicker(canned) : pickWithAi });
    const { header } = reading;
    await prisma.deliveryInvoice.updateMany({ where: { id, status: 'READING' }, data: {
      status: 'READY', error: null, vendorName: header.vendorName, supplierId: supplier?.id ?? null, invoiceNumber: header.invoiceNumber,
      invoiceDate: header.invoiceDate ? new Date(header.invoiceDate + 'T00:00:00.000Z') : null,
      subtotal: header.subtotal, tax: header.tax, fees: header.fees, discount: header.discount, total: header.total,
      reading: asJson(reading), lines: asJson(lines), version: { increment: 1 },
    } });
  } catch {
    logger.warn('Matching a delivery invoice failed');
    await prisma.deliveryInvoice.updateMany({ where: { id, status: 'READING' }, data: { status: 'FAILED', error: 'The lines could not be matched to your items. Read it again.', version: { increment: 1 } } });
  }
}

/** POST /delivery-invoices/:id/read: read a failed (or, for managers, any waiting) invoice again. */
export async function readDeliveryInvoiceAgain(req: AuthRequest, id: string) {
  const canned = cannedReading(req.body?.testReading);
  if (!canned && !invoiceReadingConfigured()) throw new AppError('Reading invoices is not set up on this server yet (it needs the AI key).', 503);
  const target = await loadInvoice(req, id);
  assertCanSee(req, target);
  await settleBeforeChange(target.id);
  const invoice = await prisma.$transaction(async tx => {
    const current = await loadInvoice(req, id, tx);
    await tx.$queryRaw`SELECT id FROM delivery_invoices WHERE id = ${current.id} FOR UPDATE`;
    const locked = await loadInvoice(req, id, tx);
    assertCanSee(req, locked);
    const status = effectiveStatus(locked);
    if (status === 'READING') throw new AppError('This invoice is being read right now', 409);
    if (status === 'RECEIVED' || status === 'DISCARDED') throw new AppError(`This invoice was already ${status.toLowerCase()}`, 409);
    if (status === 'READY' && !manages(req)) throw new AppError('Insufficient permissions', 403);
    if (locked.importId) throw new AppError('This invoice is being received right now. Reload it in a moment.', 409);
    await tx.deliveryInvoice.update({ where: { id: locked.id }, data: { status: 'READING', error: null, version: { increment: 1 } } });
    return locked;
  });
  let files: InvoiceFile[];
  try {
    files = await Promise.all(invoice.pages.sort((a, b) => a.pageNumber - b.pageNumber)
      .map(async page => ({ bytes: await fs.readFile(filePath(page.filename)), mimeType: page.mimeType as InvoiceMimeType })));
  } catch {
    await prisma.deliveryInvoice.updateMany({ where: { id: invoice.id, status: 'READING' }, data: { status: 'FAILED', error: 'The photos of this invoice are missing. Send them again.', version: { increment: 1 } } });
    return present(req, await loadInvoice(req, invoice.id));
  }
  await readAndMatch(invoice.id, invoice.locationId, files, canned);
  return present(req, await loadInvoice(req, invoice.id));
}

async function present(req: AuthRequest, invoice: InvoiceRow) {
  if (reads(req)) return deliveryInvoiceDetail(invoice);
  return summary(invoice, await names([invoice]), false);
}

/**
 * Settle the receipt import an earlier OK left on an invoice. Waits for an
 * apply still running (it holds the import's row). Applied: its result, so the
 * caller finishes that receipt instead of making another. Not applied: it is
 * deleted (unapplied imports may be), so it can never be applied later.
 */
export async function settlePreviousImport(importId: string): Promise<Prisma.JsonValue | null> {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM inventory_imports WHERE id = ${importId} FOR UPDATE`;
    const record = await tx.inventoryImport.findUnique({ where: { id: importId }, select: { appliedAt: true, result: true } });
    if (!record) return null;
    if (record.appliedAt) return record.result ?? {};
    await tx.inventoryImport.delete({ where: { id: importId } });
    return null;
  });
}

/** Before changing or discarding an invoice: refuse when an earlier OK already received it, else clear that try. */
async function settleBeforeChange(id: string) {
  const pending = await prisma.deliveryInvoice.findUnique({ where: { id }, select: { importId: true, status: true } });
  if (!pending?.importId || pending.status !== 'READY') return;
  if (await settlePreviousImport(pending.importId)) throw new AppError('This delivery was already received. Press Receive again to finish it.', 409);
  await prisma.deliveryInvoice.updateMany({ where: { id, importId: pending.importId }, data: { importId: null } });
}

/* ------------------------------------------------------------------ */
/* Lists, one invoice, photos                                          */
/* ------------------------------------------------------------------ */

const OPEN = ['READING', 'READY', 'FAILED'];

/** GET /delivery-invoices?status=open|received|discarded. A cashier sees their own from the last week. */
export async function listDeliveryInvoices(req: AuthRequest) {
  const locationId = storeOf(req);
  if (!locationId) throw new AppError('Select a store to see delivery invoices', 400);
  const wanted = z.enum(['open', 'received', 'discarded']).catch('open').parse(req.query.status);
  const status = wanted === 'open' ? { in: OPEN } : wanted.toUpperCase();
  // The invoice a purchase order was received from (its photos), whatever its status.
  const order = typeof req.query.purchaseOrderId === 'string' && req.query.purchaseOrderId ? req.query.purchaseOrderId.slice(0, 100) : null;
  const where: Prisma.DeliveryInvoiceWhereInput = reads(req) ? (order ? { locationId, purchaseOrderId: order } : { locationId, status })
    : { locationId, createdById: req.user!.id, createdAt: { gte: new Date(Date.now() - 7 * 86400000) } };
  const invoices = await prisma.deliveryInvoice.findMany({ where, include: { pages: true },
    orderBy: wanted === 'open' ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ updatedAt: 'desc' }, { id: 'asc' }], take: wanted === 'open' ? 100 : 50 });
  const lookup = await names(invoices);
  return invoices.map(invoice => summary(invoice, lookup, reads(req)));
}

/** GET /delivery-invoices/:id */
export async function getDeliveryInvoice(req: AuthRequest, id: string) {
  const invoice = await loadInvoice(req, id);
  assertCanSee(req, invoice);
  return present(req, invoice);
}

/** GET /delivery-invoices/:id/pages/:n: the photo itself (managers, and the person who sent it). */
export async function deliveryInvoicePage(req: AuthRequest, id: string, pageNumber: string) {
  const invoice = await loadInvoice(req, id);
  assertCanSee(req, invoice);
  const page = invoice.pages.find(entry => String(entry.pageNumber) === pageNumber);
  if (!page) throw new AppError('Invoice photo not found', 404);
  return { path: filePath(page.filename), mimeType: page.mimeType };
}

/* ------------------------------------------------------------------ */
/* The owner's decisions                                               */
/* ------------------------------------------------------------------ */

const money = z.number().finite().min(0).max(1_000_000);
const recordId = z.string().trim().min(1).max(100);
const newItemSchema = z.object({
  name: z.string().trim().min(1).max(250), price: money.positive().nullable(), categoryId: recordId.nullable(),
  barcode: z.string().trim().max(100).nullable().transform(value => value || null), minimumAge: z.union([z.literal(18), z.literal(21)]).nullable(),
  ebtEligible: z.boolean(), isTaxable: z.boolean(),
});
const linePatchSchema = z.object({
  index: z.number().int().min(0),
  confirmed: z.boolean().optional(),
  skip: z.boolean().optional(),
  product: z.object({ productId: recordId, sellingUnitId: recordId.nullable().optional() }).optional(),
  newItem: newItemSchema.optional(),
  receivedQuantity: z.number().finite().min(0).max(1_000_000).optional(),
  unitsPerCase: z.number().int().min(1).max(100000).optional(),
  caseCost: money.nullable().optional(),
}).strict();
const patchSchema = z.object({
  version: z.number().int().min(1),
  supplierId: recordId.nullable().optional(),
  vendorName: z.string().trim().max(250).nullable().optional(),
  invoiceNumber: z.string().trim().max(100).nullable().optional(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(value + 'T00:00:00Z')), 'Enter a valid date').nullable().optional(),
  tax: money.nullable().optional(), fees: money.nullable().optional(), discount: money.nullable().optional(), total: money.nullable().optional(),
  lines: z.array(linePatchSchema).max(500).optional(),
}).strict();
export type DeliveryInvoicePatch = z.infer<typeof patchSchema>;

const receivableProduct = (locationId: string) => ({ locationId, isActive: true, trackInventory: true, sku: { not: 'MISC-001' } });

/** Apply one person's changes to the lines; every change marks the line as decided by a person. */
async function applyLinePatches(tx: Prisma.TransactionClient, locationId: string, lines: InvoiceLine[], patches: z.infer<typeof linePatchSchema>[]) {
  const next = lines.map(line => ({ ...line }));
  const productIds = [...new Set(patches.flatMap(patch => patch.product ? [patch.product.productId] : []))];
  const packIds = [...new Set(patches.flatMap(patch => patch.product?.sellingUnitId ? [patch.product.sellingUnitId] : []))];
  const categoryIds = [...new Set(patches.flatMap(patch => patch.newItem?.categoryId ? [patch.newItem.categoryId] : []))];
  const [products, packs, categories] = await Promise.all([
    productIds.length ? tx.product.findMany({ where: { ...receivableProduct(locationId), id: { in: productIds } }, select: { id: true, name: true, sku: true } }) : [],
    packIds.length ? tx.productSellingUnit.findMany({ where: { locationId, isActive: true, id: { in: packIds } }, select: { id: true, name: true, productId: true, unitsPerPackage: true } }) : [],
    categoryIds.length ? tx.category.findMany({ where: { locationId, id: { in: categoryIds } }, select: { id: true } }) : [],
  ]);
  for (const patch of patches) {
    const line = next[patch.index];
    if (!line) throw new AppError(`Line ${patch.index + 1} is not on this invoice`, 400);
    line.touched = true;
    if (patch.product) {
      const product = products.find(entry => entry.id === patch.product!.productId);
      if (!product) throw new AppError(`Line ${patch.index + 1}: choose an active item of this store that keeps stock`, 400);
      const pack = patch.product.sellingUnitId ? packs.find(entry => entry.id === patch.product!.sellingUnitId && entry.productId === product.id) : null;
      if (patch.product.sellingUnitId && !pack) throw new AppError(`Line ${patch.index + 1}: that pack is not one of this item's packs`, 400);
      const wasPack = !!line.product?.sellingUnitId;
      line.product = { productId: product.id, sellingUnitId: pack?.id ?? null, name: pack ? pack.name : product.name, sku: product.sku, unitsPerPackage: pack?.unitsPerPackage ?? null };
      line.newItem = null; line.skip = false; line.confirmed = true;
      if (pack) Object.assign(line, { unitsPerCase: pack.unitsPerPackage, unitsSource: 'PACK', checkUnits: false });
      else if (wasPack) {
        const printed = line.unit === 'EACH' ? 1 : unitsPerCase(line.description, line.printedUnitsPerCase);
        Object.assign(line, { unitsPerCase: printed ?? 1, unitsSource: printed && line.unit !== 'EACH' ? 'PRINTED' : 'ONE', checkUnits: !printed && line.unit === 'CASE' });
      }
    }
    if (patch.newItem) {
      if (patch.newItem.categoryId && !categories.some(entry => entry.id === patch.newItem!.categoryId)) throw new AppError(`Line ${patch.index + 1}: that category is not available in this store`, 400);
      line.newItem = patch.newItem; line.product = null; line.skip = false;
      line.confirmed = patch.newItem.price !== null;
      if (line.unitsSource === 'PACK') Object.assign(line, { unitsSource: 'ONE', checkUnits: line.unit === 'CASE' });
    }
    if (patch.skip !== undefined) {
      line.skip = patch.skip;
      line.confirmed = patch.skip ? true : !!(line.product || (line.newItem && line.newItem.price !== null)) && (patch.confirmed ?? false);
    }
    if (patch.confirmed !== undefined && patch.skip === undefined && !patch.product && !patch.newItem) {
      if (patch.confirmed && !line.skip && !line.product && !(line.newItem && line.newItem.price !== null))
        throw new AppError(`Line ${patch.index + 1}: choose the item, add it as new, or skip it`, 400);
      line.confirmed = patch.confirmed;
    }
    if (patch.unitsPerCase !== undefined) {
      if (line.product?.sellingUnitId && patch.unitsPerCase !== line.product.unitsPerPackage) throw new AppError(`Line ${patch.index + 1}: ${line.product.name} holds ${line.product.unitsPerPackage}`, 400);
      line.unitsPerCase = patch.unitsPerCase; line.unitsSource = line.product?.sellingUnitId ? 'PACK' : 'SET'; line.checkUnits = false;
    }
    if (patch.receivedQuantity !== undefined) line.receivedQuantity = patch.receivedQuantity;
    if (patch.caseCost !== undefined) line.caseCost = patch.caseCost;
  }
  return next;
}

/** PATCH /delivery-invoices/:id: save decisions as they are made (version-checked). */
export async function updateDeliveryInvoice(req: AuthRequest, id: string) {
  const body = patchSchema.parse(req.body);
  await settleBeforeChange((await loadInvoice(req, id)).id);
  const updated = await prisma.$transaction(async tx => {
    const found = await loadInvoice(req, id, tx);
    await tx.$queryRaw`SELECT id FROM delivery_invoices WHERE id = ${found.id} FOR UPDATE`;
    const invoice = await loadInvoice(req, id, tx);
    if (effectiveStatus(invoice) !== 'READY') throw new AppError(invoice.status === 'RECEIVED' ? 'This invoice was already received' : 'This invoice is not ready to change', 409);
    if (invoice.version !== body.version) throw new AppError('Someone else changed this invoice. Reload it to see their changes.', 409);
    if (invoice.importId) throw new AppError('This invoice is being received right now. Reload it in a moment.', 409);
    let lines = invoiceLines(invoice);
    const data: Prisma.DeliveryInvoiceUpdateInput = { version: { increment: 1 } };
    if (body.supplierId !== undefined && body.supplierId !== invoice.supplierId) {
      if (body.supplierId && !await tx.supplier.findFirst({ where: { id: body.supplierId, locationId: invoice.locationId, isActive: true }, select: { id: true } }))
        throw new AppError('Choose an active supplier of this store', 400);
      data.supplierId = body.supplierId;
      lines = await rematchSupplier(tx, invoice.locationId, body.supplierId, lines);
    }
    if (body.vendorName !== undefined) data.vendorName = body.vendorName || null;
    if (body.invoiceNumber !== undefined) data.invoiceNumber = body.invoiceNumber || null;
    if (body.invoiceDate !== undefined) data.invoiceDate = body.invoiceDate ? new Date(body.invoiceDate + 'T00:00:00.000Z') : null;
    for (const field of ['tax', 'fees', 'discount', 'total'] as const) if (body[field] !== undefined) data[field] = body[field];
    if (body.lines?.length) lines = await applyLinePatches(tx, invoice.locationId, lines, body.lines);
    data.lines = asJson(lines);
    await tx.deliveryInvoice.update({ where: { id: invoice.id }, data });
    return loadInvoice(req, id, tx);
  });
  return deliveryInvoiceDetail(updated);
}

/** POST /delivery-invoices/:id/discard: set it aside and delete its photos. The person who sent it may too, until it is received. */
export async function discardDeliveryInvoice(req: AuthRequest, id: string) {
  const target = await loadInvoice(req, id);
  assertCanSee(req, target);
  await settleBeforeChange(target.id);
  const { invoice, filenames } = await prisma.$transaction(async tx => {
    const found = await loadInvoice(req, id, tx);
    await tx.$queryRaw`SELECT id FROM delivery_invoices WHERE id = ${found.id} FOR UPDATE`;
    const current = await loadInvoice(req, id, tx);
    assertCanSee(req, current);
    if (!manages(req) && current.createdById !== req.user!.id) throw new AppError('Insufficient permissions', 403);
    if (current.status === 'RECEIVED') throw new AppError('This invoice was already received', 409);
    if (current.status === 'DISCARDED') return { invoice: current, filenames: [] as string[] };
    if (current.importId) throw new AppError('This invoice is being received right now. Reload it in a moment.', 409);
    await tx.deliveryInvoicePage.deleteMany({ where: { invoiceId: current.id } });
    await tx.deliveryInvoice.update({ where: { id: current.id }, data: { status: 'DISCARDED', discardedById: req.user!.id, discardedAt: new Date(), version: { increment: 1 } } });
    await tx.activityLog.create({ data: { userId: req.user!.id, locationId: current.locationId, action: 'INVOICE_DISCARDED', entity: 'DELIVERY_INVOICE', entityId: current.id,
      details: { vendorName: current.vendorName, invoiceNumber: current.invoiceNumber } } });
    return { invoice: current, filenames: current.pages.map(page => page.filename) };
  });
  await Promise.all(filenames.map(name => fs.unlink(filePath(name)).catch(() => undefined)));
  return present(req, await loadInvoice(req, invoice.id));
}
