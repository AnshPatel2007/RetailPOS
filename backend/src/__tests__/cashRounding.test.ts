import { isCashRoundingMode, refundCashRounding, roundedCashDue, saleCashRounding, toNickel } from '../utils/cashRounding';

const cash = (cents: number) => ({ method: 'CASH', cents });
const card = (cents: number) => ({ method: 'CARD', cents });

describe('Cash rounding to 5 cents', () => {
  it('rounds 1 and 2 cents down and 3 and 4 up; the customer\'s favor always down for a sale, up for a refund', () => {
    expect([1240, 1241, 1242, 1243, 1244, 1245].map(cents => toNickel(cents, 'NEAREST'))).toEqual([1240, 1240, 1240, 1245, 1245, 1245]);
    expect([1241, 1244, 1245].map(cents => toNickel(cents, 'DOWN'))).toEqual([1240, 1240, 1245]);
    expect([1241, 1244, 1245].map(cents => toNickel(cents, 'UP'))).toEqual([1245, 1245, 1245]);
    expect(roundedCashDue(1242, 'NEAREST')).toEqual({ cents: 1240, rounding: -2 });
    expect(roundedCashDue(1243, 'NEAREST')).toEqual({ cents: 1245, rounding: 2 });
    expect(roundedCashDue(1244, 'CUSTOMER')).toEqual({ cents: 1240, rounding: -4 });
    expect(roundedCashDue(1244, 'OFF')).toEqual({ cents: 1244, rounding: 0 });
    expect([isCashRoundingMode('NEAREST'), isCashRoundingMode('UP'), isCashRoundingMode(undefined)]).toEqual([true, false, false]);
  });

  it('rounds only the cash that finishes a sale, never when the exact cents are handed over', () => {
    // $12.42 paid with a $20 bill: $12.40 due, $7.60 change.
    expect(saleCashRounding(1242, [cash(2000)], 'NEAREST')).toBe(-2);
    // The customer counts out $12.42 exactly: charged exactly.
    expect(saleCashRounding(1242, [cash(1242)], 'NEAREST')).toBe(0);
    // Handing over the rounded amount is fine too.
    expect(saleCashRounding(1242, [cash(1240)], 'NEAREST')).toBe(-2);
    // A card is charged exactly, and so is a sale a card finishes.
    expect(saleCashRounding(1242, [card(1242)], 'NEAREST')).toBe(0);
    expect(saleCashRounding(1242, [cash(1000), card(242)], 'NEAREST')).toBe(0);
    // Card first, cash for the rest: only the $2.43 left is rounded.
    expect(saleCashRounding(1243, [card(1000), cash(500)], 'NEAREST')).toBe(2);
    expect(saleCashRounding(1243, [card(1000), cash(500)], 'CUSTOMER')).toBe(-3);
    expect(saleCashRounding(1242, [cash(2000)], 'OFF')).toBe(0);
    // Nothing left for the cash to pay: nothing to round.
    expect(saleCashRounding(1242, [card(1242), cash(0)], 'NEAREST')).toBe(0);
  });

  it('rounds a cash refund\'s cash part on its own, in the customer\'s favor upward', () => {
    expect(refundCashRounding(1242, 'NEAREST')).toBe(-2);
    expect(refundCashRounding(517, 'NEAREST')).toBe(-2);
    expect(refundCashRounding(518, 'NEAREST')).toBe(2);
    expect(refundCashRounding(1241, 'CUSTOMER')).toBe(4);
    expect(refundCashRounding(1240, 'CUSTOMER')).toBe(0);
    expect(refundCashRounding(1242, 'OFF')).toBe(0);
    expect(refundCashRounding(0, 'NEAREST')).toBe(0);
  });
});
