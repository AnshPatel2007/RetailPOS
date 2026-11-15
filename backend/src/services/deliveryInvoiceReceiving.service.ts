import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { AppError } from '../utils/errorHandler';
import { barcodeKey, isGtin } from '../utils/barcode';
import { nextDocumentSequence } from './documentNumber.service';
import { applyInventoryImport, previewInventoryImport } from './inventoryImport.service';
import { InvoiceLine, lineUnits, normalizeInvoiceText, normalizeItemCode } from './invoiceMatching.service';
import { deliveryInvoiceDetail, effectiveStatus, invoiceLines, loadInvoice, settlePreviousImport } from './deliveryInvoice.service';

/**
 * The owner's OK on a delivery invoice: its lines become one reviewed receipt
 * import (the only way stock arrives), then the invoice is marked received and
 * every confirmed line is remembered for the next invoice from this supplier.
 *
 * Never twice: the import's id is stored on the invoice before it is applied.
 * A retry first settles that import (`settlePreviousImport`): if it was applied
 * its result is used; otherwise it is deleted, so it can never be applied later,
 * and a fresh one is made.
 */

const roundTo = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

export interface ReceiptItem {
  matchedProductId?: string;
  name: string;
  packSize: number;
  sellingUnitId?: string;
  receivedPackageQuantity?: number;
  unitQuantity: number;
  unitCost: number;
  zeroCostConfirmed: boolean;
  price?: number;
  barcode?: string | null;
  categoryId?: string;
  minimumAge?: 18 | 21;
  ebtEligible?: boolean;
  isTaxable?: boolean;
  /** Printed UPC of a new item, offered as its SKU when free. */
  upc?: string | null;
  /** The invoice lines merged into this item. */
  lines: number[];
}

/**
 * What pressing OK receives, one entry per item (the import takes one line per
 * product): two lines for one item are added together at their weighted cost.
 * Problems are listed by line, in plain words, and block receiving.
 */
export function receiptItems(lines: InvoiceLine[]): { items: ReceiptItem[]; problems: string[] } {
  const problems: string[] = [];
  const items: ReceiptItem[] = [];
  const byKey = new Map<string, ReceiptItem & { cost: number }>();
  for (const line of lines) {
    if (line.skip) continue;
    const label = `Line ${line.index + 1}`;
    if (!line.confirmed || (!line.product && !line.newItem)) { problems.push(`${label}: choose the item, add it as new, or skip it`); continue; }
    const { units, unitCost } = lineUnits(line);
    if (units <= 0) { problems.push(`${label}: enter how many arrived, or skip it`); continue; }
    if (unitCost === null) { problems.push(`${label}: enter what it cost`); continue; }
    if (line.newItem && !(line.newItem.price && line.newItem.price > 0)) { problems.push(`${label}: enter a price for the new item`); continue; }
    const key = line.product ? 'product:' + line.product.productId : 'new:' + line.newItem!.name.trim().toLowerCase() + ':' + (line.newItem!.barcode || '');
    const existing = byKey.get(key);
    if (existing) {
      existing.cost += units * unitCost;
      existing.unitQuantity += units;
      existing.lines.push(line.index);
      existing.packSize = existing.sellingUnitId ? existing.packSize : 1;
      if (line.product?.sellingUnitId && line.product.sellingUnitId === existing.sellingUnitId) existing.receivedPackageQuantity! += Math.round(line.receivedQuantity);
      else if (line.product?.sellingUnitId && !existing.sellingUnitId) {
        // A pack line joins loose units of the same item: received under the pack.
        Object.assign(existing, { sellingUnitId: line.product.sellingUnitId, packSize: line.product.unitsPerPackage!, receivedPackageQuantity: Math.round(line.receivedQuantity) });
      }
      continue;
    }
    const pack = line.product?.sellingUnitId ? line.product : null;
    // A single line of whole cases keeps its case size on the receipt; anything else is counted in units.
    const packSize = pack ? pack.unitsPerPackage! : line.unitsPerCase > 1 && units % line.unitsPerCase === 0 ? line.unitsPerCase : 1;
    const item: ReceiptItem & { cost: number } = {
      name: line.product ? line.product.name : line.newItem!.name.trim(), packSize, unitQuantity: units, unitCost, zeroCostConfirmed: false, cost: units * unitCost, lines: [line.index],
      ...(line.product ? { matchedProductId: line.product.productId } : {}),
      ...(pack ? { sellingUnitId: pack.sellingUnitId!, receivedPackageQuantity: Math.round(line.receivedQuantity) } : {}),
      ...(line.newItem ? { price: line.newItem.price!, barcode: line.newItem.barcode, upc: line.upc,
        ...(line.newItem.categoryId ? { categoryId: line.newItem.categoryId } : {}),
        ...(line.newItem.minimumAge === 18 || line.newItem.minimumAge === 21 ? { minimumAge: line.newItem.minimumAge } : {}),
        ebtEligible: line.newItem.ebtEligible, isTaxable: line.newItem.isTaxable } : {}),
    };
    byKey.set(key, item);
    items.push(item);
  }
  for (const item of items as (ReceiptItem & { cost: number })[]) {
    item.unitCost = item.unitQuantity ? roundTo(item.cost / item.unitQuantity, 4) : 0;
    item.zeroCostConfirmed = item.unitCost === 0;
    if (item.sellingUnitId && (item.receivedPackageQuantity || 0) * item.packSize > item.unitQuantity) item.receivedPackageQuantity = Math.floor(item.unitQuantity / item.packSize);
    delete (item as { cost?: number }).cost;
  }
  return { items, problems };
}

