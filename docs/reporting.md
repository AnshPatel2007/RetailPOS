# Financial report definitions and boundaries

`financialMetrics.service.ts` aggregates booked sales, returns and dated voids in PostgreSQL.
It uses original sale costs and allocated refund tax/restocked cost. Today,
comparison, P&L, product profitability, what-if baselines and selected dashboard
totals use these shared definitions. The super-admin dashboard shares the same
metric summarizer and preserves its existing layout.

- Gross collected: original sale totals including tax, after discounts.
- Net collected: gross collected less refunds and voids recorded in the selected period.
- Net sales: collected sales excluding their tax, less returns excluding their
  original refunded tax, less void reversals excluding their original tax.
- COGS: original unit costs times sold quantities, less the cost of units
  physically restocked in the return period and the original cost reversed by voids.
- Gross profit: net sales less COGS.
- Operating profit: gross profit less approved/paid operating expenses; pending
  and rejected expenses do not contribute. Payroll remains in aggregate cost.
- Inventory acquisitions: approved/paid `INVENTORY_PURCHASE` records are shown
  separately and excluded from operating expenses. Their merchandise cost is
  recognized through original sale-line COGS, avoiding a second deduction.
- Margin: the associated profit divided by positive net sales. Empty or
  nonpositive sales have no meaningful margin percentage.

Missing historical cost or refund tax yields `null` and an explanation. Current
product cost is never a replacement for a missing original cost. Cash-flow and
break-even remain unavailable without the required accounting/configuration.
Health scores are labeled heuristics. What-if volume changes only by the user's
input; the app does not assume a price-elasticity model.

Selected-store date-only filters use that store's timezone, with the end date
inclusive through its local calendar day. Each midnight is converted separately
for daylight saving. Explicit timestamps require an offset. Platform-wide ranges
use UTC. Remaining legacy reporting endpoints have not all adopted this helper.

## Sales screen and downloads

`salesReport.service.ts` supplies the screen, CSV and PDF from the same filters
and transaction snapshot. Original fully refunded sales remain visible in their
sale period. Returns appear separately in their issue period, including returns
against older sales. Legacy missing refund tax is unavailable in downloads too.

Employee, customer, payment-method, search and amount filters refer to the
original sale. The tender filter matches its primary tender label, including
when the sale also has other payment rows; the filter is named accordingly.
Payment breakdowns use recorded split payment amounts net of cash change,
actual refund destinations and recorded void tender allocations. Historic
records without those allocations retain their stored tender labels. These
are POS records, not confirmation of external processor settlement. Original non-booked status rows may be inspected but
contribute zero. New voids retain the positive original sale in its sale period
and add a signed reversal in the void period. Older status-only voids have no
known reversal date, are excluded from recorded-activity amounts and produce an
explicit history warning. Profit/margin stays unavailable where that history
could affect the period; the migration does not invent a reversal date.

Sales CSV now contains `SALE`, `REFUND` and `VOID` entries, a record ID, original sale
reference, timestamp, store date/timezone, signed total/tax and original sale
amount. The reversal-tender allocation column retains recorded refund-source,
destination and reference evidence or the recorded void tender map.
`Original Sale Total` is a reference field and must not be summed over
refund or void rows. Amounts already include the original discounts. Empty CSV downloads
retain their header. Consumers of the previous CSV columns must adopt this layout.

The screen requests server pages of 50 original sales, 50 dated refunds and 50
dated voids independently. `page`, `refundPage` and `voidPage` persist in the URL;
changing filters resets these pages. Selection applies to the current sales
page. Counts, cards and charts aggregate the complete filtered range in SQL and
do not change merely because another page is selected. Each response uses one
repeatable-read snapshot. Concurrent activity can change page membership between
requests; the UI does not claim a snapshot lasting across separate page requests.
Page numbers must be whole numbers from 1 through 1,000,000,000 and clamp to the
last available page after counting; the former 10,000-page bound no longer makes
records beyond the first 500,000 unreachable. The page size remains 50.

