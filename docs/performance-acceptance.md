# POS performance acceptance

`node scripts/pos-performance.cjs all` creates a synthetic PostgreSQL fixture and measures the actual application services. It never uses operational records as fixtures, starts application workers, sends receipts, or invokes payment providers.

Run from the repository root with the normal dependencies installed and a local PostgreSQL server available. The normal `backend/.env` supplies connection credentials; the default target appends `_performance_v2_benchmark` to its database name. That database is separate from the operational, integration-test and browser-test databases.

```powershell
node scripts/pos-performance.cjs prepare
node scripts/pos-performance.cjs run
```

To choose another target, set `DATABASE_URL_BENCHMARK` privately to a distinct localhost PostgreSQL database whose name ends in `_benchmark`. Do not put credentials in logs or committed scripts. Optional settings:

| Setting | Default | Purpose |
| --- | --- | --- |
| `POS_BENCHMARK_SAMPLES` | `10` | Warm measurements per workload; whole number from 5 to 100. Use at least 30 for release comparisons. |
| `POS_BENCHMARK_OUTPUT` | `.local/performance/<timestamp>.json` | Standalone report path inside the workspace. |
| `POS_BENCHMARK_WORKLOADS` | All seven workloads | Optional comma-separated names for a diagnostic subset: `dashboard,inventory,anomalies,forecast,financial,reportFirst,reportDeep`. Only a `coverage: COMPLETE` report represents full acceptance. |

The tool rejects operational aliases, remote servers, other database suffixes, and schemas other than `public`. Before migration or seeding it checks for existing application records. It refuses populated unowned databases and incomplete fixtures. A matching completed fixture is retained and reused; `prepare` applies pending reviewed migrations without reseeding. There is no reset, truncate, drop-database, or automatic cleanup command. Choose a fresh `_benchmark` name when the fixture version changes. Reviewed migrations are copied to a temporary directory so the benchmark does not modify the development migration schema or regenerate Prisma. Existing artifact files are never overwritten.

## Fixture and scope

The deterministic SQL fixture contains exactly 100,000 sales, 200,000 line snapshots, 10,000 catalog products and 2,000 customers across two stores. Ninety percent of sales and catalog rows belong to the measured Chicago store; the remaining records belong to a Los Angeles store to exercise isolation predicates. Categories cover grocery, liquor, tobacco, household goods and cold drinks. Age restrictions and SNAP eligibility are catalog facts only; this fixture does not enable SNAP acceptance.

Sales span approximately 180 days. Original lines contain their recorded prices, quantities, tax amounts, tax rate, tax treatment and historical unit costs. Today's product cost differs from those historical costs. Dated partial returns carry line-level tax/cost facts and original tender allocations. Full voids retain complete item snapshots and tender totals. Returns and voids occur two days and one hour after their original sales, exercising reversal-period queries rather than subtracting from the original day. Some products have zero stock or missing supplier lead time; unavailable planning facts must remain unavailable.

The fixture is synthetic read-model load. It bypasses checkout to insert the scale efficiently and does not represent merchant settlements, closed drawer reconciliation, or physical stock acquisition. Browser workflow tests and the full-day accounting verification cover those operational flows separately.

## Measurements and targets

Each workload runs sequentially in its own fresh Node process. After a read-only fixture preflight, the client disconnects; the first timed service call includes application module imports, reconnecting the pool and JSON serialization. This is a **process-cold service call**, not a cold PostgreSQL or operating-system cache test. Two untimed warmups precede the measured warm samples. Application services share a five-connection maximum for these runs. No deliberate concurrent load is applied.

Warm percentiles use nearest rank: `sorted[ceil(percentile * count) - 1]`. With the default ten samples, p95 is the slowest measured sample. The artifact retains every measurement, sample count, first-call latency, response size, machine details and PostgreSQL version. These numbers exclude HTTP authentication, browser rendering and network time.

The following warm p95 targets leave room for normal UI/network overhead on a local pilot server. They are practical regression budgets, not provider or production capacity guarantees.

| Workload | Data requested | Warm p95 target |
| --- | --- | ---: |
| Dashboard | Store cards, current-day charts and rolling financial comparisons | 1,500 ms |
| Inventory predictions | Complete-date demand and bounded first product page | 2,500 ms |
| Sales anomalies | Complete-date daily and product activity | 2,500 ms |
| Sales forecast | 90 complete historical dates and 30 estimated dates | 1,500 ms |
| Financial summary | Rolling 30 store dates, original and reversal facts | 1,000 ms |
| Sales report, first page | Full-range totals with at most 50 displayed sales | 1,500 ms |
| Sales report, page 900 | Same full-range totals with a deep bounded page | 1,500 ms |

