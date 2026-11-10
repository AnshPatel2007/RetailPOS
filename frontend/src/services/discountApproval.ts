/**
 * A cashier's discount or price change is approved by a manager at the register,
 * before payment is taken. The approval covers exactly the discounted lines (the
 * server keeps the same rule in `discountedLines`), lasts 15 minutes and is used
 * once, by the sale. If the cart changes, the sale asks again.
 */
export const DISCOUNT_APPROVAL_PATH = '/api/sales/discount-approval';

export interface CheckoutLine { productId: string; quantity: number; price: number; discount: number; priceOverride?: boolean; name?: string }

const cents = (value: number | undefined) => Math.round(Number(value || 0) * 100);

export const linesNeedingApproval = (lines: CheckoutLine[]) => lines.filter(line => cents(line.discount) > 0 || line.priceOverride === true);

/** The discounted lines as one comparable value, matching what the server binds the approval to. */
export const approvalKey = (lines: CheckoutLine[]) => JSON.stringify(linesNeedingApproval(lines)
  .map(line => [line.productId, line.quantity, cents(line.discount), line.priceOverride ? cents(line.price) : null])
  .sort((a, b) => String(a[0]).localeCompare(String(b[0])) || Number(a[1]) - Number(b[1]) || Number(a[2]) - Number(b[2])));

export interface DiscountApproval { key: string; token: string; expiresAt: number }

/** Still valid for these lines, with a minute's margin before the server's 15-minute limit. */
export const approvalCovers = (approval: DiscountApproval | null, lines: CheckoutLine[]) =>
  !!approval && approval.expiresAt - 60_000 > Date.now() && approval.key === approvalKey(lines);
