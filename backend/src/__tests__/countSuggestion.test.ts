import { CountCandidate, scoreCountCandidates } from '../services/countSuggestion.service';

const now = new Date('2026-11-12T12:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86400000);
const item = (overrides: Partial<CountCandidate>): CountCandidate => ({ productId: overrides.name || 'x', name: 'x', sku: 'X', stockQuantity: 50, lowStockAlert: 5,
  lastCountedAt: daysAgo(1), inventoryValue: 0, unitsSold30: 0, adjustedRecently: false, ...overrides });

describe('suggested spot counts', () => {
  it('scores each documented part and says why', () => {
    const [scored] = scoreCountCandidates([item({ name: 'Ice', lastCountedAt: null, inventoryValue: 120, unitsSold30: 90, adjustedRecently: true, stockQuantity: 3 })], now);
    expect(scored.score).toBe(40 + 30 + 20 + 15 + 10);
    expect(scored.reasons).toEqual(['Never counted', 'High stock value ($120.00)', 'Sells often (90 in 30 days)', 'Stock adjusted by hand in the last 14 days', 'Only 3 on record, quick to count']);
  });

  it('adds a point per day since the last count, at most 40', () => {
    const scores = scoreCountCandidates([item({ name: 'a', lastCountedAt: daysAgo(3) }), item({ name: 'b', lastCountedAt: daysAgo(20) }), item({ name: 'c', lastCountedAt: daysAgo(200) })], now);
    expect(scores.map(row => [row.name, row.score])).toEqual([['c', 40], ['b', 20], ['a', 3]]);
    expect(scores[0].reasons).toEqual(['Last counted 200 days ago']);
    expect(scores[1].reasons).toEqual(['Last counted 20 days ago']);
    expect(scores[2].reasons).toEqual([]); // a recent count needs no reason
  });

  it('ranks stock value 0 to 30 and sales 0 to 20 within the store; nothing earns nothing', () => {
    const scores = scoreCountCandidates([
      item({ name: 'top', inventoryValue: 300, unitsSold30: 40 }),
      item({ name: 'middle', inventoryValue: 200, unitsSold30: 20 }),
      item({ name: 'bottom', inventoryValue: 100, unitsSold30: 10 }),
      item({ name: 'none' }),
    ], now);
    expect(scores.map(row => [row.name, row.score - 1])).toEqual([['top', 50], ['middle', 25], ['bottom', 0], ['none', 0]]);
  });

  it('counts items between 0 and the low-stock level as quick, not negative or plentiful stock', () => {
    const scores = scoreCountCandidates([item({ name: 'zero', stockQuantity: 0 }), item({ name: 'at', stockQuantity: 5 }), item({ name: 'above', stockQuantity: 6 }), item({ name: 'negative', stockQuantity: -2 })], now);
    expect(Object.fromEntries(scores.map(row => [row.name, row.score - 1]))).toEqual({ zero: 10, at: 10, above: 0, negative: 0 });
  });
});
