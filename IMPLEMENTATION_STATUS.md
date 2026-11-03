# POS reliability implementation

This file tracks the approved implementation. It is not a claim that unfinished
work or physical-device testing has passed. Existing dashboard styling, Inter,
light/dark themes, and super-admin payroll/report removals are preserved.

## Delivery checklist

- [x] 1. Isolated test database, strict browser tests, action inventory, migration baseline, performance baseline.
- [x] 2. Store isolation, protected attachments, capability policy, role/control parity, manager approval.
- [x] 3. Fixed-precision money, historical snapshots, tender ledger, refunds/loyalty, account concurrency, tender-aware tax boundary (EBT remains disabled).
- [x] 4. Inventory movement service, versioned counts, purchase receipts, partial transfers and discrepancy handling.
- [x] 5. Consolidated navigation, compatibility URLs, shared interaction patterns, responsive admin shell.
- [x] 6. Active-view queries, scoped query cache, cancellation, report aggregation, measured performance.
- [x] 7. Payroll review/payment states, settings/device scope, offline reconciliation, durable jobs and observability.
- [ ] 8. Final acceptance: fresh-install/restore and workflow checks passed; physical hardware and store pilot remain pending.

## Validation record

- Before implementation: 108 backend and 8 frontend unit tests passed; frontend lint/build and backend typecheck passed.
- The active development database is not a disposable test database. Tests must validate their target before cleanup.
- Physical scanner/printer trials and an actual store pilot require the owner's devices and participation; these cannot be inferred from automated checks.

## Implemented checkpoints (2026-10-15)