Reports must supply server pagination; the tool fails rather than benchmarking the old 5,000-entry rejection as a successful page. Financial totals must continue to represent the entire selected period while result rows stay bounded.

For every workload the tool captures the five slowest unique SQL statements observed. It replays each through `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` inside a read-only transaction with a 30-second statement timeout. It also locates the actual prepared statement on that connection, records its custom/generic plan counters, and explains `EXECUTE` using the same fixture parameters and observed transaction-local plan/memory settings. When PostgreSQL has selected generic plans, a transaction-local forced-custom comparison is recorded as diagnostic evidence; measured service calls keep the settings chosen by the application. This distinction matters because a fast plan with literal values, or a plan explained after a transaction setting expires, can hide the plan used by the service.

The artifact includes execution plans, buffers, actual row counts and planning/execution time, applied migration checksums, and SHA256 hashes of measured source files. It checkpoints after each workload and flags source changes during a run. A plan failure or missed budget makes acceptance fail. SQL parameters are synthetic fixture values and connection credentials are omitted.

Do not add an index solely because a query scans a table: aggregate queries may correctly prefer a sequential scan. Identify the slow statement and its actual rows/buffers, change one access path, and repeat the same fixture and workload. Record measured before/after evidence with any proposed production migration.

## Recorded verification

The executable guard checks have refused the operational URL, its localhost hostname alias, a `_test` target and a remote `_benchmark` target. The v2 fixture seeded successfully with 4,099 allocated refunds and 3,933 immutable void events. Repeated `prepare` retained all fixture records. Integrity preflight confirms header/line tax totals, full-void original cost totals, refund line and tender allocations, and store ownership.

The initial run identified three concrete access-path problems before acceptance:

- Inventory planning recreated date formatters and complete-date cutoffs per catalog row. Warm p95 was 2,477.74 ms; cached formatters and once-per-request boundaries reduced the diagnostic p95 to 1,251.30 ms on the same fixture.
- Payment breakdowns made 90,000 correlated tender queries, touching 632,594 shared buffer blocks and taking 2,382.73 ms in the first-page report plan. A scoped grouped tender CTE now replaces those repeated probes. Per-kind page IDs also use bounded ordering rather than ranking the entire union.
- PostgreSQL switched financial metrics from five custom plans to generic plans. The forecast's generic metrics plan estimated 240 sold rows but read 45,268, repeating item-existence, missing-cost and cost probes. `EXPLAIN EXECUTE` took 1,183.49 ms while the literal equivalent took 406.12 ms. A shared materialized per-sale line-cost/completeness rollup removes the duplicate probes without changing global database planning settings.

Before and after the rollup, financial outputs matched exactly in 13 read-only scenarios covering rolling dates, both stores, platform totals, missing sale lines, unknown original/return/void cost, amount-only returns and unknown refund tax. The uncertainty cases used temporary views, discarded when the dedicated client disconnected; fixture business rows were unchanged. Evidence: `.local/performance-financial-equality.json`.

Initial and diagnostic artifacts: `.local/performance/2026-10-20T04-38-05-627Z.json`, `.local/performance/2026-10-20T04-39-07-695Z.json`, and `.local/performance/2026-10-20T04-40-52-309Z.json`. They document the issues above and are not acceptance passes; the initial run overlapped the tail of a focused test suite and later source changes.

The complete quiet-window run in `.local/performance/2026-10-20T04-45-24-522Z.json` finished with unchanged source hashes and five passing workloads. Its overall `accepted` value is **false** because the two full-range report workloads exceeded their budgets. Ten warm samples followed two warmups for every row below. The fixture had 20 reviewed migrations applied. Hardware: AMD Ryzen 7 8845HS, 16 logical CPUs, 15.31 GiB RAM; Windows x64, Node v24.11.0.

| Workload | First service call | Warm p50 | Warm p95 | Result |
| --- | ---: | ---: | ---: | --- |
| Dashboard | 723.89 ms | 966.98 ms | 988.50 ms | Pass |
| Inventory predictions | 1,178.94 ms | 1,018.00 ms | 1,157.40 ms | Pass |
| Sales anomalies | 1,129.81 ms | 1,713.77 ms | 2,000.12 ms | Pass |
| Sales forecast | 533.97 ms | 1,101.78 ms | 1,400.47 ms | Pass |
| Financial summary | 235.42 ms | 198.56 ms | 215.98 ms | Pass |
| Sales report, first page | 1,444.47 ms | 3,811.64 ms | 4,112.71 ms | Miss |
| Sales report, page 900 | 1,483.41 ms | 3,913.26 ms | 4,763.46 ms | Miss |

