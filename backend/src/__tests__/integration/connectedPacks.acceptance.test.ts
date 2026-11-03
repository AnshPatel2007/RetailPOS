/**
 * Connected packs (requirements spec sections 5-12, acceptance tests 4-7, 10).
 *
 * A can and its 12-pack are one product: one stock count in cans, one cost.
 * The 12-pack has its own barcode and price; unopened packs are a sub-count of
 * the cans. Suppliers sell in cases, so orders are entered in cases and stored
 * in cans.
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';

describe('Connected packs', () => {
  let data: TestData, owner: string, cola: string, supplier: string;
  const post = (path: string, body: object) => request(app).post(path).set('Authorization', 'Bearer ' + owner).send(body);
  const get = (path: string) => request(app).get(path).set('Authorization', 'Bearer ' + owner);
  const CAN = '049000000001', TWELVE = '049000000012', CASE = '049000000024';

  beforeEach(async () => {
    data = await seedTestData();
    owner = await createTestToken(data.adminUser.id, 'ADMIN');
    await prisma.shift.create({ data: { userId: data.adminUser.id, locationId: data.location.id, clockInAt: new Date() } });
    // Order and supplier validators take real (UUID) ids.
    cola = (await prisma.product.create({ data: { name: 'Cola Can', sku: 'COLA-CAN', barcode: CAN, price: 1.25, cost: 0.5, isTaxable: false, stockQuantity: 0, lowStockAlert: 0,
      locationId: data.location.id, categoryId: data.category.id } })).id;
    supplier = (await prisma.supplier.create({ data: { name: 'Cola Bottling', locationId: data.location.id } })).id;
  });

  const product = () => prisma.product.findUniqueOrThrow({ where: { id: cola } });
  const balance = () => prisma.inventoryValuation.findUniqueOrThrow({ where: { productId: cola } });
  const sealed = async (unitId: string) => (await prisma.productSellingUnit.findUniqueOrThrow({ where: { id: unitId } })).sealedQuantity;
  const opening = async (quantity: number, value: number) => {
    const current = await product();
    await post('/api/financial/inventory-costs/opening', { idempotencyKey: randomUUID(), notes: 'Verified physical count and supplier invoice',
      items: [{ productId: cola, quantity, value, expectedVersion: current.stockVersion }] }).expect(200);
  };
  const createPack = async (unitsPerPackage = 12, price = 9.99, barcode = TWELVE) =>
    (await post(`/api/products/${cola}/selling-units`, { name: `${unitsPerPackage}-pack`, barcode, unitsPerPackage, price, baseUnitName: 'can' }).expect(201))
      .body.data.sellingUnits.find((unit: { unitsPerPackage: number }) => unit.unitsPerPackage === unitsPerPackage) as { id: string; version: number };
  const countSealed = async (unitId: string, quantity: number, action: 'count' | 'open' = 'count') => {
    const [current, unit] = await Promise.all([product(), prisma.productSellingUnit.findUniqueOrThrow({ where: { id: unitId } })]);
    return (await post(`/api/products/${cola}/selling-units/${unitId}/packaging`, { action, quantity, expectedVersion: unit.version,
      expectedStockVersion: current.stockVersion, requestKey: randomUUID() }).expect(200)).body.data;
  };
  const sell = (items: { productId: string; quantity: number; price: number }[]) =>
    post('/api/sales', { items, paymentMethod: 'CASH', idempotencyKey: randomUUID(),
      amountPaid: Math.ceil(items.reduce((sum, item) => sum + item.quantity * item.price, 0)) + 1 });
  const caseOrder = async (cases = 4) => {
    const order = (await post('/api/purchase-orders', { supplierId: supplier,
      items: [{ productId: cola, quantity: cases * 24, cost: 1.5, packSize: 24, packQuantity: cases, packCost: 36 }] }).expect(201)).body.data;
    await prisma.purchaseOrder.update({ where: { id: order.id }, data: { status: 'ORDERED' } });
    return order;
  };

  it('4. orders 4 cases of 24 as 96 cans at $1.50 and receives them as unopened cases', async () => {
    await post(`/api/suppliers/${supplier}/products`, { productId: cola, supplierSku: 'COLA-24', packSize: 24, packCost: 36 }).expect(201);
    const packaging = (await get(`/api/products/${cola}/selling-units`).expect(200)).body.data;
    expect(packaging.suppliers).toEqual([expect.objectContaining({ supplierId: supplier, packSize: 24, packCost: 36, cost: 1.5, supplierSku: 'COLA-24' })]);

    // Cases and units must agree.
    await post('/api/purchase-orders', { supplierId: supplier,
      items: [{ productId: cola, quantity: 90, cost: 1.5, packSize: 24, packQuantity: 4, packCost: 36 }] }).expect(400);
    const order = await caseOrder(4);
    expect(order.items[0]).toMatchObject({ quantity: 96, packSize: 24, packQuantity: 4 });
    expect(Number(order.items[0].cost)).toBe(1.5);
    expect(Number(order.items[0].total)).toBe(144);
    expect(Number(order.totalAmount)).toBe(144);

    const caseUnit = await createPack(24, 17.99, CASE);
    const detail = (await get('/api/purchase-orders/' + order.id).expect(200)).body.data;
    expect(detail.items[0].sellingUnits).toEqual([expect.objectContaining({ id: caseUnit.id, unitsPerPackage: 24 })]);

    await post(`/api/purchase-orders/${order.id}/receive`, { idempotencyKey: randomUUID(), receivedItems: [{ purchaseOrderItemId: order.items[0].id,
      quantity: 96, packSize: 24, packQuantity: 4, unitCost: 36, sellingUnitId: caseUnit.id }] }).expect(200);
    expect((await product()).stockQuantity).toBe(96);
    expect(await sealed(caseUnit.id)).toBe(4);
    expect(Number((await balance()).value)).toBe(144);
  });

  it('5. opening a pack moves it to loose stock without changing stock or value', async () => {
    await opening(24, 12);
    const pack = await createPack();
    await countSealed(pack.id, 2);
    const view = await countSealed(pack.id, 1, 'open');
    expect(view).toMatchObject({ stockQuantity: 24, looseStockQuantity: 12 });
    expect(await sealed(pack.id)).toBe(1);
    expect((await balance()).quantity).toBe(24);
    expect(Number((await balance()).value)).toBe(12);
  });

  it('6-7. sells loose cans and a 12-pack from the same stock at the right price and cost', async () => {
    await opening(24, 12);
    const pack = await createPack();
    await countSealed(pack.id, 2);

    // The register finds the pack by its barcode; inventory lists the product once.
    const found = (await get(`/api/products?search=${TWELVE}&includeSellingUnits=true`).expect(200)).body.data;
    expect(found).toEqual(expect.arrayContaining([expect.objectContaining({ id: pack.id, name: 'Cola Can (12-pack)', inventoryProductId: cola, unitsPerPackage: 12 })]));
    expect(Number(found.find((row: { id: string }) => row.id === pack.id).price)).toBe(9.99);
    const listed = (await get('/api/products?search=Cola').expect(200)).body.data;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: cola, looseStockQuantity: 0 });

    // 3 loose cans: no loose stock was recorded, so one pack is opened.
    await sell([{ productId: cola, quantity: 3, price: 1.25 }]).expect(201);
    expect((await product()).stockQuantity).toBe(21);
    expect(await sealed(pack.id)).toBe(1);

    const sale = (await sell([{ productId: pack.id, quantity: 1, price: 9.99 }]).expect(201)).body.data;
    expect((await product()).stockQuantity).toBe(9);
    expect(await sealed(pack.id)).toBe(0);
    const line = await prisma.saleItem.findUniqueOrThrow({ where: { id: sale.items[0].id } });
    expect(line).toMatchObject({ productId: cola, sellingUnitId: pack.id, unitsPerPackage: 12, inventoryQuantity: 12, quantity: 1, productName: 'Cola Can (12-pack)' });
    expect(Number(line.price)).toBe(9.99);
    expect(Number(line.costAmount)).toBe(6); // 12 cans at $0.50

    // Records show no unopened pack left, but the customer has one: sell it and log it.
    await sell([{ productId: pack.id, quantity: 1, price: 9.99 }]).expect(201);
    expect((await product()).stockQuantity).toBe(-3);
    expect(await prisma.productPackagingEvent.count({ where: { sellingUnitId: pack.id, kind: 'SOLD_BEYOND_SEALED' } })).toBe(1);
    expect(await prisma.inventoryException.findUnique({ where: { openProductId: cola } })).not.toBeNull();
  });

  it('quotes a pack at its own price', async () => {
    const pack = await createPack();
    const quote = (await post('/api/sales/quote', { items: [{ productId: pack.id, quantity: 2, price: 9.99 }] }).expect(200)).body.data;
    expect(quote.total).toBe(19.98);
    expect(quote.products[0]).toMatchObject({ id: pack.id, inventoryProductId: cola });
  });

  it('returns an unopened pack as a pack, and a void puts back the packs it used', async () => {
    await opening(24, 12);
    const pack = await createPack();
    await countSealed(pack.id, 2);

    const returned = (await sell([{ productId: pack.id, quantity: 1, price: 9.99 }]).expect(201)).body.data;
    expect(await sealed(pack.id)).toBe(1);
    await post(`/api/sales/${returned.id}/refund`, { items: [{ saleItemId: returned.items[0].id, quantity: 1, restockAsSealed: true }], reason: 'Unopened' }).expect(200);
    expect((await product()).stockQuantity).toBe(24);
    expect(await sealed(pack.id)).toBe(2);
    expect(await prisma.refundItem.findFirstOrThrow({ where: { saleItemId: returned.items[0].id } })).toMatchObject({ restocked: true, restockedAsSealed: true });
    expect(Number((await balance()).value)).toBe(12);

    const voided = (await sell([{ productId: pack.id, quantity: 1, price: 9.99 }]).expect(201)).body.data;
    await post(`/api/sales/${voided.id}/void`, { reason: 'Rang up by mistake' }).expect(200);
    expect((await product()).stockQuantity).toBe(24);
    expect(await sealed(pack.id)).toBe(2);
    expect(Number((await balance()).value)).toBe(12);
  });

  it('10. receives part of a case order and keeps the rest open', async () => {
    const order = await caseOrder(4);
    await post(`/api/purchase-orders/${order.id}/receive`, { idempotencyKey: randomUUID(), receivedItems: [{ purchaseOrderItemId: order.items[0].id,
      quantity: 48, packSize: 24, packQuantity: 2, unitCost: 36 }] }).expect(200);
    const after = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    expect(after.status).toBe('PARTIALLY_RECEIVED');
    expect(after.items[0].receivedQty).toBe(48);
    expect((await product()).stockQuantity).toBe(48);
    expect(Number((await balance()).value)).toBe(72);
  });

  it('suggests orders in whole cases and counts a 12-pack sold as 12 cans of demand', async () => {
    await prisma.product.update({ where: { id: cola }, data: { lowStockAlert: 10 } });
    await post(`/api/suppliers/${supplier}/products`, { productId: cola, packSize: 24, packCost: 36 }).expect(201);
    await opening(24, 12);
    const pack = await createPack();
    await sell([{ productId: pack.id, quantity: 1, price: 9.99 }, { productId: cola, quantity: 5, price: 1.25 }]).expect(201);
    const suggested = (await get('/api/purchase-orders/suggested').expect(200)).body.data.suppliers;
    const item = suggested.flatMap((group: { items: object[] }) => group.items).find((row: { productId: string }) => row.productId === cola);
    // Below the alert (7 <= 10): restore 2x the alert (13 cans), rounded up to a case of 24.
    expect(item).toMatchObject({ stock: 7, suggestedQty: 24, packSize: 24, packCost: 36, velocityPerDay: 0.57 });
  });

  it('keeps barcodes unique across products and packs', async () => {
    await createPack();
    const res = await post('/api/products', { sku: 'COLA-12-DUP', name: 'Duplicate', price: 1, cost: 0.5, barcode: TWELVE });
    expect(res.status).toBe(409);
    await post(`/api/products/${cola}/selling-units`, { name: 'Case', barcode: CAN, unitsPerPackage: 24, price: 17.99 }).expect(409);
  });
});