- Disposable database guard for test cleanup; dedicated browser API/database and strict Playwright checks. The installed Edge browser runs the Chromium project.
- Reconciled migration baseline preserving old migration history. Deployment now uses reviewed migrations. A restored clone and fresh database were checked; additive changes were applied to local development after backups and before/after record-total checks.
- Scoped recurring expenses, budgets, export history, gift-card statistics, campaigns and legacy unassigned records. Private receipt metadata, content validation and authenticated record-level downloads replace the public upload directory.
- Shared capability definitions; current permissions checked per request; super-admin operational writes blocked; owner-only wage detail, including aggregate payroll cost in non-owner summaries/exports.
- Exact-request, expiring, single-use manager approvals for cashier overrides/refunds/voids, including manager authentication/2FA, transactional consumption and actor/approver audit records. Cancellation retains the checkout.
- Database-enforced inventory versions; a common movement service for sales, returns, voids, purchase receipts, manual/bulk adjustments and product quantity edits. Stale absolute updates fail instead of overwriting another register.
- Count item ownership, atomic review/approval/cancellation, stale-count rejection, explicit refresh/recount, partial-count product selection and recorded adjustment history.
- Validated request payloads now discard arbitrary database/nested relation fields. Cashiers cannot directly alter loyalty balances or customer status. Product/category ownership checks prevent cross-store links.
- Purchase orders have individual delivery events, partial status, accepted/damaged/rejected quantities, reasoned short closure, and a retry key consumed in the same transaction as stock. Editing, cancelling, ordering and receiving lock the order; direct status changes cannot bypass receiving. Legacy closed orders explicitly show unavailable delivery history.
- Delivery UI preserves an uncertain request across reloads and safely checks its result. Browser coverage simulates a committed delivery whose response is lost, then confirms one receipt and correct stock after retry. Super-admin purchasing preview hides write controls.
- Checkout, refunds and voids use consistent product/customer/tender lock ordering. Checkout revalidates customer and tender store ownership; connected stores and unassigned legacy accounts cannot be used as a payment shortcut. Simultaneous loyalty redemption uses the locked balance.
- Transfer creation uses a paginated searchable product picker, preserves connected destinations and the fixed source, clears old context, rejects excess quantities and explains that drafts do not reserve stock.
- Transfers now use the common inventory service for shipping, partial delivery and physically confirmed returns. Each event records accepted/damaged/missing/sent-back quantities, actor, reason and a retry key. Cancellation cannot restore shipped stock. Existing shipments remain accessible after a store connection is removed.
- Destination product identity is snapshotted at shipment; ambiguous matches require explicit selection or confirmed creation. Received and returned quantities cannot exceed the shipment, even with concurrent requests. Saved uncertain events survive reload and replay once. Delivery history is paginated and limited to the involved stores.
- Access tokens are bound to active server sessions. Device logout, logout-all and session revocation invalidate existing access as well as renewal. Password, role, store assignment and activation changes revoke sessions atomically in PostgreSQL; restoring the prior role/activation does not restore old sessions. A concurrent credential change cannot create a session from previously verified credentials.
- Both password-change APIs use the same password policy and session behavior; reset tokens are consumed atomically once. Logout can revoke the refresh cookie after access-token expiry, applies origin checks, and clears the cookie with matching attributes.
- Client session changes discard old responses and refresh results, clear store state, and update other open tabs. Sign-out retains credentials only for the server revocation request. An unavailable server is reported honestly; queued offline sales and their retry budgets survive cancellation.
- Cash sales (after change), cash refunds, cash voids, paid-in/out and safe drops now post immutable, fixed-decimal drawer entries in the same transaction as the operation. A cash reversal requires the actor's own open drawer and does not rewrite the original shift's totals or closed count. The ledger also records new cash gift-card funding and house-account repayments; general correction/reversal workflows remain outstanding.
- Live drawer totals, clock-out, manager closure and Z-reports share one cents-based calculation. Original sale tenders, cash refunds and cash voids appear separately. Manager closure records the expected cash while leaving the actual count/difference unavailable if no count was supplied. Invalid cash counts and non-cash overpayment cannot manufacture drawer change.
- Checkout, reversals and cash movements lock their drawer before committing; concurrent closure includes the operation or rejects it. Refund and cash-movement retries use exact saved requests, including after reload or closure. Uncertain requests are partitioned by store/cashier and remain available for confirmation; successful refund retries do not emit another webhook.
- Historical original receipts and explicit cash movements are backfilled; prior refund/void paying drawers are not invented. Existing closed drawer counts remain unchanged and their incomplete history is visible. New drawer entries cannot be edited or deleted. Receiving uses a catalog lock compatible with checkout foreign-key checks, preventing the sale/transfer lock conflict found by regression testing.
- Reorder suggestions and automatic drafts exclude foreign/inactive suppliers even when an old product link exists. Selected-store sales history drives the suggestion's sales velocity.
- Gift-card issuance/reload now requires cash, an approved external-card terminal reference, or an owner-only promotional grant with a reason. Cash funding requires the actor's own open drawer. Inactive/expired cards cannot receive new funds.
- House-account repayments lock the customer and account in the same order as checkout, reject overpayments, and allow existing debt to be repaid on a frozen account. Competing purchases/repayments and competing repayments preserve the balance. Cash collections appear separately from merchandise sales in live drawers, clock-out and Z-reports.
- Store-credit grants require an explicit goodwill/correction source and reason; corrections are owner-only. Customer/account creation serializes safely and rejects foreign, connected-partner and unassigned customers. Return credits must use the original sale refund. Standalone debit endpoints can no longer bypass checkout.
- New funding/credit/payment operations have immutable decimal receipts, original before/after balances, actor/store/drawer references, exact-request retry keys and linked account history. Account/history relations prevent cascading financial-history deletion. Existing funding sources are not guessed or backfilled; legacy details are explicitly unavailable.
- Account screens use matching role controls, explicit tender/source fields, receipt history/reprinting and durable saved retries by store/user/workflow. A committed gift issue with a lost response recovers once after reload. Storage failure blocks submission before any request is sent; a terminal approval must never be charged again solely because saving failed. Browser printing is a print request, not confirmed physical output.
- New completed sales save original unit cost (when known), tax rate/treatment, manual/promotion/loyalty discounts, surcharge shares and earned/redeemed points. Database triggers protect the booked sale and line facts while allowing status changes and receipt metadata. Legacy rows remain unversioned; offline replays do not invent historical costs from today's product records.
- Loyalty discounts, surcharge and points are allocated across sale lines in integer cents/points. Successive partial returns preserve the final remainder; money-only adjustments use the remaining line balances. Points-only purchases and returns work without a cash payout. Returning all units restores redeemed points and reverses earned points exactly once, including after a void. Already-spent earned points become a negative points balance recovered by future earnings.
- Refund records save per-line cash, tax, restored/reversed points and cost of restocked units. A later full-balance return cannot restore earlier units explicitly marked do-not-restock. The UI previews allocated money/points and submits its expected amount; stale amounts are rejected before payment. Allocated refund records are immutable.
- First-print and reprint receipts share one mapper using booked product names, prices, totals and points. The super-admin dashboard now uses historical sale costs and refund-period tax/restocked cost, with operating profit/margin labels. Its layout and removed features remain unchanged. Other reporting/analytics cost calculations still require migration to the new snapshots.
- Source inventory generator: 34 route declarations, 568 action definitions and 258 API declarations at this checkpoint. These counts are source coverage, not all-action verification. See docs/workflow-verification.md.

**380 backend tests (114 unit + 266 integration)** passed across the full run
and focused reruns. The full run passed 378 of its 379 tests; its remaining
fixture still assumed current product cost. The corrected historical-cost fixture
and related scenarios passed on rerun, and an additional offline-cost regression
passed. Twelve frontend unit tests and the full 24-scenario browser suite passed.
Frontend lint, backend/frontend type checking and production build passed.
The points-only refund screen was visually inspected; existing selected theme and
mobile checks remain recorded. This is not every-control or physical-device acceptance.

## State after the original-sale snapshot checkpoint

All ten reconciled migrations, including original sale allocations, have been applied
to the current integration/browser databases, restored upgrade clone and local
development database. Schema checks found no drift. The local upgrade retained
2 sales, 9 products, 5 users, $115.86 in sale totals and 613 stock units, plus all
closed drawer totals, account balances, customer points and original sale/line facts. Database and
uploads backups precede the change. A fresh database installed all ten migrations
with zero drift and all eight custom triggers. Local API/frontend health checks passed.