Reports and employee drill-downs use a bounded memory cache keyed by user, role,
store, preview and session/context generations. Superseded requests are cancelled;
previous-scope results cannot populate a new key. Successful API mutations clear
these cached reads; read-only quote/preview/chat calls do not. A browser check
covers returning to the cached report after completing a POS checkout.

The `record` URL parameter opens an independently authorized sale detail, including
after reload or when its original page is not loaded. Detail read failures show
Retry, and refreshes disable its actions until current facts return. The shared
dialog provides focus handling, Escape and an accessible close control. Updating
same-key results are marked as previous results; failed report reads provide
Retry. Negative or zero-total chart data uses bars rather than pie shares.

Direct CSV, PDF and accounting sales downloads load the full filtered snapshot,
ignoring all page parameters. The preview identifies the full entry count and
labels its loaded-page sample. These downloads retain an explicit limit of 5,000
combined sale/return/void entries; the paginated list is not limited to 5,000.
Larger filtered downloads require narrower dates/filters. Owners can separately
queue a durable storewide CSV for selected store dates from Background jobs;
that storewide export does not promise the Sales screen's employee/search filters.
Export failures retain the preview for retry. CSV/PDF helpers reject a partial
page accidentally passed as a complete report.

2026-10-20 verification: the focused report/employee/void/accounting run passed
22 backend checks, including 5,001 rows with full totals, deterministic pages,
independent reversal pages and full CSV/PDF downloads from a page-three request.
Eight browser checks passed together for record-URL reload, detail failure/retry,
cached-checkout invalidation, employee cancellation and reversal recovery. Mobile
dark detail close visibility and Escape were checked automatically. This does not
establish visual acceptance of every report control or printed PDF layout.

## Remaining accounting and verification work

Complete fixed-decimal conversion, general financial correction workflows,
tender-specific tax, remaining employee/forecast/AI/digest metrics,
and complete timezone adoption remain open. Other expense categories also need
their accounting policy reviewed before treating this as a complete general ledger.

Accounting sales export now uses the same report service and filters as Sales.
Void entries debit the distinct `Sales Voids` account and carry signed original
tax/amount; original-sale references remain visible. This is an export journal,
not external-terminal settlement or a complete general ledger. Remaining
dashboard-hourly/forecast/AI/digest reports still need shared-metric adoption.

API tests cover historical cost, later-period returns, missing data, filters,
daylight-saving boundaries, store permissions, empty output and the size cap.
Browser tests verify displayed totals, both downloads and retry after a failed
download. PDF validity and download are checked; exhaustive multi-page/font/print
layout acceptance remains pending. Performance targets and physical printing are
not inferred from these tests.

## Inventory purchases and expense dates

Purchase records stay in expense history, budgets, category totals and accounting
exports. Existing super-admin `totalExpenses`/store `expenses` fields still mean
all approved/paid recorded expenses. Additional `operatingExpenses` and
`inventoryPurchases` fields explain the split; profit deducts operating expenses.
Payroll cost is retained, while non-owners receive only its aggregate.

Accounting exports debit `Inventory Asset` for inventory purchases and preserve
the distinction between paid cash/bank entries and approved accounts payable.
Recording a purchase neither receives stock nor marks an unpaid bill as paid.
Purchase amounts cannot reconstruct missing historical sale costs. Unsold
purchases alone do not produce COGS or a meaningful margin percentage.

The inventory cost recognition model follows the principle described in
[IAS 2 Inventories](https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/).
This POS report is not a complete general ledger: capitalization of other assets,
inventory write-downs, valuation methods and jurisdiction-specific accounting
remain separate work.