/** SKUs for new items: the barcode, else the printed UPC, else the next ITEM- number; never one the store uses. */
async function newItemSkus(locationId: string, items: ReceiptItem[]) {
  const wanted = items.filter(item => !item.matchedProductId);
  const candidates = (item: ReceiptItem) => [item.barcode, item.upc && isGtin(item.upc) ? barcodeKey(item.upc).replace(/^00(?=\d{12}$)/, '') : null]
    .filter((value): value is string => !!value && value.length <= 100);
  const taken = new Set((await prisma.product.findMany({ where: { locationId, sku: { in: wanted.flatMap(candidates) } }, select: { sku: true } })).map(row => row.sku));
  const skus = new Map<ReceiptItem, string>();
  for (const item of wanted) {
    let sku = candidates(item).find(candidate => !taken.has(candidate));
    while (!sku || taken.has(sku)) {
      const next = 'ITEM-' + await nextDocumentSequence();
      if (!await prisma.product.findFirst({ where: { locationId, sku: next }, select: { id: true } })) sku = next;
    }
    taken.add(sku);
    skus.set(item, sku);
  }
  return skus;
}

async function receiptBody(invoice: Awaited<ReturnType<typeof loadInvoice>>, items: ReceiptItem[]) {
  const supplier = invoice.supplierId ? await prisma.supplier.findFirst({ where: { id: invoice.supplierId, locationId: invoice.locationId }, select: { name: true } }) : null;
  const skus = await newItemSkus(invoice.locationId, items);
  const date = invoice.invoiceDate ? invoice.invoiceDate.toISOString().slice(0, 10) + 'T12:00:00.000Z' : undefined;
  return {
    supplier: supplier?.name ?? invoice.vendorName ?? undefined,
    invoiceNumber: invoice.invoiceNumber ?? undefined,
    invoiceDate: date,
    notes: `Delivery invoice${invoice.invoiceNumber ? ' ' + invoice.invoiceNumber : ''}, received from its photo`,
    freight: Math.max(0, Number(invoice.fees ?? 0)), acquisitionTax: Math.max(0, Number(invoice.tax ?? 0)), invoiceDiscount: Math.max(0, Number(invoice.discount ?? 0)),
    items: items.map(item => ({
      ...(item.matchedProductId ? { matchedProductId: item.matchedProductId } : { sku: skus.get(item)!, price: item.price, barcode: item.barcode || null,
        ...(item.categoryId ? { categoryId: item.categoryId } : {}), ...(item.minimumAge ? { minimumAge: item.minimumAge } : {}),
        ebtEligible: item.ebtEligible, isTaxable: item.isTaxable }),
      name: item.name, packSize: item.packSize, unitQuantity: item.unitQuantity, unitCost: item.unitCost, zeroCostConfirmed: item.zeroCostConfirmed,
      ...(item.sellingUnitId ? { sellingUnitId: item.sellingUnitId, receivedPackageQuantity: item.receivedPackageQuantity ?? 0 } : {}),
    })),
  };
}

