import { createHash } from 'crypto';
import { nextDocumentNumber } from './documentNumber.service';
import { Prisma, Product } from '@prisma/client';
import { z } from 'zod';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { AppError } from '../utils/errorHandler';
import { resolveWriteLocation } from '../utils/locationFilter.util';
import { parseProductCsv } from '../utils/productCsv';
import { lockInventory, moveInventory } from './inventory.service';
import { receiveOrder } from './purchaseReceiving.service';

const money = z.number().finite().min(0).max(1_000_000);
const fields = z.object({ sku: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(250).optional(),
  barcode: z.string().trim().max(100).optional(), price: money.positive().optional(), cost: money.optional(),
  stockQuantity: z.number().int().min(0).max(2147483647).optional(), lowStockAlert: z.number().int().min(0).max(2147483647).optional(),
  categoryId: z.string().min(1).optional(), isActive: z.boolean().optional(), trackInventory: z.boolean().optional(), isTaxable: z.boolean().optional() });
type Fields = z.infer<typeof fields>;
type Row = { number: number; data: Fields; productId: string | null; fingerprint: string | null; previousStock: number; nextStock: number; changes: { field: string; before: unknown; after: unknown }[] };
type Payload = { rows: Row[]; supplier?: string; invoiceNumber?: string; purchaseOrderId?: string; invoiceDate?: string; notes?: string;
  freight?: number; acquisitionTax?: number; invoiceDiscount?: number; receiptLines?: { packSize: number; sellingUnitId?: string; receivedPackageQuantity?: number; lineDiscount: number; damagedQty: number; rejectedQty: number; zeroCostConfirmed: boolean }[] };
const fingerprint = (p: Product) => createHash('sha256').update(JSON.stringify(p)).digest('hex');
const asJson = (input: unknown) => JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
const boolean = (input: string) => input === 'true' ? true : input === 'false' ? false : input;

