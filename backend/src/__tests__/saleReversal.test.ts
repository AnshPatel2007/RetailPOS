import { refundSaleInTransaction, voidSaleInTransaction } from '../services/saleReversal.service';
import { generateSaleNumber } from '../utils/saleNumber';
import { AuthRequest } from '../types';

const request = (body: any = {}) => ({ user: { id: 'manager', role: 'MANAGER', locationId: 'store-a' }, params: { id: 'sale' }, body } as unknown as AuthRequest);

function fixture(overrides: any = {}) {
  const sale = {
    id: 'sale', saleNumber: 'SALE-1', locationId: 'store-a', status: 'COMPLETED', total: 20, tax: 0, discount: 0,
    customerId: 'customer', shiftId: 'shift', payments: [], paymentMethod: 'CASH', changeDue: 0,
    items: [{ id: 'line', productId: 'product', quantity: 2, total: 20, tax: 0, unitCost: null, sku: 'SKU', productName: 'Item' }],
    refunds: [], ...overrides,
  };
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    sale: { findUnique: jest.fn().mockResolvedValue(sale), update: jest.fn().mockImplementation(async ({ data }) => ({ ...sale, ...data })) },
    refund: { create: jest.fn().mockResolvedValue({ id: 'refund',createdAt:new Date(),amount:20,method:'CASH' }) },
    webhookEndpoint: {findMany:jest.fn().mockResolvedValue([])},
    saleVoid: { create: jest.fn().mockResolvedValue({ id: 'void' }), findUnique: jest.fn().mockResolvedValue(null) },
    product: { findUnique: jest.fn().mockResolvedValue({ id: 'product', locationId: 'store-a', stockVersion: 0, trackInventory: true, stockQuantity: 8 }), update: jest.fn().mockResolvedValue({ stockQuantity: 10, stockVersion: 1 }) },
    customer: { findUnique: jest.fn().mockResolvedValue({ id: 'customer', totalSpent: 20, loyaltyPoints: 20, visitCount: 1 }), update: jest.fn() },
    shift: { findFirst: jest.fn().mockResolvedValue({ id: 'paying-shift' }), findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'paying-shift', isClosed: false }), update: jest.fn() },
    drawerEntry: { create: jest.fn() }, inventoryLog: { create: jest.fn() }, activityLog: { create: jest.fn() },
    inventoryValuation: { findUnique: jest.fn().mockResolvedValue({ quantity: 8, value: null }), update: jest.fn() },
    inventoryValueEntry: { create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'value-entry', ...data })) },
    giftCard: { findFirst: jest.fn().mockResolvedValue({ id: 'card', locationId: 'store-a', currentBalance: 0 }), update: jest.fn() },
    saleItemCorrection: { count: jest.fn().mockResolvedValue(0) },
    inventoryException: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
  };
  return { sale, tx };
}

test('refund of remaining balance restores only units not previously restocked', async () => {
  const { tx } = fixture({ refunds: [{ amount: 10, items: [{ saleItemId: 'line', quantity: 1, restocked: true }] }] });
  await refundSaleInTransaction(request({ amount: 10, items: [{ saleItemId: 'line', quantity: 1 }], reason: 'Remaining return' }), tx);
  expect(tx.product.update).toHaveBeenCalledWith(expect.objectContaining({ data: { stockQuantity: 9 } }));
  expect(tx.inventoryLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ quantity: 1, previousQty: 8, newQty: 9, sourceId: 'refund', locationId: 'store-a', stockVersion: 1 }) });
  expect(tx.sale.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'REFUNDED' }) }));
  expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.sale.findUnique.mock.invocationCallOrder[0]);
});
test('void refuses partially refunded and fully refunded sales without touching stock', async () => {
  for (const overrides of [{ refunds: [{ amount: 10, items: [] }] }, { status: 'REFUNDED' }]) {
    const { tx } = fixture(overrides);
    await expect(voidSaleInTransaction(request(), tx)).rejects.toThrow();
    expect(tx.product.update).not.toHaveBeenCalled();
  }
});
test('void restores stock, customer totals and gift card without rewriting the original shift', async () => {
  const { tx } = fixture({ payments: [{ paymentMethod: 'GIFT_CARD', amount: 20, reference: 'CARD-1' }] });
  await voidSaleInTransaction(request(), tx);
  expect(tx.product.update).toHaveBeenCalledWith(expect.objectContaining({ data: { stockQuantity: 10 } }));
  expect(tx.customer.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ totalSpent: 0, visitCount: 0 }) }));
  expect(tx.shift.update).not.toHaveBeenCalled();
  expect(tx.drawerEntry.create).not.toHaveBeenCalled();
  expect(tx.giftCard.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ currentBalance: { increment: 20 } }) }));
});
test('repeated item IDs and excessive quantities are rejected before a refund is created', async () => {
  for (const items of [[{ saleItemId: 'line', quantity: 1 }, { saleItemId: 'line', quantity: 1 }], [{ saleItemId: 'line', quantity: 3 }]]) {
    const { tx } = fixture();
    await expect(refundSaleInTransaction(request({ items, reason: 'Return' }), tx)).rejects.toThrow();
    expect(tx.refund.create).not.toHaveBeenCalled();
  }
});
test('another store cannot reverse a sale', async () => {
  const { tx } = fixture({ locationId: 'store-b' });
  await expect(refundSaleInTransaction(request({ amount: 20 }), tx)).rejects.toThrow('access');
  expect(tx.refund.create).not.toHaveBeenCalled();
});
test('do-not-restock is honored for a full money refund', async () => {
  const { tx } = fixture();
  await refundSaleInTransaction(request({ amount: 20, restock: false, reason: 'Damaged goods' }), tx);
  expect(tx.product.update).not.toHaveBeenCalled();
});
test('concurrent registers and stores do not reuse date-count receipt numbers', () => {
  const numbers = Array.from({ length: 500 }, (_, index) => generateSaleNumber(new Date('2026-10-11T12:00:00Z'), 'America/Chicago', BigInt(100001 + index)));
  expect(new Set(numbers).size).toBe(500);
});