type ImportResult = { items: { id: string; sku: string; action: string }[]; purchaseReceipt?: { receipt?: { id: string; purchaseOrderId: string } } };
const asRequest = (req: AuthRequest, extra: { body?: unknown; params?: Record<string, string> }) =>
  ({ ...req, user: req.user, params: { ...req.params, ...(extra.params || {}) }, body: extra.body ?? req.body } as unknown as AuthRequest);

/** POST /delivery-invoices/:id/receive { version }: the owner's OK. */
export async function receiveDeliveryInvoice(req: AuthRequest, id: string) {
  const { version } = z.object({ version: z.number().int().min(1) }).parse(req.body ?? {});
  const invoice = await prisma.$transaction(async tx => {
    const found = await loadInvoice(req, id, tx);
    await tx.$queryRaw`SELECT id FROM delivery_invoices WHERE id = ${found.id} FOR UPDATE`;
    return loadInvoice(req, id, tx);
  });
  if (invoice.status === 'RECEIVED') return { ...(await deliveryInvoiceDetail(invoice)), replayed: true };
  if (effectiveStatus(invoice) !== 'READY') throw new AppError(invoice.status === 'DISCARDED' ? 'This invoice was discarded' : 'This invoice is not ready to receive yet', 409);
  if (invoice.version !== version) throw new AppError('Someone else changed this invoice. Reload it to see their changes.', 409);

  // An earlier try that went through is finished, never repeated.
  if (invoice.importId) {
    const applied = await settlePreviousImport(invoice.importId);
    if (applied) return finishReceiving(req, invoice.id, invoice.importId, applied as ImportResult);
  }
  const { items, problems } = receiptItems(invoiceLines(invoice));
  if (problems.length) throw new AppError(problems.length === 1 ? problems[0] : `${problems[0]} (and ${problems.length - 1} more)`, 400, { problems });
  if (!items.length) throw new AppError('Nothing to receive: every line is skipped', 400);

  let seenImportId = invoice.importId;
  for (let attempt = 0; ; attempt++) {
    const preview = await previewInventoryImport(asRequest(req, { body: await receiptBody(invoice, items) }), 'RECEIPT');
    if (!preview.id) throw new AppError(`This delivery cannot be received yet: ${preview.errors[0]}`, 409, { problems: preview.errors });
    const stored = await prisma.deliveryInvoice.updateMany({ where: { id: invoice.id, status: 'READY', version, importId: seenImportId }, data: { importId: preview.id } });
    if (!stored.count) throw new AppError('Someone else is receiving this invoice right now. Reload it in a moment.', 409);
    seenImportId = preview.id;
    try {
      const result = await applyInventoryImport(asRequest(req, { params: { id: preview.id } }));
      return finishReceiving(req, invoice.id, preview.id, result as unknown as ImportResult);
    } catch (error) {
      // A sale or an edit changed an item since the preview: review again, once.
      if (attempt === 0 && error instanceof AppError && error.statusCode === 409 && /changed|expired|Review the import again/i.test(error.message)) {
        const applied = await settlePreviousImport(preview.id);
        if (applied) return finishReceiving(req, invoice.id, preview.id, applied as ImportResult);
        continue;
      }
      throw error;
    }
  }
}

