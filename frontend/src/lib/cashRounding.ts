// Cash rounding to 5 cents: one rule for the register and the server (backend/src/utils/cashRounding.ts).
export { CASH_ROUNDING_MODES, isCashRoundingMode, toNickel, roundedCashDue, saleCashRounding, refundCashRounding } from '../../../backend/src/utils/cashRounding';
export type { CashRoundingMode } from '../../../backend/src/utils/cashRounding';