Outstanding at that checkpoint: reviewed inventory imports;
full fixed-decimal money conversion; migrating remaining reports/analytics to
historical costs and refund allocations; general tender correction/reversal workflows;
tender-aware tax; navigation consolidation; broad role/control review; performance
fixtures and measured targets; durable integration jobs; payroll approval/payment
states; comprehensive offline reconciliation; additional 2FA lifecycle review; restore/hardware
and full trading-day pilot acceptance. All eight phase checkboxes remain open
until their complete exit conditions are met.

## Intentionally deferred

Integrated card processing, automatic jurisdiction tax lookup, complete payroll,
true exchanges, cold offline startup, remote-device display pairing, native drawer
control, scheduling, variants/purchasing units, expiry tracking, SMS/digital
receipts, accounting-provider synchronization, and SaaS subscription features.

## Reporting checkpoint (2026-10-16)

Shared PostgreSQL aggregates now power P&L, comparison, business health, product profitability, dashboard totals and what-if baselines. Historical costs, return-period tax/restocking and approved/paid expenses replace fixed margin assumptions. Accounting exports reverse recorded refund tax. Missing historical data remains unavailable. Selected-store reporting calendars handle daylight-saving boundaries. Analytics requests only its selected view and ignores responses from an old view/store.

Validation: all 390 backend tests passed in one full run; two new reporting browser scenarios passed. Frontend build/typecheck passed before the subsequent import work. A screenshot exposed an overflowing unavailable health score; its typography was corrected.

Still pending within reporting: transaction-list/export summary parity, remaining forecast/employee/AI/digest aggregation, complete timezone adoption, period-correct void events, and full decimal conversion. Cash-flow and break-even are explicitly unavailable until their required accounting/configuration exists.

## Reviewed imports and Sales report checkpoint (2026-10-16)

CSV and receipt imports now require saved review, validate identities/store ownership,
reject stale product/stock changes, use the common inventory service and apply once.
Lost responses recover after reload using the saved import. Receipt products require
explicit SKU and retail price. The old unreviewed endpoint is disabled. Receipt
review uses the shared accessible dialog, with inspected light desktop CSV and
dark mobile receipt views. See docs/reviewed-imports.md.

Migration 11 installed on integration/browser databases, a new empty database and a
restored upgrade clone, then locally after an API pause and database/uploads backup.
All existing table hashes matched before/after; 2 sales, $115.86 sale totals,
9 products, 613 units and 5 users were preserved. All 11 reconciled migrations and
9 custom triggers are present, with zero schema drift. Local API/frontend health
checks returned 200. Existing historical migrations remain preserved too.

The Sales screen, CSV and PDF share a report service and repeatable-read snapshot.
Fully returned original sales remain in their original period; returns appear by
issue date. Search, employee, customer, amount, payment and status filters apply
to both rows and summary/downloads. Store timezone governs calendar filters.
Legacy missing return tax stays unavailable. Failed downloads can be retried in
place. Sales beyond the first 50 are reachable through pagination; synchronous
reports explicitly reject more than 5,000 entries. Negative chart values use bars.
See docs/reporting.md for metric definitions, CSV changes and remaining limits.

Validation: the full backend run passed 397 tests; seven additional Sales-report
scenarios and affected financial/admin-dashboard reruns passed, giving 404 distinct
passing tests (119 unit, 285 integration) across 43 suites. Twelve frontend unit
tests passed. The full 28-scenario browser run passed before the receipt-dialog
and Sales-report follow-ups; affected suites plus two additional scenarios passed
on rerun (30 distinct browser scenarios across runs). Type checking, lint and the
frontend production build passed. Live OCR, exhaustive PDF/print layout and all
retained controls are not established by those checks.

The regenerated source checklist has 34 routes, 575 action definitions and 261 API
declarations. These are inventory counts, not verified-action counts.

## Expense accounting and Financial reliability checkpoint (2026-10-16)

Inventory purchases no longer reduce profit twice alongside original sale-line
COGS. P&L, overall profitability, business health, scenarios and the super-admin
profit calculation use operating expenses excluding inventory acquisitions.
Purchase records remain in history and total recorded expense figures. Accounting
exports classify them as inventory assets and preserve paid versus payable state.
Payroll still contributes to operating expenses without exposing private wage
records to managers or super admins. Missing historical cost remains unavailable.

Manual expense/due dates now use the store calendar; blank optional due dates no
longer prevent creation. Expense list, report and download date filters agree at
midnight/DST boundaries. Existing timestamps remain untouched, including older
UTC-midnight entries whose intended date still needs review. The edit form keeps
an unchanged timestamp. Unassigned legacy expense rows are excluded from these
lists and aggregates. The expense form uses the shared dialog and hides the
Payroll category from managers.

Financial ignores old store/user/view responses and exposes read failures with
Retry. Changing scope clears stale records, selections and forms. Recurring
requests carry the selected store; super-admin views hide expense/budget/recurring
write actions. The existing dashboard layout and prior removals are preserved.