New manual date-only expense/due-date inputs use the assigned store's midnight.
Explicit timestamps retain their instant. Expense lists, their CSV/PDF date
filters, financial expense exports and P&L use the store calendar; platform-wide
queries use UTC. Unbounded expense lists retain future obligations. Blank optional
due dates are accepted. Unassigned legacy expenses are excluded from these lists
and aggregates until ownership is reviewed.

Existing timestamps are not rewritten. Older date-only entries saved at UTC
midnight may display on the preceding store day; their intended date needs review
before correction. Editing another field preserves that timestamp. Recurring
scheduling, budget period rules, other legacy report dates, and complete expense
filter/summary/export parity still require their remaining planned work.

Financial now ignores late responses from prior stores, users or views, clears
record/form selections on scope changes, and offers Retry after read failures.
Platform views hide expense/budget/recurring write controls; recurring requests
include the selected store. The shared dialog handles expense-form focus and
Escape, with dismissal blocked while saving/uploading. Browser coverage includes
manual entry from a register in another timezone, read-only platform controls,
delayed store responses, and outage recovery. Desktop light views were inspected;
this does not establish every viewport or theme.

## Overall Report reconciliation

`overallReport.service.ts` reads the financial cards, activity breakdowns and
supporting summaries in one repeatable-read transaction. Its daily/hourly,
payment-label and original-seller aggregates use SQL sums over original sales,
dated refunds and dated voids; they no longer load whole sale collections or
omit a sale because it was later returned/voided. The money series sum to the
same net-collected figures. Original sale counts and original order averages
remain distinct from signed collections after reversals.

Today uses the store midnight; rolling 7/30/365-day windows include today and
end at the captured report time. The 30-day chart has exactly those 30 store
calendar dates. Repeated daylight-saving hours combine into one hour bucket.
Future-dated activity is excluded. Platform-wide reporting uses UTC and excludes
unassigned records. Comparison windows are the preceding complete 7/30 calendar
days; current windows include the partially elapsed current day. Growth is
unavailable when the previous net amount is nonpositive or legacy void history
is incomplete, rather than reporting an invented zero percent.

Payment labels follow the original sale/void and the refund's recorded method;
they are not a split-tender settlement report. Shares are unavailable with
negative buckets or nonpositive totals. Category charts use bars for signed or
zero-total data. Product categories are the current catalog classification;
historical category snapshots are not inferred. Unallocated legacy return/sale
amounts appear as a separate category bucket so their absence from product
details is explicit. Current stock value includes tracked inventory and excludes
MISC; turnover is unavailable until historical average inventory exists.

Six integration scenarios cover reconciliation against Sales/accounting exports,
exact window limits, future records, store-local midnight and repeated DST hours,
legacy gaps, permissions, unassigned records and empty inventory states. Nine
affected browser scenarios passed together, including the signed-category view
and Overall totals after void recovery. Desktop light rendering was inspected.
Staging performance targets and other viewports remain outside this checkpoint.

## Employee Sales and activity details

Both `/reports/employees` and `/reports/employee-sales` now use the same grouped
dated activity and a repeatable-read snapshot. Existing response aliases remain:
`totalSales`/`totalRevenue` are net collected including tax, while
`averageOrderValue`/`avgTransaction` use gross original purchases divided by the
original sale count. Returns and voids belong to their reversal period and are
attributed to the original seller, not the employee paying the return. Current
staff name/role details are selected explicitly; wages and credentials are absent.

The default period is month to date. Explicit dates use the selected store's
calendar and are limited to 366 inclusive calendar dates. Ownership is validated
on both endpoints; unassigned legacy activity is excluded. A history warning
identifies status-only voids whose dates cannot be reconstructed.

Employee Sales is extracted from the large Reports component. Lists and details
show loading, error and retry states; superseded requests are cancelled. Dates,
selected employee and activity page persist in `employeeFrom`, `employeeTo`,
`employee` and `activityPage` URL parameters. The detail dialog uses the same Sales
report with the captured date range and original seller filter. Its `entryPage`
request returns a combined server page of 50 signed SALE/REFUND/VOID entries;
the displayed count and net collections still cover the whole captured range.
The direct-download 5,000-entry limit does not truncate this drill-down. New sales
after the captured end instant do not shift the detail period silently. Super
admin's removed Reports screen remains inaccessible.

