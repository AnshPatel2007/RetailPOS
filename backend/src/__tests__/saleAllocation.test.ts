import { allocateUnits, allocateSale, allocateReturn } from '../services/saleAllocation.service';

test('allocations conserve every cent and use stable tie breaking', () => {
  expect(allocateUnits(100, [1, 1, 1])).toEqual([34, 33, 33]);
  expect(allocateUnits(0, [0, 0])).toEqual([0, 0]);
  const total = 99999999999;
  expect(allocateUnits(total, [total, total - 1, 7]).reduce((a, b) => a + b, 0)).toBe(total);
  for (let n = 1; n <= 80; n++) {
    const weights = [n, n * 3, n * 2 + 1];
    const allocated = allocateUnits(n * 7, weights);
    expect(allocated.reduce((a, b) => a + b, 0)).toBe(n * 7);
    expect(allocated.every(Number.isSafeInteger)).toBe(true);
  }
});

test('line allocations conserve charged money, earned points and redeemed points', () => {
  const lines = allocateSale([{ total: 1.1 }, { total: 2.2 }], 1, 100, 0.07, 2);
  expect(lines.reduce((n, line) => n + Math.round(line.total * 100), 0)).toBe(237);
  expect(lines.reduce((n, line) => n + line.pointsRedeemed, 0)).toBe(100);
  expect(lines.reduce((n, line) => n + line.pointsEarned, 0)).toBe(2);
  expect(lines.reduce((n, line) => n + Math.round(line.surcharge * 100), 0)).toBe(7);
});

test('a last-unit return uses only the remaining cash and points after an earlier adjustment', () => {
  const line = { id: 'line', productId: 'p', productName: 'Product', quantity: 2, total: 1, tax: 0.1, pointsEarned: 1, pointsRedeemed: 50, unitCost: 0.2 };
  const history = [{ saleItemId: 'line', quantity: 1, amount: 0.5, pointsRestored: 25, pointsReversed: 0, taxAmount: 0.05 }, { saleItemId: 'line', quantity: 0, amount: 0.4, pointsRestored: 20, pointsReversed: 0, taxAmount: 0.04 }];
  expect(allocateReturn([line], history, [{ saleItemId: 'line', quantity: 1 }], undefined, true)[0]).toMatchObject({ amount: 0.1, pointsRestored: 5, pointsReversed: 1, taxAmount: 0.01, costReturned: 0.2 });
});
