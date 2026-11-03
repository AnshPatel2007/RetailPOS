# Remaining POS acceptance

The user requested completion of the remaining reliability plan on 2026-10-19.
Preserve operational data, existing dashboard styling, Inter, themes and platform
payroll/report removals. Each item needs implementation and verification evidence.

- [x] Security: expiring 2FA setup, atomic single-use recovery codes, second-factor
  proof for disable/regeneration, session revocation and failed-read recovery.
- [x] Reversals: bulk-refund recovery, tender limits/corrections and explicit
  legacy-void reconciliation with immutable evidence.
- [x] Payroll: owner review/approval, recorded external payment, concurrent state
  transitions, period drill-down and wage privacy.
- [x] Offline: manager reconciliation with cashier/store attribution, explicit
  disposition and durable evidence; no silent repricing or deleted queues.
- [x] Jobs: transactionally queued webhooks and other emails/exports, bounded
  retries, leases, restart recovery, authorized history and observability.
- [x] Analytics: store-calendar ranges, dated inventory demand/alerts/anomalies
  and explicit insufficient-history states.
- [x] Collections: server pagination, cancellation, scoped query caching, active
  views and stable record-detail URLs.
- [x] Accounting/tax: tender-aware allocations and original-tender reversals;
  EBT requires provider/legal/operational acceptance before activation.
- [x] Role/control and responsive audit: retained routes, controls, errors, empty
  states, keyboard/dialog behavior and light/dark desktop/phone workflows.
- [x] Performance: guarded production-size fixtures, reproducible measurements,
  targets/results and query plans for slow paths.
- [x] Recovery: fresh install, restored upgrade, database/uploads fingerprints,
  matching restore and full-day simulated accounting reconciliation.
- [ ] Hardware/provider: physical scanner/printer/terminal trials, actual provider
  acceptance and store pilot sign-off. Default connection paths documented;
  physical devices, merchant setup and a named pilot store are still needed.

Previously deferred product integrations remain listed in
`IMPLEMENTATION_STATUS.md`; automated checks do not establish physical acceptance.

2026-10-19 through 2026-10-20 verification evidence:

- 2FA: 27 focused security/session/approval checks and the enrollment,
  recovery-code login, failed-read retry and disable browser workflow passed.
- Gross payroll review: 19 backend checks and the browser cash-payment retry
  after drawer closure passed. Payroll tax/benefit processing remains deferred.
- Reversals: 83 focused backend tests across eight suites passed, including
  seven original-tender integration cases, ten tender/SNAP arithmetic unit cases,
  drawer, allocation, batch rollback, source immutability and prior-sale checks.
  Bulk and single void browser recovery passed, including a denied retry after
  an uncertain result. Precompleted external card evidence is retained.
- Corrections/legacy voids: six backend cases and browser lost-response/reload
  recovery passed. Owner receipts have stable URLs and failed-read retry.
- Manager offline reconciliation: five backend cases and 21 existing sale cases
  passed. Browser booking preserved original price, cashier and local evidence.
- Jobs: 21 queue/campaign/digest checks passed, including competing workers,
  expired leases, email uncertainty, consent revocation, an immutable campaign
  manifest and a checksummed export of 5,010 rows. Browser queued-export recovery
  and stable job URLs passed. Authentication reset, password-change, lockout and
  2FA notifications now queue encrypted content transactionally; two focused
  security-email integration cases passed. Own-user notification history is
  available without exposing reset links or message content.
- Inventory/activity analytics: six backend checks passed for dated net units,
  missing/zero demand, paging, sparse history, ABC and clipped shift hours.
  Browser unavailable-history states and active-view navigation passed.
- Reviewed migrations through `20261019060000_sale_payment_integrity` passed
  fresh install, restored upgrade and schema-drift checks. The final recovery
  artifact `.local/recovery-verification-1792501801656` preserves 156 original
  rows and the matching upload. Its source contained no jobs or export files;
  job decryption/export checks therefore report zero, rather than a fabricated
  restore result. Repeat those checks when the deployment has such records.
- Full-day simulated accounting passed: $33 net collected, $3 net tax, $12 COGS,
  $15 operating expenses, $3 operating profit and a $162 counted drawer with no
  difference. Gift/store-credit liabilities, house debt and product units match.
- Collection acceptance: 22 backend tests across four suites and eight browser
  scenarios passed, covering >5,000 rows, independent server pages, full-period
  totals, direct exports, stable detail URLs, failed reads, canceled responses,
  checkout cache invalidation and saved reversals.
- Final complete runs: 580 backend tests across 72 suites passed, and all 109
  browser scenarios passed. A subsequent promotion-edit race guard passed its
  additional browser regression, giving 110 distinct passing browser scenarios
  across the complete run and that focused follow-up, not one 110-case run.
  Logs: `.local/reliability-complete-backend.log`,
  `.local/reliability-complete-browser.log`,
  `.local/reliability-promotion-edit-final.log`.