Validation: 61 distinct affected backend tests across nine suites passed in
focused runs, including ten new expense-accounting/date scenarios. Seven reporting
browser scenarios passed together, including four new scenarios. Cumulative
coverage is 414 backend tests (119 unit, 295 integration, 45 suites) and 34 browser
scenarios across the previous full and subsequent focused runs; these are not
claims of a fresh complete run. Backend/frontend type checks, frontend lint and
production build passed. Light desktop expense entry and P&L were inspected.

No database migration was required. Local API and frontend return 200; read-only
checks retain 2 sales, $115.86 sale totals, 9 products, 613 stock units and 5 users.
The regenerated source checklist remains 34 routes, 575 action definitions and
261 API declarations; it is not a count of verified controls.

## Dated voids and recovery checkpoint (2026-10-16)

New voids append an immutable event instead of removing original-period sales
from shared financial metrics. Original amount, tax, cost, items, tender amounts,
reason, cashier, manager approval and paying shift are recorded together with
stock, account, loyalty and cash reversals. Earlier-period sales keep their
original totals; the void reduces the period in which it happens. Shared Sales,
CSV/PDF, accounting exports, P&L, profitability and admin totals agree on these
events. No dashboard layout or super-admin feature removals were changed.

The single-sale dialog requires a reason and persists its exact request before
submission. Lost-response recovery survives reload; the saved retry cannot pay
cash or restore stock twice. Approval stays tied to the cashier and exact action.
Missing legacy account payment details block a void for reconciliation. External
card reversals remain manual. Older status-only void dates are not guessed;
reports warn about excluded history and make affected profit unavailable.

Validation: the complete backend run passed 419 tests in 46 suites. Final guards
and approval coverage then passed 27 affected tests, including two additional
scenarios, for 421 distinct passing backend tests (119 unit, 302 integration)
across those runs. Eight browser scenarios passed together; the final void test
also passed again with stable screenshots. Cumulative browser coverage is 35
scenarios across previous full and focused runs. Lint, frontend/backend type
checks and the production build passed. Light desktop and dark mobile void
dialogs were visually inspected. The regenerated source inventory contains
34 routes, 578 action definitions and 261 API declarations, not verified counts.

Migration 12 was checked on an empty database and a restored local copy before
local deployment. All old table hashes and earlier migration history were
preserved. Fresh and upgrade schemas have zero drift and all 10 custom triggers.
Database/uploads backups are under
`.local/implementation/pre-sale-voids-1792198067441/`. Read-only checks preserve
2 sales, $115.86 sale totals, 9 products, 613 stock units and 5 users. API/frontend
health returned 200. See DATABASE_MIGRATIONS.md and docs/sale-accounting.md.

## Overall Report reconciliation checkpoint (2026-10-16)

Overall Report cards, daily/hourly trends, payment labels and original-seller
figures now use the same sale/refund/void rules in one repeatable-read database
snapshot. Product/category figures include signed reversals, with unallocated
legacy activity shown explicitly. The controller delegates to a report service;
SQL aggregates replace full-sale reads and repeated independent calculations.
This is not a measured performance-target claim.

Rolling 7/30/365-day windows include today through the captured report time;
the chart contains exactly 30 store dates. Midnight, repeated DST hours and
future records are handled consistently. Growth and payment shares are unavailable
when their denominator/history cannot support a meaningful percentage. Negative
category values use a bar chart. Current product categories are identified as
such; missing historical categories are not invented. MISC and untracked stock
do not inflate inventory value, and the old unsupported turnover estimate is
unavailable. The existing page structure and super-admin dashboard are preserved.

Validation: 47 affected backend tests across five suites and nine browser
scenarios passed, including six new integration cases and one new browser case.
Cumulative coverage is 427 distinct backend tests (119 unit, 308 integration,
47 suites) and 36 browser scenarios across the earlier full and later focused
runs, not a new full-suite result. Lint, frontend/backend type checks and the
production build passed. Desktop light cards and signed category rendering were
inspected. Static inventory remains 34 routes, 578 action definitions and 261
API declarations. No database migration was needed.

## Employee activity reconciliation checkpoint (2026-10-17)

Both employee reporting APIs now share dated sale/refund/void aggregates, store
date validation and a repeatable-read snapshot. Net collections are separated
from original-sale counts and original order averages. Reversals are attributed
to the original seller, and wage/credential fields are never selected. Foreign
store requests are rejected and unassigned legacy activity is excluded. Empty
date inputs mean month to date; requested ranges are capped at 366 local dates.

The Employee Sales workflow is extracted into a dedicated component. Its list
and details expose retry errors and ignore responses from older dates/sessions.
The detail dialog uses the same report service, exact captured date boundaries
and seller scope, showing signed sale/return/void entries. Pages of 50 replace
the silently truncated first-50-sale list. The 5,000-entry report cap remains
explicit; server pagination is still pending. Super admin's removed Reports
screen remains inaccessible. No payroll access or dashboard layout was changed.