Four integration scenarios verify endpoint/detail parity, missing legacy dates,
local midnight/DST boundaries, more than 50 records, invalid/oversized ranges,
empty states, forbidden store/cashier access and wage privacy. Two browser
scenarios verify list/detail outage recovery, signed entries, date changes and
discarding delayed responses. Desktop light detail rendering was inspected.


## Store dashboard collections and widgets

The store dashboard retains its card/chart layout. Its main endpoint now returns
cards and widgets from one repeatable-read transaction and one captured instant.
The compatibility hourly endpoint uses the same widget implementation. The UI
makes one dashboard request, avoiding separate card/chart snapshots.

Today follows the store timezone; rolling 7/30-day windows include today and
start six/29 calendar dates earlier. All windows exclude future activity.
Collections include tax and subtract refunds/voids on their recorded reversal
dates. Original sale counts and original order averages remain separate from
net collections. Legacy void dates remain unknown and carry a visible warning;
comparisons against nonpositive or incomplete baselines are unavailable.

The chart covers twelve elapsed hours and has 13 buckets because the first and
current hours can be partial. UTC epoch keys preserve repeated DST hours;
labels use the store timezone and zone abbreviation. Payment labels reconcile
with today's collections, but are not a split-tender settlement report. Shares
are unavailable for negative buckets or nonpositive totals. Product rankings
use signed line collections and original descriptions, including return/void
allocations. Historical allocation gaps are disclosed; the top-five selection
is not presented as the entire store's total.

Active-shift collections are recalculated from original shift-linked sales and
their reversals, rather than cached shift counters. A payout made by another
drawer is still reconciled in the drawer ledger; this widget is original-sale
attribution. Up to ten active shifts are displayed, with the full count shown.
Cashiers receive only their own sales/shift activity and no wage fields.
Unassigned legacy records are excluded from platform aggregates. Stock alerts
are filtered/count-limited in the database, exclude MISC/untracked products,
and distinguish out of stock from low stock.

Initial read failures show unavailable data, not zero cards. Refresh failures
retain explicitly stale results with their as-of time. Older requests are
cancelled/ignored; user/role/store changes reset the view. Polling pauses when
the tab is hidden and resumes on visibility. Clock ticks are isolated from
chart/table rendering. Cashiers no longer receive shortcuts to restricted
Inventory or Reports destinations. The super-admin dashboard is unchanged.

Seven integration scenarios cover signed activity, period and DST boundaries,
partial-hour/future exclusion, original shift attribution, account/store scope,
legacy gaps, MISC and empty states. Five browser scenarios cover rendered totals,
both themes, mobile overflow, initial/refresh failures, delayed responses,
cashier actions and hidden-tab polling. Light/dark desktop, dark payment cards
and the mobile chart were inspected. Production-size performance targets,
all controls and full role/viewport coverage remain unverified.

AI tools and daily digests use the same dated collections as reporting. Payment-label tools are not split-tender settlement reports. Digest recipients must be active owners of that exact active store; DAILY_DIGEST_EMAILS only narrows those recipients. Digests state their timezone/as-of time and compare equal elapsed periods.

Forecasts use up to 90 complete store dates (including zeros after the first recorded sale), require 28 dates and seven dates with sales, and exclude the current partial day. Weekday means are estimates; displayed ranges are observed weekday minima/maxima, not probabilistic confidence intervals. Undated legacy voids block prediction.

Booked amounts are database decimals, serialized as JSON numbers for compatibility. Unit prices/costs retain four places. Multiply price by quantity before rounding a line; tax rounds per line; half-cent ties round away from zero. Receipt line amounts before discounts use these same rules, and unit prices display up to four places.
