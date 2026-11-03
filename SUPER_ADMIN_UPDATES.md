# Super-admin update — 12 October 2026

Scope: super-admin navigation, dashboard, and store-connection management. Store-admin payroll, reports, checkout, and transfer workflows retain their existing behavior.

- Removed Payroll and Reports from super-admin navigation. Retired admin URLs redirect to the dashboard. Payroll API access is now restricted to store admins, including an explicit check against the general super-admin authorization bypass.
- Removed the Revenue & Profit by Store and Revenue Distribution charts and the separate AdminReports page. Following the layout correction, the original metric-card rows, Store Details cards, and Performance Comparison table are restored; the table's link to the retired Reports page is omitted.
- Added a Light mode / Dark mode button above Store View in the super-admin sidebar. It uses the existing theme preference and persists the choice across reloads.
- Replaced the dashboard's three period buttons with a compact 1D / 7D / 1M / 3M / 1Y / MAX selector. These use rolling 24-hour, 7-day, 30-day, 90-day, and 365-day windows; MAX has no lower date bound. Changing periods discards old results, and stale responses cannot replace newer ones.
- The overview refreshes every 30 seconds while visible, when returning to the tab, and manually. It reads one consistent database snapshot and includes all stores, including newly created and inactive stores. Stock, users, shifts, and catalog counts are explicitly current-state metrics rather than period metrics.
- Replaced the connection dropdowns above Store Management with a Connections button on each store row. It opens a searchable panel with Connected and Find stores views, partner identity/contact details, connection actions, and inline disconnect confirmation.

## Margin correction

The old formula was `(sales including tax - expenses) / sales including tax`. It ignored product costs and produced 100% when expenses were zero.

The dashboard now labels profit and margin as estimates. For periods with complete cost data and no refunds:

`estimated profit = sales excluding tax - current product cost × quantities sold - approved/paid expenses`

`estimated margin = estimated profit / sales excluding tax × 100`

Current product costs are used because historical sale cost snapshots are not stored. Zero/default product costs and missing sale lines are treated as incomplete data. Profit/margin are unavailable for periods with refunds because historical refund cost/tax allocations are not recorded. A period without positive sales has no percentage margin.

Net collected includes tax and subtracts actual refund records by refund date. Full refunds are deducted once; partial refunds are included; voided/pending/held sales do not inflate collections. Tax charged is explicitly labeled before refunds. Low-stock counts exclude zero stock, and internal MISC products are excluded from catalog and inventory counts.

The existing store-level analytics/accounting estimates described in FEATURE_AUDIT.md were not changed in this super-admin update.

## Verification

- 18 targeted database integration tests passed: 6 new dashboard/role scenarios and 12 existing checkout, transfer, and payroll regressions.
- New coverage checks cost/tax/expense margin arithmetic, missing costs, partial/full/older-sale refunds, creating a new store through the API, retaining inactive-store history, all period choices, invalid periods, and owner/super-admin access boundaries.
- Frontend lint, backend TypeScript, frontend production build, and whitespace checks passed.
- Localhost servers were restarted with file polling after the old backend failed to reload. HTTP checks confirmed the new dashboard source is served, all six period APIs respond, super-admin payroll returns 403, and store-admin payroll returns 200.
- Live data at verification produced a 54.12% estimated margin; future transactions, expenses, or current product-cost edits can change it.
- No browser automation execution tool was available. Visual click-through remains unverified; HTTP/build checks do not establish visual correctness.

Tests used a dedicated temporary database, removed after completion. No test stores or transactions were added to operational data.