Validation: 17 backend tests passed for this follow-up, bringing the Overall and
Employee batch to 58 distinct passing tests across seven suites. Nine existing
report/void browser scenarios passed; two new Employee browser scenarios passed
after correcting their initial test assumptions about Strict Mode and the
intentionally inaccessible super-admin Reports route. Cumulative coverage is
431 distinct backend tests (119 unit, 312 integration, 48 suites) and 38 browser
scenarios across previous full and subsequent focused runs. Lint, backend/frontend
type checks and production builds passed. The light desktop employee detail
dialog was inspected. The source inventory is 34 routes, 581 action definitions
and 261 API declarations; these remain source counts, not verification counts.

The final Overall build and read-only localhost checks resumed successfully after
automatic approval review temporarily could not run because of a usage limit.
Both services returned 200. The current local data check reads 3 sales totaling
$1,241.97, 9 products, 544 stock units and 5 users; this is a new observation after
the prior checkpoint, not an assertion that the earlier totals were unchanged.
These reporting changes required no database migration.

## Store dashboard checkpoint (2026-10-17)

Preserved the store dashboard layout and corrected its hourly/product/payment
widgets to use the same dated financial activity as the reporting services.
The main endpoint now supplies a single snapshot for cards and widgets, with
exact 7/30-day local windows, future exclusion, original order averages and
visible legacy-history gaps. Repeated DST hours remain separate in the rolling
12-hour chart. Signed payment shares are unavailable when inappropriate.
Product returns/voids use recorded line allocations; missing allocations are
identified. Active-shift totals are calculated from original linked activity
instead of stale counters. Cashier responses exclude other staff activity and
all wage fields. Stock alerts exclude MISC/untracked products and are bounded
in SQL. No migrations or super-admin dashboard changes were needed.

The frontend makes one dashboard request, cancels/ignores stale responses,
resets for a changed user/role/store, pauses hidden-tab polling and keeps clock
updates separate from chart rendering. Initial failures show unavailable data;
refresh failures mark retained figures stale. Cashier links to forbidden
Inventory/Reports destinations are hidden. The existing card layout remains.

Validation: 17 distinct backend scenarios passed across three focused suites
(7 dashboard, 6 Overall, 4 Employee), and 7 distinct browser scenarios passed
across focused runs (5 dashboard, 2 Employee). Lint, both type checks and the
production frontend build passed. Desktop light/dark, payment details and dark
mobile chart rendering were inspected. Both existing localhost services returned
200 on a read-only health check. No operational transactions were changed by
the tests; they used the guarded disposable integration/browser databases.
Cumulative evidence is 438 distinct backend tests (119 unit, 319 integration,
49 suites) and 43 browser scenarios across prior full and later focused runs,
not a new full-suite run. Source inventory is 34 routes, 582 action definitions
and 261 API declarations; source counts are not verification counts.



## Fixed-precision money checkpoint (2026-10-17)

Converted 75 remaining monetary/rate fields across 35 tables from Float to
Decimal: booked amounts use two places; unit prices, costs, wages and rates use
four. Explicit numeric boundaries preserve the application's JSON number
contract, including formerly string-valued Decimal snapshot fields. Numeric
strings such as identifiers are not coerced. Account database increments retain
exact cent balances; null historical costs/tax remain null. Existing arithmetic,
reports, exports, account funding, payroll and reversals were adapted.

The register and server now import the same pure promotion contract and decimal
rounding helpers. Unit price is multiplied before line rounding; tax rounds per
line. Half-cent ties round away from zero. New tests cover fractional prices,
negative ties, nonfinite/unsafe inputs, numeric JSON, database scales, concurrent
cent increments and checkout/refund/drawer reconciliation.

Migration 20261017000000_fixed_precision_money refuses meaningful precision
loss before changing any column. A restored clone and fresh database passed
with zero drift. A separate restored clone containing an over-precise value
refused the migration and retained its original value/schema. The paused local
upgrade preserved canonical row hashes, original migration records and all ten
custom triggers: 3 sales / $1,241.97, 9 products / 544 units and 5 users. The matched
backup is .local/implementation/pre-decimal-money-1792250766431. All thirteen
reconciled migrations are applied to local/integration/browser databases.

Validation: all 451 backend tests passed in one full run (129 unit, 322 integration,
51 suites); all 43 existing browser scenarios passed in one run. Twelve frontend
unit tests, lint, both type checks and the production frontend build passed.
A 44th browser scenario passed separately: fractional-price cart, quote, payment and receipt. Visual inspection caught and fixed a receipt-line rounding mismatch; the test now asserts the unit precision and $3.02 line amount as well as the $3.32 total.
This batch does not close the remaining phase exit conditions.

## Store-scoped AI/digest and forecast checkpoint

AI tools now require an assigned store, validate bounded dates and limits, and
reuse dated financial metrics for sales, refunds, voids, products, employees and
payment labels. Store-local hourly timestamps distinguish repeated DST hours.
Stock alerts exclude other stores, unassigned products, MISC and untracked stock,
and include zero stock even at a zero threshold. Chat history is untrusted;
provider tools cannot select another store or execute SQL. Questions are no
longer copied into application logs; internal query failures are not sent to the
model. Provider availability itself still requires configured-provider validation.

