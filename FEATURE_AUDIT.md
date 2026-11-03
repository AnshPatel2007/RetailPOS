# Follow-up feature audit — 12 October 2026

These are additional findings from source review after the fixes in USER_REPORTED_FIXES.md. They are not presented as fixed or as an exhaustive verification of every screen. Passing tests cover the exercised workflows; the cases below still need focused implementation and regression coverage.

## Highest-priority remaining issues

| Feature | Finding and consequence | Evidence / next change |
| --- | --- | --- |
| Cash refunds and drawer reconciliation | Refunds are saved without a cash payout tied to the shift that actually makes the refund. Clock-out reconstructs cash from completed sales and cash movements; it does not subtract partial-refund payouts. A fully refunded sale is excluded even when its refund used another method or another shift. Z-report uses a different sale-status filter, so it can disagree with clock-out. | `backend/src/services/saleReversal.service.ts`, `backend/src/controllers/shift.controller.ts` (`clockOut`, `getShiftZReport`). Record refund tender movements against the refunding shift, then use that ledger consistently. Cover partial, full, split-tender, and later-shift refunds. |
| Item refunds on loyalty-redemption sales | Item refunds use the original line total, while redeemed points reduce the sale total separately. Returning all items can therefore exceed the remaining paid balance and be rejected. Refund/void loyalty updates subtract estimated earned points but do not restore the originally redeemed points. | `saleReversal.service.ts` (`unitTotal`, customer updates), `sale.controller.ts` (loyalty discount). Persist allocation of redeemed points and earned points, prorate refunds from those original allocations, and restore points exactly once. The report refund form fix does not resolve this accounting case. |
| Cycle-count approval after later stock movements | Approval assigns the old counted quantity directly to current product stock. A sale or receipt between counting and approval can be overwritten. Status is checked before the transaction, without locking the count for approval. | `backend/src/controllers/cycleCount.controller.ts`, `approveCycleCount`. Reconcile intervening stock movements or reject a stale snapshot; lock/version the approval and inventory updates. |
| Profitability and break-even analytics | COGS is estimated as 60% of revenue. Health analytics also use fixed costs of 5,000 and a 40% margin, so some displayed profitability/break-even numbers are assumptions rather than actual business accounting. | `backend/src/controllers/analytics.controller.ts` around the estimated COGS/fixedCosts calculations; `financial.controller.ts` (`getProfitAndLoss`). Use historical sale cost snapshots and real expenses, or label all dependent figures clearly as estimates. |

## Other observed gaps and boundaries

| Area | Current behavior / remaining work |
| --- | --- |
| Super-admin catalog selection | `product.controller.ts/getProducts` applies the requested store scope, then overwrites it with the user's assigned store when the super admin also has a location. That particular account arrangement can show the assigned store instead of the selected one. Remove the redundant override with a regression for an assigned super admin viewing another store. |
| Stock alerts across reports | The main inventory badges and catalog counts now separate zero stock from low stock. Other analytics/report queries still group zero stock under low-stock alerts; normalize terminology/counts throughout reporting. |
| Tax rate lookup | Owner-configured store rate and product exemptions work. Address/jurisdiction lookup, product tax classifications, special taxes, multiple rates, and tax holidays are not integrated. See TAX_AUTOMATION_PLAN.md. |
| Payroll scope | Automatic gross straight-time earnings and period expenses are implemented. Overtime, breaks/leave, withholding, deductions, and payments are not. Old shifts without a rate are excluded. Open shifts accrue a recorded payable amount only when clocked out. |
| Transfer discrepancies | Transfers enforce store connections and available stock. Receipt is for the full shipment and identifies products across stores by SKU; partial/damaged/missing-item reconciliation is not implemented. Partner stores must use matching SKU meanings. |
| Payment/device integrations | Card/EBT tenders require an external processor/terminal workflow. Browser printing is available; native drawer pulses and physical terminal/printer communication are not implemented or tested. |
| Email/provider features | Provider-dependent behavior requires configured accounts and credentials. Campaign integration tests mock email delivery; successful tests do not establish actual delivery. Local scheduled outbound email is disabled. |
| Customer display | The current BroadcastChannel approach shares a cart between windows on the same browser origin. It does not pair an independent customer-facing device over the network. |
| Offline sales | Offline acceptance is limited to cash without loyalty redemption and an already-loaded shift. Replay rejects a changed server total and keeps the pending record for reconciliation. Legacy queue entries missing attribution are retained for manual reconciliation. |

Suggested next engineering order: cash/refund ledger, loyalty refund allocation, cycle-count concurrency, then accounting/analytics accuracy. Browser interaction/accessibility tests and physical-device trials remain separate validation work.