export async function previewInventoryImport(req: AuthRequest, kind: 'CSV' | 'RECEIPT') {
  const locationId = resolveWriteLocation(req);
  let supplier: string | undefined, invoiceNumber: string | undefined;
  let receiptDetails: Partial<Payload> = {};
  const errors: string[] = [];
  let input: { number: number; data: unknown; matchedId?: string }[];
  if (kind === 'CSV') {
    const { csv } = z.object({ csv: z.string().min(1).max(1_000_000) }).parse(req.body);
    input = parseProductCsv(csv).map(({ number, values }) => {
      const data: Record<string, unknown> = { sku: values.sku };
      const mapping: Record<string, keyof Fields> = { name: 'name', barcode: 'barcode', price: 'price', cost: 'cost', stock: 'stockQuantity', lowstockalert: 'lowStockAlert', categoryid: 'categoryId', active: 'isActive', trackinventory: 'trackInventory', istaxable: 'isTaxable' };
      for (const [column, field] of Object.entries(mapping)) if (values[column]?.trim()) {
        data[field] = ['price', 'cost', 'stock', 'lowstockalert'].includes(column) ? Number(values[column]) : ['active', 'trackinventory', 'istaxable'].includes(column) ? boolean(values[column]) : values[column];
      }
      return { number, data };
    });
  } else {
    const body = z.object({ supplier: z.string().trim().max(250).optional(), invoiceNumber: z.string().trim().max(100).optional(),
      purchaseOrderId: z.string().min(1).optional(), invoiceDate: z.string().datetime().optional(),
      notes: z.string().trim().max(2000).optional(),
      freight: money.default(0), acquisitionTax: money.default(0), invoiceDiscount: money.default(0),
      items: z.array(z.object({ matchedProductId: z.string().min(1).nullish(), name: z.string().trim().min(1).max(250),
        packSize: z.number().int().min(1).max(100000).default(1), lineDiscount: money.default(0),
        sellingUnitId: z.string().uuid().optional(), receivedPackageQuantity: z.number().int().min(0).max(1000000).optional(),
        damagedQty: z.number().int().min(0).max(1000000).default(0), rejectedQty: z.number().int().min(0).max(1000000).default(0),
        unitQuantity: z.number().int().min(0).max(1_000_000), unitCost: money, zeroCostConfirmed: z.boolean().default(false), price: money.positive().optional(),
        sku: z.string().trim().max(100).optional(), barcode: z.string().max(100).nullish(), categoryId: z.string().optional() })).min(1).max(500) }).parse(req.body);
    supplier = body.supplier; invoiceNumber = body.invoiceNumber;
    if (body.items.some(i => i.damagedQty || i.rejectedQty) && !body.notes) throw new AppError('Add a reason for damaged or rejected invoice items', 400);
    if (body.items.some(i => !i.unitQuantity && !i.damagedQty && !i.rejectedQty)) throw new AppError('Each invoice line needs a delivered quantity', 400);
    if (body.items.some(i => i.unitQuantity > 0 && i.unitCost === 0 && !i.zeroCostConfirmed)) throw new AppError('Confirm free goods explicitly, or enter their actual unit cost', 400);
    const formats = await prisma.productSellingUnit.findMany({ where: { locationId, OR: [
      { id: { in: body.items.flatMap(item => item.sellingUnitId ? [item.sellingUnitId] : []) } },
      { barcode: { in: body.items.flatMap(item => item.barcode ? [item.barcode.trim()] : []) } },
    ] } });
    const resolved = body.items.map((item, index) => {
      const byBarcode = item.barcode ? formats.find(format => format.barcode === item.barcode!.trim()) : undefined;
      const format = item.sellingUnitId ? formats.find(candidate => candidate.id === item.sellingUnitId) : byBarcode;
      if (item.sellingUnitId && !format) errors.push(`Row ${index + 1}: package is not available at this store`);
      if (format && (!format.isActive || (item.matchedProductId && format.productId !== item.matchedProductId))) errors.push(`Row ${index + 1}: package does not match the selected active product`);
      if (byBarcode && item.sellingUnitId && byBarcode.id !== item.sellingUnitId) errors.push(`Row ${index + 1}: barcode belongs to a different package`);
      if (format && item.packSize !== format.unitsPerPackage) errors.push(`Row ${index + 1}: this package contains ${format.unitsPerPackage} units. Review the quantity and purchase cost before importing.`);
      if ((item.receivedPackageQuantity || 0) > 0 && (!format || item.receivedPackageQuantity! * format.unitsPerPackage > item.unitQuantity)) errors.push(`Row ${index + 1}: sealed packages exceed accepted units`);
      return { ...item, matchedProductId: format?.productId ?? item.matchedProductId, sellingUnitId: format?.id ?? item.sellingUnitId };
    });
    receiptDetails = { purchaseOrderId: body.purchaseOrderId, invoiceDate: body.invoiceDate, freight: body.freight, notes: body.notes,
      acquisitionTax: body.acquisitionTax, invoiceDiscount: body.invoiceDiscount,
      receiptLines: resolved.map(i => ({ packSize: i.packSize, sellingUnitId: i.sellingUnitId, receivedPackageQuantity: i.receivedPackageQuantity ?? 0, lineDiscount: i.lineDiscount, damagedQty: i.damagedQty, rejectedQty: i.rejectedQty, zeroCostConfirmed: i.zeroCostConfirmed })) };
    const matched = await prisma.product.findMany({ where: { locationId, id: { in: resolved.map(i => i.matchedProductId).filter((id): id is string => !!id) } } });
    input = resolved.map((item, i) => {
      const current = matched.find(p => p.id === item.matchedProductId);
      if (item.matchedProductId && !current) errors.push(`Row ${i + 1}: product is not available at this store`);
      return { number: i + 1, matchedId: item.matchedProductId || undefined,
        data: current ? { sku: current.sku, cost: item.unitCost, stockQuantity: item.unitQuantity }
          : { sku: item.sku, name: item.name, cost: item.unitCost, price: item.price, stockQuantity: item.unitQuantity,
            ...(item.barcode ? { barcode: item.barcode } : {}), ...(item.categoryId ? { categoryId: item.categoryId } : {}) } };
    });
  }
  const validated: { number: number; data: Fields; matchedId?: string }[] = [];
  const seen = new Set<string>();
  for (const row of input) {
    const parsed = fields.safeParse(row.data);
    if (!parsed.success) { errors.push(`Row ${row.number}: ${parsed.error.issues.map(i => i.path.join('.') + ': ' + i.message).join('; ')}`); continue; }
    if (parsed.data.sku === 'MISC-001') errors.push(`Row ${row.number}: MISC is reserved for checkout`);
    if (seen.has(parsed.data.sku)) errors.push(`Row ${row.number}: duplicate SKU ${parsed.data.sku}`);
    seen.add(parsed.data.sku); validated.push({ ...row, data: parsed.data });
  }
  const existing = await prisma.product.findMany({ where: { locationId, sku: { in: validated.map(row => row.data.sku) } } });
  const categories = await prisma.category.findMany({ where: { locationId, id: { in: validated.map(row => row.data.categoryId).filter((id): id is string => !!id) } }, select: { id: true } });
  const barcodes = await prisma.product.findMany({ where: { locationId, barcode: { in: validated.map(row => row.data.barcode).filter((code): code is string => !!code) } }, select: { id: true, barcode: true } });
  const packageBarcodes = await prisma.productSellingUnit.findMany({ where: { locationId, barcode: { in: validated.flatMap(row => row.data.barcode ? [row.data.barcode] : []) } }, select: { barcode: true } });
  const seenBarcodes = new Set<string>();
  const rows: Row[] = validated.map(row => {
    const current = existing.find(p => p.sku === row.data.sku);
    if (!current && (!row.data.name || !row.data.price)) errors.push(`Row ${row.number}: new products require name and price`);
    if (kind === 'RECEIPT' && current && !row.matchedId) errors.push(`Row ${row.number}: this SKU already exists; explicitly match the existing product`);
    if (row.data.categoryId && !categories.some(c => c.id === row.data.categoryId)) errors.push(`Row ${row.number}: category is not available at this store`);
    if (row.data.barcode) {
      if (seenBarcodes.has(row.data.barcode) || barcodes.some(p => p.barcode === row.data.barcode && p.id !== current?.id) || packageBarcodes.some(p => p.barcode === row.data.barcode)) errors.push(`Row ${row.number}: barcode already belongs to another product or package`);
      seenBarcodes.add(row.data.barcode);
    }
    const tracked = row.data.trackInventory ?? current?.trackInventory ?? true;
    const previousStock = current?.stockQuantity || 0;
    const nextStock = row.data.stockQuantity === undefined ? previousStock : kind === 'RECEIPT' ? previousStock + row.data.stockQuantity : row.data.stockQuantity;
    if (!tracked && nextStock !== previousStock) errors.push(`Row ${row.number}: cannot import stock for an untracked product`);
    if (nextStock > 2147483647) errors.push(`Row ${row.number}: stock exceeds the supported quantity`);
    return { number: row.number, data: row.data, productId: current?.id || null, fingerprint: current ? fingerprint(current) : null, previousStock, nextStock,
      changes: Object.entries(row.data).filter(([key, value]) => key !== 'sku' && (key === 'stockQuantity' ? nextStock !== previousStock : !current || Number(current[key as keyof Product]) !== value))
        .map(([key, value]) => ({ field: key, before: Number(current ? current[key as keyof Product] : null), after: key === 'stockQuantity' ? nextStock : value })) };
  });
  if (errors.length) return { id: null, errors, rows, total: input.length, created: 0, updated: 0 };
  const preview = { rows, total: rows.length, created: rows.filter(r => !r.productId).length, updated: rows.filter(r => r.productId).length, errors: [] };
  const record = await prisma.inventoryImport.create({ data: { locationId, userId: req.user!.id, kind,
    payload: asJson({ rows, supplier, invoiceNumber, ...receiptDetails }), preview: asJson(preview), expiresAt: new Date(Date.now() + 15 * 60000) } });
  return { ...preview, id: record.id, expiresAt: record.expiresAt, kind };
}