/**
 * Mark the invoice received and remember each confirmed line: by the
 * supplier's item number and its text, with the item, pack and case size; the
 * supplier's item number, case size and case cost go on the item's supplier
 * link. Safe to run again.
 */
async function finishReceiving(req: AuthRequest, invoiceId: string, importId: string, result: ImportResult) {
  const finished = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM delivery_invoices WHERE id = ${invoiceId} FOR UPDATE`;
    const invoice = await loadInvoice(req, invoiceId, tx);
    if (invoice.status === 'RECEIVED') return invoice;
    const receipt = result.purchaseReceipt?.receipt;
    const order = receipt ? await tx.purchaseOrder.findUnique({ where: { id: receipt.purchaseOrderId }, select: { id: true, supplierId: true } }) : null;
    const lines = invoiceLines(invoice);
    const created = await tx.product.findMany({ where: { id: { in: result.items.filter(item => item.action === 'created').map(item => item.id) } }, select: { id: true, name: true } });
    const productOf = (line: InvoiceLine) => line.product?.productId
      ?? created.find(product => line.newItem && product.name.trim().toLowerCase() === line.newItem.name.trim().toLowerCase())?.id ?? null;
    const received = lines.filter(line => !line.skip && line.confirmed && lineUnits(line).units > 0);
    if (order) {
      for (const line of received) {
        const productId = productOf(line);
        if (!productId) continue;
        const normalizedText = line.normalized || normalizeInvoiceText(line.description);
        if (!normalizedText) continue;
        const itemCode = normalizeItemCode(line.itemCode);
        const sellingUnitId = line.product?.sellingUnitId ?? null;
        const unitsPerCase = !sellingUnitId && line.unit !== 'EACH' && line.unitsPerCase > 1 ? line.unitsPerCase : null;
        await tx.invoiceItemMatch.upsert({
          where: { supplierId_normalizedText: { supplierId: order.supplierId, normalizedText } },
          create: { locationId: invoice.locationId, supplierId: order.supplierId, normalizedText, itemCode, productId, sellingUnitId, unitsPerCase },
          update: { productId, sellingUnitId, unitsPerCase, ...(itemCode ? { itemCode } : {}), confirmations: { increment: 1 }, lastConfirmedAt: new Date() },
        });
      }
      const firstLine = new Map<string, InvoiceLine>();
      for (const line of received) { const productId = productOf(line); if (productId && !firstLine.has(productId)) firstLine.set(productId, line); }
      for (const [productId, line] of firstLine) {
        const caseSize = !line.product?.sellingUnitId && line.unit !== 'EACH' && line.unitsPerCase > 1 ? line.unitsPerCase : null;
        const data: Prisma.ProductSupplierUpdateManyMutationInput = {
          ...(line.itemCode ? { supplierSku: line.itemCode.trim().slice(0, 64) } : {}),
          ...(caseSize && line.caseCost !== null ? { packSize: caseSize, packCost: line.caseCost } : {}),
        };
        if (Object.keys(data).length) await tx.productSupplier.updateMany({ where: { productId, supplierId: order.supplierId }, data });
      }
    }
    const counts = { lines: received.length, units: received.reduce((sum, line) => sum + lineUnits(line).units, 0) };
    await tx.deliveryInvoice.update({ where: { id: invoice.id }, data: {
      status: 'RECEIVED', importId, purchaseOrderId: order?.id ?? null, purchaseReceiptId: receipt?.id ?? null, supplierId: order?.supplierId ?? invoice.supplierId,
      receivedById: req.user!.id, receivedAt: new Date(), version: { increment: 1 },
    } });
    await tx.activityLog.create({ data: { userId: req.user!.id, locationId: invoice.locationId, action: 'INVOICE_RECEIVED', entity: 'DELIVERY_INVOICE', entityId: invoice.id,
      details: { purchaseOrderId: order?.id ?? null, purchaseReceiptId: receipt?.id ?? null, ...counts } } });
    return loadInvoice(req, invoice.id, tx);
  });
  return { ...(await deliveryInvoiceDetail(finished)), replayed: false };
}