- Frontend lint, 17 frontend unit tests and both production builds passed.
  Selected desktop light and phone dark job, original-tender refund and stable
  sale-detail screenshots were inspected. This does not establish every action
  definition or every screen/theme/viewport combination.
- New interaction checks cover stale job retries, disabled-fieldset keyboard
  focus, mounted/unmounted offline receipt recovery, server-enforced holds and
  inactive-store write rejection with permitted historical reads.
- Retained-screen audit: 16 role/viewport/theme contexts passed alongside five
  account-history/inventory/promotion recovery checks. The later platform and
  store-detail recheck passed all five cases. Coverage includes explicit denied
  routes, named visible controls, no page errors/overflow, full phone content
  width, keyboard drawers, preview write controls and stale customer/store reads.
  This is route/action-family evidence, not 675 independently exercised mutations.
- Inventory stats and low-stock reads now honor selected-store scope. One new
  backend regression checks store isolation and excludes untracked, misc and
  unassigned inventory value; the affected 19 backend checks passed.
  That regression is also included in the passing final full backend run.
- All seven large-fixture service budgets passed across a complete run and
  source-matched report follow-up. Final report p95 is 1,361.66 ms on page 1 and
  1,476.08 ms on page 900, under the unchanged 1,500 ms budget. The fixture has
  100,000 sales; timings exclude HTTP, UI and concurrent till load. See the
  performance document for individual artifacts, plans and memory settings.
- Localhost UI and API return 200 at ports 5173 and 5000. Outbound delivery and
  automatic payroll workers are disabled in the running local preview.
- Hardware preference: standard USB HID scanners and OS-supported receipt
  printing; tobacco/liquor/grocery pilot scenarios. No specific store, device or
  merchant account has been supplied. Clover is being evaluated; nothing live
  has been enabled and EBT/SNAP remains blocked.

2026-10-21 interface plan: complete. Shared headers, actions, buttons, tabs and
dialogs, automatic read updates and the global assistant are implemented. The
complete browser suite passed 137 scenarios; a final nine-case assistant run
adds three checkout viewport cases, bringing distinct passing scenarios across
runs to 140. All 33 frontend unit checks and 30 backend assistant checks passed,
along with lint, build, type checking and source whitespace validation. Screenshot
review included desktop/tablet/phone checkout layering and mobile focus return.
Provider tests use mocks. See [the interface verification record](interface-consistency.md).

2026-10-22 historical reporting follow-up: both stores' 454 daily summaries,
17 expense summaries and 28 monthly income entries are imported and reconciled.
P&L offers the owner's 70% merchandise-cost estimate separately from recorded
facts, with a month selector and clearly labeled profit/margins. All 15 source
months passed calculation reconciliation; missing costs remain unknown in the
underlying ledger. See [the historical import record](historical-ledger-import.md).

Export consistency is complete across direct CSV/PDF, accounting journals,
queued exports and previews. Daily summaries no longer imply individual
receipts, importing-owner cashier attribution, checkout timestamps or cash
settlement. Monthly expense exports identify their recognition-date convention.
Eleven backend checks, including a 5,010-row queued export, and ten browser
scenarios passed; frontend lint/build and backend type checking passed.
Evidence: `.local/historical-exports-tests.log`,
`.local/historical-exports-browser.log`, `.local/historical-exports-lint.log`,
`.local/historical-exports-types.log`, `.local/historical-exports-build.log`.
Physical hardware, processor acceptance and pilot sign-off remain pending.

2026-10-23 P&L download: the top-right Export CSV action downloads the displayed
statement with its selected month, store, timezone, snapshot timestamp and
recorded/estimated basis. Source limitations and the 70% assumption travel with
the file. Reference-only purchases and tax are not deducted twice. Failed or
obsolete report views cannot be exported. P&L totals/categories now share a
repeatable-read snapshot; CSV text escaping preserves numeric loss values.
Five backend integration checks and all 35 frontend unit checks passed. The
ten-case browser run passed nine scenarios; the remaining failure simulator
consumed only one development request. After correcting that test fixture,
both P&L browser cases passed. All ten distinct browser scenarios have passing
evidence across the runs. Lint, type checking and production build passed;
all 15 imported months still reconcile. Evidence: `.local/pnl-export-*.log`.


2026-10-23 inventory costing supersedes the earlier percentage-based P&L and CSV export notes above. P&L and Excel now use recorded moving-average costs, owner-reviewed openings, actual receipt costs, original-cost returns, transfer valuation and audited corrections. Historical imported costs remain unknown. See [inventory costing](inventory-costing.md) for implementation, review workflows and local verification evidence.
