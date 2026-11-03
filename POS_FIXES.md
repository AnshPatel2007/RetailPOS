# POS review fixes

This records the implementation following `POS_SYSTEM_REVIEW.md`. Existing working-tree changes were preserved. No production data was migrated, seeded, or rewritten.

## Implemented

| Review finding | Change |
|---|---|
| Registration and store isolation | Both creation endpoints use a common role/store policy. Managers can create cashiers; store admins can create managers/cashiers at their own store. Store-bound roles require a store. Location filters reject unassigned store users. User-list queries enforce store ownership. |
| Receipt-number collisions | Receipt numbers use date plus UUID rather than a per-store count competing for a globally unique field. Existing receipt numbers remain valid. |
| Duplicate checkout after connection loss | A checkout identifier persists across retries and page reloads and is reused by the offline queue. Both server idempotency return paths enforce cashier/store ownership. Sale audit creation is part of the transaction. |
| Refund and bulk-action inventory errors | Individual and bulk operations share `saleReversal.service.ts`. They lock the sale before reading refund eligibility. Remaining-balance refunds restock only quantities not previously restored. Duplicate item lines are rejected. |
| Unsafe exchange endpoint | Returns validate original sale items and quantities, use server prices, and write through the same refund transaction/history. Replacement goods must be rung up as a separate sale. |
| Double subtraction in financial reports | P&L and accounting exports include completed and refunded sales before subtracting refunds. A fully refunded sale nets to zero. |
| Offline payload mismatch | The queue keeps the original request, cashier, store, shift, timestamp, expected total, age check and price overrides. Replay uses the original shift, including a closed shift, and rejects a changed total instead of silently repricing. |
| Stale permissions after demotion | Authentication reads current role, active status and store from the database on each request. |
| Inconsistent admin store viewing | Selected-store requests carry the store ID. POS viewing blocks checkout/scanner/keyboard mutations; the API client blocks store mutations while viewing. Viewing does not populate the ordinary offline catalog. |
| Simulated hardware success | Card-reader calls no longer simulate approval. Card tender is labeled external and requires the terminal approval reference in the UI. Drawer calls report unsupported rather than claiming a pulse was sent. Printer status identifies browser printing. |
| Cross-origin refresh | Axios sends credentials; production refresh cookies use Secure, HttpOnly and SameSite=None. Refresh requests reject an unapproved Origin. |
| Developers permissions | Navigation and route guards now match the backend's SUPER_ADMIN-only policy. |

Other fixes: shared input labels/errors are programmatically associated; reduced-motion preferences are respected; frontend lint configuration and switch-case scopes are corrected; pending-sale queries correctly handle the boolean sync field; manual sync can retry exhausted records belonging to the current cashier; caching pages through the full catalog replaces the old first-page-only behavior.

Design corrections keep Inter and the existing theme: shared page titles wrap, header actions wrap on small screens, and the register status bar avoids an absolutely positioned clock overlapping other content. Register helper labels use at least 12px text; navigation, cart quantity/item actions and favorite buttons have 44px targets. Cart headers and totals wrap when space is limited. Tabular numerals apply throughout the app to keep changing amounts aligned. Receipt typography is unchanged.

## Intentional behavior changes

- Offline acceptance is **cash only, without loyalty redemption**, and requires a shift already loaded on the register. Mixed tender is never converted into cash. A pending sale must be replayed by its original cashier at its original store.
- If catalog prices/taxes/promotions now produce a different total, replay fails with an explicit reconciliation message and preserves the queued record. It does not silently change what the customer paid.
- Legacy queued records lacking original cashier/payload details are retained for manual reconciliation. Do not clear browser storage to resolve these records.
- A sale with prior refunds cannot be voided. Refund its remaining balance instead. Fully refunded and already voided sales cannot be voided again.
- Voids restore original gift-card/store-credit/house-account balances in addition to inventory and customer/shift totals. External card reversals must also be completed on the separate terminal.
- The exchanges API supports validated `RETURN_ONLY`; a replacement purchase is a separate normal checkout so stock, tenders and revenue use the normal sale workflow.

## Verification

Final checks passed: 103 backend unit tests, 52 database integration tests across five targeted suites, and four frontend tests. Frontend lint, backend TypeScript checking and the frontend production build also passed.

Tests added cover permissions/demotion, receipt uniqueness, remaining quantities, duplicate return lines, cross-store reversals, accounting refunds, persisted checkout identity, queued payload fidelity and cashier ownership. Database regression coverage includes simultaneous refunds, first sales at two stores, lost-response replay, closed-shift replay, changed-total rejection, bulk refunds and exchange returns.

Commands:

```text
npm run test:unit --workspace=backend -- --runInBand
npm run test:unit --workspace=frontend
npm run lint --workspace=frontend
npm run build --workspace=frontend
node_modules/.bin/tsc -p backend/tsconfig.json --noEmit
```

Database tests use `backend/jest.integration.config.js` and a dedicated PostgreSQL database. Never point them at operational data: their setup truncates tables. This work used a temporary cluster on localhost port 55439 with a fresh `pos_regression_test` database. The cluster was stopped and removed after verification.

## Remaining boundaries

- No real payment processor or native drawer driver is connected. Their implementation needs the processor and hardware choice. No physical payment, printing or drawer behavior was verified.
- P&L still labels COGS as an estimate based on 60% of sales. Historical inventory-cost accounting and a consistent tax-exclusive revenue presentation are separate accounting work; this change fixes the refund arithmetic without inventing historical cost records.
- Existing corrupted totals/stock or duplicate historical sales are not automatically repaired. The new logic prevents the reviewed failure paths going forward; historical corrections need record-level reconciliation.
- Live browser accessibility, layout and cross-site-cookie behavior remain unverified. Builds and automated tests do not replace those checks.