Daily summaries use one store's repeatable database snapshot through the stated
as-of time, include dated refunds/voids, compare equal elapsed periods, and show
history/allocation warnings. Only active owners assigned to that active store
receive its summary. The global recipient setting can narrow that owner list,
never expand access. Each recipient is sent separately for provider compatibility.
The scheduler uses each store timezone. The subsequent delivery checkpoint below adds durable dispatch and partial-send recovery.
No live email was sent during verification; the test provider is mocked and local
automatic digest/birthday schedulers remain disabled for this implementation.

Sales forecasting now queries grouped dated collections instead of loading all
sales. It uses up to 90 complete store dates, includes zero-activity dates, excludes
today/future activity, requires 28 complete dates and seven dates with sales, and
labels weekday means as estimates. Historical weekday min/max is an observed
range, not a claimed confidence interval. Unknown void history blocks forecasts.
The extracted forecast panel handles unavailable data and discards late responses
when the selected period changes. Verification: 28 focused backend tests passed (the two corrected fixtures were re-run in their eight-test suite), three browser scenarios passed, and all 12 frontend unit tests, lint, both type checks and the production build passed. Inspected populated and unavailable forecast screens in desktop light theme; other themes/viewports remain in the broader visual checklist.

## Durable daily digest delivery checkpoint

Migration 20261017010000_email_delivery_queue adds one durable row per recipient.
Concurrent request retries reuse unique identities; database claims use row locks
with SKIP LOCKED. Provider acceptance is recorded separately from inbox delivery.
Expired sending leases and ambiguous network outcomes enter REVIEW rather than
silently resending. Known configuration/rejection failures remain available for
an intentional retry. Recipient role, assignment, activity, address and configured
allowlist are checked again immediately before sending. Successful recipients are
not resent when another delivery fails. Store/day/recipient scheduling keys survive
restarts, while the in-memory timer guard only reduces unnecessary preparation.

Owners can view paginated delivery history and retry failed jobs. An uncertain
retry requires confirmation that provider history shows no delivery, plus an
audited reason. Managers, cashiers and super admins cannot access this owner-only
history. The initiating request identity survives a reload/network retry. Queue
payloads and lease tokens are omitted from the history API. The email utility now
rejects unconfigured delivery instead of logging private email bodies as success;
SMTP rejection, bounded HTTPS calls and uncertain results have explicit outcomes.

A fresh install and restored clone passed with zero schema drift. Local application
preserved every existing business-row fingerprint, all prior migration records,
all ten custom triggers and uploaded-file hashes. Backup/proof:
.local/implementation/pre-email-queue-1792270684527. Fourteen reconciled migrations
are now applied locally and to integration/browser databases. Local frontend/API
are healthy at 5173/5000. Automatic digest/birthday scheduling and the email worker
remain disabled in the implementation server; tests never sent real messages.

Validation: 475 backend tests passed in the full run; the four provider tests then
passed after correcting their test-wide mock override (479 total, 55 suites).
Both new delivery browser scenarios pass, including owner-only controls, queue
status and reviewed retry. Inspected desktop light delivery history. Frontend lint,
both type checks and production build pass. The five new scenarios across money,
forecast and delivery supplement the earlier full 43-scenario browser run.
Exports, webhook queues, other email workflows, configured-provider acceptance,
background-job alerting and complete theme/viewport coverage remain unfinished.

## Activity-log privacy checkpoint

Audit rows, counts and filter choices now share one store/role policy. Managers
and super admins cannot retrieve wage-change or owner delivery-review events,
including a direct action filter. Owners retain their own wage history. Nested
credentials are redacted for all roles; generic payroll details are restricted
for non-owners in addition to the existing wage-field response filter. Platform
activity remains visible to platform admins without exposing wages.

Date filters and displayed timestamps use the store timezone (UTC for platform-wide
queries), including 25-hour days. Pagination is bounded and stable. The screen
ignores late requests, clears incompatible store filters, distinguishes a failed
read from an empty log, and has keyboard-accessible details buttons.

Verification: five new integration tests and two browser scenarios passed.
Inspected the manager's expanded sanitized details. This adds to the previous
479 passing backend tests; the complete suite was not repeated for this scoped
batch. Lint/type checks passed before the final timezone display adjustment;
final frontend build/checks will run with the following navigation batch.

## Navigation, role visibility and store preview checkpoint (2026-10-18)

Related workflows now share contextual navigation: Inventory / Stock Control
(Transfers, Counts, Movement History), Purchasing (Orders, Suppliers, Suggestions),
Customers / Accounts, and Team & Time. Cashiers receive My Shift. Owner-only staff
and payroll destinations remain hidden and forbidden to other roles. Customer
Insights is unavailable to cashiers, and campaign controls remain owner-only.

