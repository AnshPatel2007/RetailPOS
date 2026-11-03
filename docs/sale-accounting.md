# Recorded sale and return allocations

New checkouts use `pricingVersion = 1`. Existing sales retain null version and
snapshot fields; migrations do not infer missing original costs or loyalty use.

## Booking rules

- Currency remains USD. Round each merchandise line subtotal/discount and tax
  to cents, then sum the lines. Existing booked Float columns remain pending a
  separate decimal migration; new monetary allocation fields use Decimal.
- Retain the existing post-tax loyalty discount policy. This work does not
  change tax classification, add automatic jurisdiction lookup, or certify SNAP
  exemption handling. Those are separate release requirements.
- Allocate loyalty value across original tax-inclusive line totals using largest
  remainders. Allocate redeemed points using those discounts. Allocate surcharge
  across the remaining line totals, then earned points across the final amounts.
  Stable original line order breaks ties. Allocated cents and points sum exactly
  to the sale totals. A requested redemption exceeding the sale value is rejected.
- Preserve unit cost where entered and positive; a default zero does not prove
  that the cost was known. MISC and offline replays have unavailable historical
  cost. Offline replay still validates its original expected total.
- New snapshots include unit cost, tax rate/treatment, original names and prices,
  manual/promotion/loyalty discounts, surcharge, earned and redeemed points.
- First-print and reprint receipts use booked facts. Receipt item amounts are
  before discounts; the summary deducts the booked total discount once.

## Returns and loyalty

For each returned quantity, compute the difference between cumulative integer
shares before and after the return. The final unit consumes the remaining cents
and points. Earlier returns and amount-only adjustments reduce the available
balance, preventing repeated refunds of the same money or points.

Partial amount-only adjustments allocate cash over remaining line balances and
reverse tax/points proportionately. They return no physical quantities. A refund
of the final cash balance returns remaining quantities; restocking remains an
explicit choice. A previous do-not-restock return is never silently restocked.

Points-only purchases may settle at zero cash. Their item returns restore points
and may restore stock without a drawer payout. The saved request key still
prevents repeated returns. A refund's expected amount protects against a stale
preview after another refund.

Redeemed points are restored and earned points reversed exactly once. If earned
points were already spent, reversal can leave a negative points balance. Future
earnings settle that balance, and no further redemption is available until there
are sufficient points. Tier calculation follows the resulting balance. Legacy
sales without allocations cannot reconstruct the original redeemed points.

## Voids and recovery

A new void appends one immutable `sale_voids` event with the original amount,
tax, cost, item/tender snapshots, reason, actor, approval and paying shift.
The original sale remains in its original reporting period; the negative event
belongs to its own creation period. Cash leaves the current actor's drawer.
Existing stock/account/points reversals and the event commit in one transaction.
Sales with earlier refunds must use the remaining-balance refund workflow.

The single-sale dialog persists its exact request and UUID by store and actor
before submission. After an uncertain response or reload, Retry confirms that
same operation without paying or restocking twice. Cashier approval remains
bound to the exact request; replay of a successful request does not consume
another approval. A stale displayed amount is rejected before mutation.
Old internal-account payments without enough original account identity are
blocked for reconciliation. Card-terminal reversals are still manual; the dialog
explains that recording the POS void does not contact the terminal.

Legacy status-only voids retain their unknown reversal date. Shared reports warn
about excluded history and suppress affected profit estimates.

Bulk voids require 1 to 50 unique sale IDs with their reviewed amounts, a reason
and a retry UUID. The review dialog saves this complete request by store and
actor before sending it. An uncertain result remains available without selecting
the rows again, including when the report cannot load. Another user's session
cannot display or replay that user's saved batch. Unreadable or unwritable
recovery storage blocks new batches; changing filters never discards recovery.

The server canonicalizes member order and binds every member, amount, reason,
actor and store to the saved request. The first sorted sale's immutable void
event stores the batch UUID; all member hashes include the complete batch hash.
Other members have deterministic UUIDs. The batch commits atomically, so this
anchor cannot exist without the other events. A database advisory lock serializes
reuse of the batch UUID, including competing requests with different selections.
Exact retries confirm the saved events even after the original paying drawer
closes. Reusing the UUID for a changed batch or a single-sale void is rejected.
No schema migration is needed. General correction entries and legacy-void
reconciliation tooling remain separate work. Bulk-refund recovery is separate
from this bulk-void workflow.

`POST /api/sales/bulk-void` accepts:

```json
{
  "idempotencyKey": "20000000-0000-4000-8000-000000000001",
  "reason": "Duplicate checkout batch",
  "sales": [
    { "id": "10000000-0000-4000-8000-000000000001", "expectedAmount": 22.00 }
  ]
}
```

Amounts must use whole cents. The earlier `saleIds`-only request is rejected;
callers must review and persist the complete request. The response includes
`data.voidedCount`, `data.voidedSales` and `replayed`. Cashier and platform roles
cannot use this endpoint; store managers and owners are scoped to their store.

## Reporting and remaining limits

The super-admin dashboard uses original cost and recorded refund tax/restocked
cost. Non-restocked items retain their cost. Missing snapshots make profit and
margin unavailable. Its existing revenue display still includes tax; the operating
profit calculation excludes tax. Shared metrics now also serve P&L, comparison, health, product profitability,
what-if, dashboard totals and Sales report summaries/downloads. See
[reporting.md](./reporting.md) for adopted paths and remaining accounting limits.

This checkpoint does not complete full decimal conversion, effective-dated tax
configuration, tender-specific SNAP tax, general tender corrections, refund tender
limits, legacy-void reconciliation, or a complete offline accounting policy.
