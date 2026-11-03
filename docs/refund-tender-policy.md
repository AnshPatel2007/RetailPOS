# Original-tender refunds and staged SNAP arithmetic

The POS records manual external card refunds. It does not send refund instructions to a payment terminal. The operator completes the indicated amount on the original terminal once, then records the terminal refund reference. Retrying the saved POS operation confirms its existing record and must not repeat a terminal refund or cash payout.

## Monetary limits

- Each refund allocation identifies the original `SalePayment.id`. Older sales with no payment rows use a deterministic `legacy:METHOD` source.
- Cash capacity excludes change already returned at checkout. Every source is capped by its recorded amount minus earlier allocated returns.
- Cash returns to cash; cards return to cards; gifts return to the original gift card; store credit returns to the original customer's account; house charges reduce the original customer's outstanding debt.
- An operator can explicitly choose customer store credit instead of an original source. The original linked customer is required, and the source capacity is still consumed.
- A paid-down house charge cannot create negative debt. Review an explicit customer store-credit alternative when the outstanding debt is insufficient.
- Positive external card allocations require a terminal refund reference. An original gift reference cannot be replaced with another card's reference.
- Mixed payouts must sum to the reviewed refund amount in whole cents. Tax, loyalty, inventory and sale status are allocated once for the overall return.
- A points-only return pays no money. EBT and unsupported external tenders remain blocked.

`Refund.tenders` stores the immutable array `{sourcePaymentId, originalMethod, originalReference?, method, amount, reference?}`. Its `method` compatibility field is the single destination or `SPLIT`; the full array is the payment evidence. Financial tender summaries use the actual allocations and net original cash change. Daily and employee transaction counts count the sale once. Per-tender counts count the sale once for each tender it used.

Earlier refunds without source snapshots are attributed only when the recorded method and original source identify one unambiguous source. Missing or overpaid split history blocks another refund and surfaces a reconciliation message. The migration leaves that history unknown; it does not invent or rewrite payouts. Booked original payment records and new refund allocation records cannot be updated or deleted.

## SNAP activation boundary

`calculateStagedSnapTaxPlan` is an isolated, deterministic arithmetic model. It is not called by quote or checkout. It allocates a reviewed SNAP amount to eligible discounted merchandise principal, excludes that portion from the staged taxable base, and calculates tax only on the portion payable with other tenders. It preserves cent remainders, rejects excess allocations and age-restricted/gift funding eligibility, and rejects manufacturer-coupon cases until a reviewed jurisdiction rule is supplied.

Before activation, the implementation still needs jurisdiction-specific tax review, persisted per-line SNAP principal and original-card refund snapshots, provider entitlement and device testing, merchant/FNS approval, and store acceptance. EBT checkout and EBT reversals remain disabled even when calculator tests pass.

The activation boundary follows the documented distinction between SNAP merchandise and other-tender amounts, and the requirement to electronically return SNAP refunds to the original SNAP account. See [USDA retailer transaction training](https://fns-prod.azureedge.us/snap/retailer/training/notice/processing-transactions), [USDA proper use of SNAP benefits](https://fns-prod.azureedge.us/sites/default/files/resource-files/Proper-Use-of-SNAP-Benefits-September2024.pdf), and [Clover EBT integration requirements](https://docs.clover.com/dev/docs/clover-support-for-ebt). These documents do not establish approval for this POS or any pilot store.

## Verification

The focused tests cover net cash change, mixed payouts, exact retries after drawer closure, source overpayment, cash-to-card/account-to-cash rejection, original gift identity, explicit store credit, paid-down house debt, atomic batch rollback, immutable source snapshots, and staged SNAP allocation while its live gate stays disabled. Physical terminal and merchant acceptance are separate checks and have not been performed.
