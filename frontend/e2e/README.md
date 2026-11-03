# Browser verification

Run these commands from the repository root. The suite uses real authentication,
local servers on ports 5174 and 5001, and a disposable PostgreSQL database.
It does not run against the ordinary local register on ports 5173/5000.

## Database setup

The server derives DATABASE_URL_E2E from backend/.env, or appends _e2e to the
database name in DATABASE_URL. The selected database must already exist and have
the reviewed migrations deployed through backend/scripts/migrate.cjs. The seed
script requires the _e2e suffix and rejects the operational database before any
cleanup. It truncates the disposable database at the start of each suite run.
Never point DATABASE_URL_E2E at operational data or bypass its guard.

The fixtures include connected Stores A/B, unconnected C, an empty store and a
forecast store, with owner/manager/cashier/platform accounts and workflow-specific
accounts. Credentials are test-only and defined in utils/auth-helper.ts and
backend/scripts/e2e-seed.cjs; no operational accounts are required.

## Commands (PowerShell)

For guarded creation/migration of separate verification databases and a complete
run, use [the root verification runner](../../docs/regression-acceptance.md).
The commands below use the default or explicitly configured E2E database.

```powershell
# Use installed Edge with the Chromium project.
$env:E2E_BROWSER_CHANNEL='msedge'
npm.cmd --prefix frontend run test:e2e

# Run one workflow.
npm.cmd --prefix frontend run test:e2e -- terminal-recovery.spec.ts

# Interactive browser / Playwright UI.
npm.cmd --prefix frontend run test:e2e -- --headed
npm.cmd --prefix frontend run test:e2e:ui
```

Omit E2E_BROWSER_CHANNEL to use Playwright's installed Chromium. Only the Chromium
project is currently configured. The suite has one worker because its scenarios
share a seeded database; separate suite processes must not run concurrently on
that database. Backend integration tests use a different disposable database.

The test server disables external email/AI credentials and scheduled jobs.
Fixtures, intercepted failures and provider mocks do not establish live-provider
or physical scanner/printer acceptance.

## Evidence

See docs/workflow-verification.md for the screen/action checklist and
IMPLEMENTATION_STATUS.md for dated results and remaining work. Test names describe
the actual scenario covered; the presence of a screen in the suite is not evidence
that every button on it has been verified.

Register recovery tests cover lost terminal responses, persistent original
checkout payloads, cashier/store scope, offline cash retry and manager review.
Catalog tests hold old replies through a new search or logout to verify they
cannot replace current data. Required controls always have explicit assertions;
missing controls must fail their tests.

Failures retain screenshots and traces under frontend/test-results. The HTML
report is under frontend/playwright-report. Both are generated artifacts.
Review traces before retrying a failure, and keep source files stable during a
run: Vite hot reload can reset the very workflow being tested.

Use awaited user-visible assertions and isolated browser contexts. Shared fixture
records should be dedicated to a workflow where order-dependent mutations would
change another test's assumptions. For irreversible/provider actions, use controlled
test destinations or interception rather than sending real messages/payments.