export async function applyInventoryImport(req: AuthRequest) {
  const id = z.string().uuid().parse(req.params.id);
  const locationId = resolveWriteLocation(req);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM inventory_imports WHERE id = ${id} FOR UPDATE`;
    const record = await tx.inventoryImport.findUnique({ where: { id } });
    if (!record || record.locationId !== locationId || record.userId !== req.user!.id) throw new AppError('Import not found', 404);
    if (record.appliedAt) return { ...(record.result as object), replayed: true };
    if (record.expiresAt < new Date()) throw new AppError('This preview expired. Review the import again.', 409);
    const payload = record.payload as unknown as Payload;
    if (payload.purchaseOrderId) await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${payload.purchaseOrderId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM locations WHERE id = ${locationId} FOR NO KEY UPDATE`;
    await lockInventory(tx, payload.rows.flatMap(row => row.productId ? [row.productId] : []));
    let supplierId: string | undefined;
    if (payload.supplier || record.kind === 'RECEIPT') {
      const name = payload.supplier || 'Unspecified supplier';
      const supplier = await tx.supplier.findFirst({ where: { locationId, name: { equals: name, mode: 'insensitive' }, isActive: true } });
      supplierId = supplier?.id || (await tx.supplier.create({ data: { name, locationId } })).id;
    }
    const items: { id: string; sku: string; action: string; previousStock: number; stockQuantity: number }[] = [];
    for (const row of [...payload.rows].sort((a, b) => a.data.sku.localeCompare(b.data.sku))) {
      let product = await tx.product.findFirst({ where: { locationId, sku: row.data.sku } });
      if (row.productId ? !product || product.id !== row.productId || fingerprint(product) !== row.fingerprint : !!product) throw new AppError(`Row ${row.number}: ${row.data.sku} changed since preview. Review the import again.`, 409);
      if (row.data.categoryId && !await tx.category.findFirst({ where: { id: row.data.categoryId, locationId } })) throw new AppError(`Row ${row.number}: category is no longer available`, 409);
      if (row.data.barcode && await tx.product.findFirst({ where: { locationId, barcode: row.data.barcode, ...(product ? { id: { not: product.id } } : {}) } })) throw new AppError(`Row ${row.number}: barcode is no longer available`, 409);
      if (row.data.barcode && await tx.productSellingUnit.findFirst({ where: { locationId, barcode: row.data.barcode } })) throw new AppError(`Row ${row.number}: barcode belongs to a linked package. Review the import again.`, 409);
      const { stockQuantity: _stock, ...updates } = row.data;
      if (product && updates.trackInventory !== undefined && updates.trackInventory !== product.trackInventory &&
        (product.stockQuantity !== 0 || await tx.inventoryValueEntry.count({ where: { productId: product.id } })))
        throw new AppError(`Row ${row.number}: stock tracking cannot change after inventory activity; archive the product instead.`, 409);
      const previousVersion = product?.stockVersion;
      product = product ? await tx.product.update({ where: { id: product.id }, data: updates })
        : await tx.product.create({ data: { ...updates, name: updates.name!, price: updates.price!, cost: updates.cost || 0, locationId, stockQuantity: 0 } });
      if (record.kind === 'CSV' && row.nextStock !== product.stockQuantity) product = await moveInventory(tx, { productId: product.id, locationId, userId: req.user!.id,
        type: 'IMPORT', sourceId: id, setQuantity: row.nextStock, expectedVersion: previousVersion, notes: 'Reviewed CSV import' });
      if (supplierId) await tx.productSupplier.upsert({ where: { productId_supplierId: { productId: product.id, supplierId } }, create: { productId: product.id, supplierId, cost: product.cost }, update: { cost: product.cost } });
      items.push({ id: product.id, sku: product.sku, action: row.productId ? 'updated' : 'created', previousStock: row.previousStock, stockQuantity: product.stockQuantity });
    }
    let purchaseReceipt: unknown;
    if (record.kind === 'RECEIPT') {
      let orderId = payload.purchaseOrderId;
      if (orderId) {
        const order = await tx.purchaseOrder.findFirst({ where: { id: orderId, locationId } });
        if (!order) throw new AppError('Linked order is not available at this store', 400);
        if (payload.supplier && order.supplierId !== supplierId) throw new AppError('Invoice supplier differs from the linked order', 400);
      } else {
        const order = await tx.purchaseOrder.create({ data: { orderNumber: await nextDocumentNumber('INV', tx), supplierId: supplierId!, locationId,
          status: 'ORDERED', orderedAt: new Date(), notes: 'Reviewed invoice import', totalAmount: payload.rows.reduce((sum, row) => sum + (row.data.cost || 0) * (row.nextStock - row.previousStock), 0),
          items: { create: payload.rows.map((row, index) => { const product = items.find(i => i.sku === row.data.sku)!; const details = payload.receiptLines?.[index];
            const quantity = row.nextStock - row.previousStock + (details?.damagedQty || 0) + (details?.rejectedQty || 0);
            return { productId: product.id, sku: row.data.sku, productName: row.data.name || row.data.sku, quantity, cost: row.data.cost || 0, total: quantity * (row.data.cost || 0) }; }) } } });
        orderId = order.id;
      }
      purchaseReceipt = await receiveOrder(tx, { ...req, user: req.user, params: { ...req.params, id: orderId }, body: {
        idempotencyKey: id, invoiceNumber: payload.invoiceNumber || undefined, invoiceDate: payload.invoiceDate,
        freight: payload.freight, acquisitionTax: payload.acquisitionTax, invoiceDiscount: payload.invoiceDiscount,
        notes: payload.notes || 'Reviewed invoice import ' + (payload.invoiceNumber || id),
        receivedItems: payload.rows.map((row, index) => { const details = payload.receiptLines?.[index]; return {
          productId: items.find(i => i.sku === row.data.sku)!.id, quantity: row.nextStock - row.previousStock,
          unitCost: (row.data.cost || 0) * (details?.packSize || 1), packSize: details?.packSize || 1, lineDiscount: details?.lineDiscount || 0,
          sellingUnitId: details?.sellingUnitId, receivedPackageQuantity: details?.receivedPackageQuantity || 0,
          zeroCostConfirmed: details?.zeroCostConfirmed || false,
          damagedQty: details?.damagedQty || 0, rejectedQty: details?.rejectedQty || 0 }; }) },
      } as unknown as AuthRequest);
      for (const item of items) item.stockQuantity = payload.rows.find(row => row.data.sku === item.sku)!.nextStock;
    }
    const result = { id, total: items.length, created: items.filter(i => i.action === 'created').length, updated: items.filter(i => i.action === 'updated').length, items, ...(purchaseReceipt ? { purchaseReceipt } : {}) };
    await tx.inventoryImport.update({ where: { id }, data: { result: asJson(result), appliedAt: new Date() } });
    await tx.activityLog.create({ data: { userId: req.user!.id, locationId, action: 'IMPORT', entity: 'INVENTORY', entityId: id, details: { kind: record.kind, created: result.created, updated: result.updated } } });
    return { ...result, replayed: false };
  }, { timeout: 30000 }).catch(error => {
    // A concurrent catalog edit can win a unique SKU/barcode constraint after
    // our validation. The transaction rolled back, so require a fresh review.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError('A SKU or barcode changed while applying this import. Review the import again.', 409);
    }
    throw error;
  });
}