Insights / Reports & Analysis contains Overview, Sales, Inventory, Staff and
Exports. Advanced analyses use a view selector; Ask AI opens a side panel.
Only the selected reporting component and its data are loaded. Existing URLs
redirect with query strings and hashes preserved. Search, pagination and major
report filters persist in the URL; transfer/count details reopen after reload.
Remaining record-detail URLs and full collection pagination are still outstanding.

Super-admin retains Dashboard, Stores and Users, with Integrations as its own
administrative destination. No reports, payroll or removed revenue graphs were
reintroduced, and dashboard layout remains intact. Store details now expose an
explicit Preview store action with an exit banner. A context generation cancels
old API responses and remounts scoped screens; a held Store A response cannot
populate Store B after switching previews.

Movement history is scoped, paginated, date-bounded and filtered on the server.
Purchase-order search/status filtering occurs before pagination. Supplier selection
uses a searchable paginated picker. Purchasing views fetch independently, reject
late responses and distinguish errors from empty data. A notification overlap
found in the full browser run was fixed: informational toast live regions no
longer intercept register clicks or remain paused over Quick Refund.

Verification: full backend recheck passed 492 tests in 58 suites. New stock-control,
purchasing, customer/team-role, store-preview and reporting-navigation browser
scenarios passed. The earlier 60-scenario run passed 59 and exposed the toast bug;
both affected loyalty-return scenarios passed after its repair. A subsequent
checkout run exposed a test locator entering the cart phone field before the
customer dialog opened; it now explicitly targets that dialog. Final quote work
has separate verification below. Production build, frontend unit tests and lint
passed for navigation; the next build includes all subsequent checkout changes.
The interaction inventory records 49 route declarations, 605 controls and 264
API declarations at this checkpoint; these counts are not verification coverage.

## Final quote and payment-boundary checkpoint (2026-10-18)

The final server quote now includes the selected customer, redeemed points and
tender mix. Quotes use a consistent database snapshot and share the loyalty and
surcharge calculation with sale commit. The register cancels superseded requests,
compares the complete selection before enabling Charge, preserves input on errors,
and offers Retry total. Loaded-session offline cash remains an explicit exception;
account/loyalty operations require connectivity. Sale commit rechecks current store
tax, surcharge, activity, configured tender policy, products and points. Payments
must use whole cents; a one-cent shortfall or split discrepancy is rejected.

EBT/SNAP is gated in both the register and API until tender-aware tax allocation
and original-EBT returns are validated. Merchandise eligibility excludes tax.
Existing EBT history remains readable, while unvalidated cash refunds and voids
of those transactions require reconciliation instead of silently reversing them.
This is a release boundary, not a completed SNAP implementation.

Verification: 67 focused sale/loyalty/refund/approval/backend tests passed before
the additional disabled-tender regression. Three final-quote browser scenarios
cover late replies, retry after failure and the EBT boundary. The full browser
suite subsequently passed all 66 scenarios, including the new Settings checks.

## Shared settings, receipts and role sections checkpoint (2026-10-18)

Settings is divided into Profile & Security, Store, Taxes & Payments, Receipts,
Notifications and Devices. Roles see only their permitted sections; cashiers have
device diagnostics, managers operational settings, and owners tax/payment controls.
Super-admin store screens remain read-only even through direct URLs. Section URLs
survive reload; unsaved section drafts survive switching views. Failed settings
reads stay visibly failed and disable saves until a successful retry.

Settings writes are validated, store-scoped, audited and locked during JSON merging,
so concurrent section saves do not overwrite one another. Partial store edits
preserve omitted address/contact fields. Inactive stores reject configuration
writes. Platform settings reads require a selected store. Ordinary register store
lookups return configuration and the cashier's own active shift, without staff
directories, recent customer sales or store-wide sales totals. Arbitrary legacy
settings JSON is excluded from operational responses.

Shared receipt branding is applied when configuration loads on each register;
hardware saves retain device choices without persisting store branding. Browser
print output and email receipts honor header/footer, address and tax visibility.
Email text is escaped and recipient addresses validated. Checkout refreshes shared
configuration before collecting payment. Failed loads do not silently mark settings
as ready. Device output still requires physical acceptance; a browser print request
is not confirmation that paper was produced.

Verification: six new settings integration tests passed, the existing 29 related
security/store regressions passed, and all nine combined settings/decimal-receipt
checks passed. Eight Settings/navigation browser checks passed, including a new
cashier browser printing shared branding without saving local configuration. The
full 66-scenario browser suite passed. Inspected dark phone receipt settings and
the payment dialog. Lint, 12 frontend unit checks, frontend production build and
backend type check passed. Updated source inventory: 49 route declarations,
611 actionable definitions, 264 endpoint declarations. Local UI/API respond at
5173/5000. No database migration was needed for these checkpoints.

## Bulk-void recovery checkpoint (2026-10-19)

Owners and managers can review up to 50 completed sales, their combined amount
and an explicit reason before recording a bulk void. The exact request is saved
by store and actor before submission. Saved batches remain available after reload,
sign-out/sign-in, filter changes and report-load failures without selecting rows
again. Other users cannot see another actor's recovery. Unreadable or unwritable
recovery storage blocks new batches. Confirmed results whose storage cleanup fails
are described as confirmed and retain their recovery record.

