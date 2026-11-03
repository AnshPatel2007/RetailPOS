import { getRefundTenderOptions, planRefundTenders } from '../services/refundTenders.service';
import { calculateStagedSnapTaxPlan } from '../services/snapTaxPlan.service';
import { assertCheckoutTendersAvailable, assertReversalTendersAvailable } from '../services/tenderAvailability.service';

const sale = (extra: object = {}) => ({ total: 30, changeDue: 10, paymentMethod: 'CASH', customerId: 'customer',
  payments: [{ id: 'cash', paymentMethod: 'CASH', amount: 20 }, { id: 'card', paymentMethod: 'CARD', amount: 20, reference: 'ORIGINAL-CHARGE' }], refunds: [], ...extra });

test('refund capacities subtract cash change and keep original payment source identities', () => {
  expect(getRefundTenderOptions(sale())).toEqual(expect.arrayContaining([
    expect.objectContaining({ sourcePaymentId: 'cash', originalAmount: 10, remainingAmount: 10 }),
    expect.objectContaining({ sourcePaymentId: 'card', originalAmount: 20, remainingAmount: 20 }),
  ]));
  expect(() => planRefundTenders(sale(), 11, { refundMethod: 'CASH' })).toThrow('remaining amount');
});
test('mixed return payouts total exactly and require external-card evidence', () => {
  const input = [{ sourcePaymentId: 'cash', method: 'CASH', amount: 10 }, { sourcePaymentId: 'card', method: 'CARD', amount: 20, reference: 'REFUND-123' }];
  const result = planRefundTenders(sale(), 30, { refundTenders: input });
  expect(result.find(row => row.method === 'CARD')).toMatchObject({ originalReference: 'ORIGINAL-CHARGE', reference: 'REFUND-123' });
  expect(() => planRefundTenders(sale(), 29, { refundTenders: input })).toThrow('equal');
  expect(() => planRefundTenders(sale(), 30, { refundTenders: input.map(row => ({ ...row, reference: undefined })) })).toThrow('terminal');
  expect(() => planRefundTenders(sale({ refunds: [{ amount: 1, method: 'CARD', reference: 'REFUND-123' }] }), 1, { refundMethod: 'CARD', reference: 'REFUND-123' })).toThrow('already recorded');
});
test('cash cannot become card and original account value cannot become cash', () => {
  expect(() => planRefundTenders(sale(), 1, { refundTenders: [{ sourcePaymentId: 'cash', method: 'CARD', amount: 1, reference: 'FAKE' }] })).toThrow('original tender');
  const gift = sale({ total: 20, changeDue: 0, payments: [{ id: 'gift', paymentMethod: 'GIFT_CARD', amount: 20, reference: 'GIFT-1' }] });
  expect(() => planRefundTenders(gift, 1, { refundMethod: 'CASH' })).toThrow();
  expect(() => planRefundTenders(gift, 1, { refundTenders: [{ sourcePaymentId: 'gift', method: 'GIFT_CARD', amount: 1, reference: 'GIFT-2' }] })).toThrow('original gift');
  expect(planRefundTenders(gift, 20, { refundMethod: 'GIFT_CARD' })[0].reference).toBe('GIFT-1');
});
test('store-credit alternatives consume the selected original source and cannot be refunded again', () => {
  const original = sale();
  const tenders = planRefundTenders(original, 10, { refundTenders: [{ sourcePaymentId: 'cash', method: 'STORE_CREDIT', amount: 10 }] });
  const after = { ...original, refunds: [{ amount: 10, method: 'STORE_CREDIT', tenders }] };
  expect(getRefundTenderOptions(after).find(row => row.sourcePaymentId === 'cash')?.remainingAmount).toBe(0);
  expect(() => planRefundTenders(after, 1, { refundMethod: 'CASH' })).toThrow();
  expect(() => planRefundTenders({ ...original, customerId: null }, 1, { refundMethod: 'STORE_CREDIT' })).toThrow('linked customer');
});
test('legacy partial payouts are accepted only with unambiguous source history', () => {
  expect(getRefundTenderOptions(sale({ refunds: [{ amount: 3, method: 'CASH' }] })).find(row => row.sourcePaymentId === 'cash')?.remainingAmount).toBe(7);
  expect(() => getRefundTenderOptions(sale({ refunds: [{ amount: 3, method: 'STORE_CREDIT' }] }))).toThrow('no complete');
  expect(() => getRefundTenderOptions(sale({ refunds: [{ amount: 11, method: 'CASH' }] }))).toThrow('exceed');
  expect(getRefundTenderOptions(sale({ total: 5, payments: [], refunds: [{ amount: 2, method: null }] }))[0].remainingAmount).toBe(3);
});
test('malformed recorded allocations and mismatched original payments fail closed', () => {
  expect(() => getRefundTenderOptions(sale({ total: 31 }))).toThrow('do not reconcile');
  expect(() => getRefundTenderOptions(sale({ refunds: [{ amount: 1, tenders: [{ sourcePaymentId: 'cash', originalMethod: 'CASH', method: 'CASH', amount: 2 }] }] }))).toThrow('do not match');
  expect(() => planRefundTenders(sale(), 2, { refundTenders: [{ sourcePaymentId: 'cash', method: 'CASH', amount: 1 }, { sourcePaymentId: 'cash', method: 'CASH', amount: 1 }] })).toThrow('one positive');
});
test('points-only returns contain no monetary payouts and unsupported tenders remain blocked', () => {
  expect(planRefundTenders(sale({ total: 0, payments: [] }), 0, {})).toEqual([]);
  expect(() => planRefundTenders(sale({ total: 0, payments: [] }), 0, { refundTenders: [{ sourcePaymentId: 'legacy:CASH', method: 'CASH', amount: 1 }] })).toThrow();
  expect(() => planRefundTenders(sale({ total: 3, payments: [], paymentMethod: 'OTHER' }), 1, {})).toThrow('reviewed external');
});
test('staged SNAP math exempts only eligible SNAP principal and keeps other tender sales tax', () => {
  const result = calculateStagedSnapTaxPlan([{ id: 'food', discountedPrincipal: 10, snapEligible: true, taxRatePercent: 10 },
    { id: 'liquor', discountedPrincipal: 20, snapEligible: false, ageRestricted: true, taxRatePercent: 10 }], 6);
  expect(result).toMatchObject({ status: 'STAGED_ONLY', snapAmount: 6, tax: 2.4, total: 32.4, otherTenderAmount: 26.4 });
  expect(result.lines[0]).toMatchObject({ snapPrincipal: 6, taxablePrincipal: 4, tax: 0.4 });
});
test('staged SNAP allocation preserves pennies and rejects eligibility/coupon assumptions', () => {
  const lines = ['a', 'b', 'c'].map(id => ({ id, discountedPrincipal: 0.01, snapEligible: true, taxRatePercent: 10 }));
  expect(calculateStagedSnapTaxPlan(lines, 0.02).lines.map(line => line.snapPrincipal)).toEqual([0.01, 0.01, 0]);
  expect(() => calculateStagedSnapTaxPlan(lines, 0.04)).toThrow('cannot exceed');
  expect(() => calculateStagedSnapTaxPlan([{ ...lines[0], ageRestricted: true }], 0.01)).toThrow('Age-restricted');
  expect(() => calculateStagedSnapTaxPlan([{ ...lines[0], manufacturerCoupon: 0.01 }], 0.01)).toThrow('jurisdiction');
});
test('successful staged arithmetic never activates EBT checkout or reversals', () => {
  calculateStagedSnapTaxPlan([{ id: 'food', discountedPrincipal: 1, snapEligible: true, taxRatePercent: 10 }], 1);
  expect(() => assertCheckoutTendersAvailable({ paymentMethod: 'EBT' })).toThrow('unavailable');
  expect(() => assertReversalTendersAvailable({ paymentMethod: 'CASH', payments: [{ paymentMethod: 'EBT', amount: 1 }] })).toThrow('reconciliation');
});