The remaining report plans showed unnecessary inventory-cost work and parameter-sensitive generic plans. A report now requests a collection-only summary using the same shared scope/date filters and financial formulas. It does not request inventory margins or expense obligations, neither of which this report displays. A transaction-local custom-plan setting lets PostgreSQL plan that report for its actual date range; the setting expires at commit or rollback and does not change server defaults.

The report change passed 18 read-only parity scenarios, including exact whole-response equality for pages 1 and 900. Other cases cover all report summary fields, both stores, platform scope, amount/status/employee/tender/search filters, literal wildcard searches, unknown refund tax, legacy void warnings and unknown original cost. Temporary views were discarded and fixture rows retained. Evidence: `.local/performance-report-equality.json`.

The first report-only follow-up, `.local/performance/2026-10-20T13-19-31-540Z.json`, reduced warm p95 to 1,332.93 ms for page 1 and 1,532.53 ms for page 900. The deep page still missed the unchanged 1,500 ms budget. Its date/tender aggregation plans spilled temporary data at the default 4 MB workspace: the custom breakdown plan recorded 2,089 read and 2,442 written temporary blocks, with five hash-aggregation batches. A report now sets `work_mem` to 16 MB for its transaction, reverting at transaction end. This allowance applies per PostgreSQL executor node; memory use under simultaneous report requests has not been load-tested.

The 16 MB follow-up still narrowly missed the deep-page target at 1,518.34 ms. The final change shares row-count facts with the collection-summary query, removing the separate full-range count scan. Selected audit-row counts remain distinct from booked sums: PENDING, HOLD and undated VOIDED rows can be displayed and counted under explicit status filters while contributing zero booked revenue. Void row visibility also remains distinct from canonical financial reversal facts. The affected backend report suite passed all 10 tests, including a new mixed-status count regression, independent reversal pages, export guards and historical tax uncertainty. The 18 read-only summary/full-response parity scenarios passed again.

Final report-only acceptance passed in `.local/performance/2026-10-20T13-30-59-268Z.json`, with unchanged source during the run, 10 warm measurements and two warmups per workload:

| Workload | First service call | Warm p50 | Warm p95 | Result |
| --- | ---: | ---: | ---: | --- |
| Sales report, first page | 810.92 ms | 1,213.41 ms | 1,361.66 ms | Pass |
| Sales report, page 900 | 881.88 ms | 1,338.66 ms | 1,476.08 ms | Pass |

Both report pages returned 50 sales out of 90,000 matching original sales, with 1,800 reachable pages and full-period totals. Explain replay confirmed the application's `force_custom_plan` and `16MB` transaction settings; the deep report's breakdown plan wrote 128 temporary blocks, down from 2,442 in the earlier custom plan. No production index or server-wide setting was added.

All seven workload budgets are now met. The standalone combined evidence is `.local/performance/2026-10-20T13-32-00-487Z-composed-acceptance.json` (`accepted: true`, SHA256 `ef85d7c444cde40ab7faf8423769b8679b0e389fa248071ba1f69a1efa253f92`). It explicitly composes the five accepted measurements from the complete run with these two corrected report measurements; it does not claim another single seven-workload execution. The composition verified identical fixture facts, migration checksums and measurement method, and current SHA256 matches for each workload's application/schema dependencies. The dashboard, inventory/anomaly, forecast, financial and calendar implementations were unchanged. Each row retains its original artifact and measurement timestamp.

The JSON artifacts are the detailed reproducible evidence; keep them alongside release acceptance records because `.local` is intentionally excluded from source control. Functional evidence is in `.local/performance-report-equality.json` and `.local/performance-report-counts-tests.log`.

## Pilot limits

These measurements establish local service behavior for this fixture and one machine. A store pilot still needs its actual server, simultaneous tills, scanner and printer, receipt/label layouts, merchant terminal, processor reconciliation and backup/restore timing. The user permits standard barcode scanners and receipt printers, but no physical device model or live merchant account has been supplied. No hardware, settlement, SNAP authorization or live-pilot result is inferred from this benchmark.