The batch UUID and complete canonical request are bound to the existing immutable
void events. An advisory lock serializes competing reuse of that UUID; all member
events and stock, account, points and drawer effects commit atomically. Changing
the reason, selection, expected amounts, actor or store rejects replay. Exact
retries confirm the saved batch after the original drawer closes. The API now
requires reviewed amounts, a reason and a UUID instead of the earlier saleIds-only
body. See docs/sale-accounting.md. No database migration is required.

Verification: 25 focused backend workflow checks and 14 frontend unit checks
passed. Four browser scenarios passed, covering committed/lost-response recovery,
reload, another user's session, failed report reads, closed-drawer confirmation,
storage failures, correction after a rejected request and existing single-sale
void recovery. Inspected desktop light and phone dark review dialogs. Frontend
lint, backend type checking and the frontend production build passed. The source
inventory now records 49 routes, 620 actionable definitions and 264 endpoint
declarations; these are source counts, not verification coverage. Fresh disposable
integration and browser databases installed all 14 reviewed migrations with zero
schema drift; the development database was unchanged. The full backend regression
passed all 515 tests across 61 suites. Verification used `pos_bulk_void_test` and
`pos_bulk_void_e2e` through explicit environment overrides; the older default test
database was behind the schema. The ignored `.local/run-bulk-verification.cjs`
runner records these overrides. Bulk-refund recovery remains separate work.

## Current implementation and remaining acceptance

The 2026-10-20 checkpoint implements bulk-refund recovery, original-payment refund
limits and mixed payouts, immutable source payments, owner balance corrections,
attested legacy voids, expiring/single-use 2FA recovery, payroll review/payment,
manager offline dispositions, durable email/webhook/export jobs, scoped
pagination/cache/cancellation, stable record URLs and dated inventory/anomaly
analysis. EBT remains blocked; staged tax arithmetic does not activate a provider.

The final full backend run passed all 580 tests across 72 suites. The complete
browser run passed all 109 scenarios, including the 16 role/viewport/theme
contexts and new account-history, inventory-read and store-detail checks. One
additional promotion-edit race regression passed after its final guard, bringing
browser coverage to 110 distinct passing scenarios across the full run and that
focused follow-up. Seventeen frontend unit checks, lint, the frontend production
build and backend compilation passed. Source whitespace validation passed.

Reviewed migrations through `20261019060000_sale_payment_integrity` are applied.
Fresh and restored installations have no schema drift; all 156 original rows
and their matching upload were preserved. The full-day simulation reconciles
money, tax, original costs, liabilities, inventory and the $162 closing drawer.
The recovery source had no durable jobs/export artifacts, so the verifier
reports zero populated-job restore checks explicitly.

All seven performance budgets passed across the full fixture run and a
source-matched report follow-up. First/deep report p95 is 1,361.66/1,476.08 ms;
18 read-only response/summary parity cases also passed after optimization.
The retained-screen audit covers four roles, desktop/phone and light/dark in 16
explicit contexts. It checks route guards, visible named controls, page errors,
overflow, readable phone content and keyboard/menu behavior, alongside the
transactional workflow suite. Inventory and promotion previews now hide writes;
failed and stale reads cannot show another customer/store's activity. Inventory
cards and low-stock reads honor the selected store; untracked/misc/unassigned
stock is excluded from inventory value. The platform drawer uses the full phone
width and the store-detail dialog supports keyboard focus and failed-read retry.
These checks do not establish an independent mutation test for every one of the
675 action definitions, every data state or every physical device.

Physical scanner/printer/terminal acceptance and a named store pilot remain open
until their evidence is recorded. The benchmark uses 100,000 synthetic sales in
a guarded separate database; passing local service budgets does not establish
concurrent-register or live-provider capacity. Deferred product integrations
above remain deferred. The original phase exit checkboxes must not be treated as
production launch approval. See [the current acceptance register](docs/remaining-implementation.md),
[reproduction commands](docs/regression-acceptance.md) and
[hardware/provider requirements](docs/hardware-provider-acceptance.md).

## Consistent interface and global assistant (2026-10-21)

The approved interface plan is implemented: shared management headers and action
placement, compact controls and visible view tabs, consistent dialogs and copy,
quiet automatic reads with draft/review protection, and one permission-aware
assistant on all screens, including sign-in. Checkout and customer display retain
their operational layouts. Local UI and API remain available on ports 5173/5000.

Verification passed: 137 scenarios in the complete browser run, followed by nine
assistant cases including three additional checkout viewports (140 distinct
scenarios across runs); 33 frontend unit checks; 30 backend assistant checks;
frontend lint/build, backend type checking and whitespace checks. Representative
screenshots were reviewed, including final phone sheet layering and focus return.
AI provider responses were mocked; live provider acceptance was not established.
See [interface behavior and verification evidence](docs/interface-consistency.md).
