# CLAUDE.md

Guidance for Claude Code (and anyone new) working in this repository.

## What this is

A multi-store retail point of sale for convenience/liquor/grocery stores: register,
products and packs, purchasing, stock control, customers and accounts, promotions,
lottery, finances (P&L, expenses, inventory costs), reports, team/time/payroll and
a platform-admin shell. npm workspaces monorepo:

- `backend/`: Express + TypeScript + Prisma + PostgreSQL. `src/controllers` (use
  `asyncHandler` + `AppError` from `utils/errorHandler`), `routes`, `services`
  (business logic), `policies`, `middleware/auth.ts` (`authenticate`, `authorize`,
  `requireCapability`), `validators` (zod).
- `frontend/`: React 18 + Vite + Tailwind + Zustand + React Aria. `pages/`,
  `components/{ui,common,pos,register,settings,…}`, `store/` (Zustand),
  `services/api.ts` (axios + session/refresh/approval interceptors), `lib/`, `styles/`.
- `docs/testing.md`: how to run every test. `DATABASE_MIGRATIONS.md`: how schema
  changes reach a real store. `API.md`: public API and webhooks. `SETUP.md`: install.

## Commands

```powershell
npm run dev                                    # backend :5000 (nodemon) + frontend :5173 (Vite proxies /api)
npx tsc --noEmit -p frontend; npx tsc --noEmit -p backend
npm run lint --workspace=frontend              # must pass with zero warnings
node scripts/verify-pos.cjs prepare            # disposable test DBs (see docs/testing.md)
node scripts/verify-pos.cjs backend [files]    # Jest
node scripts/verify-pos.cjs browser [specs] --project=chromium   # Playwright on :5001/:5174
```

## Rules that protect store data

- `backend/.env` points at the **real store database** (`pos_system`). Never seed,
  reset, truncate, `prisma db push` or run tests against it. Tests use the
  disposable `_reliability_test` / `_reliability_e2e` databases via `verify-pos.cjs`.
- Schema changes: edit `backend/prisma/schema.prisma` **and** add a reviewed, forward,
  additive SQL migration in `backend/prisma/reconciled/migrations/<timestamp>_<name>/`.
  `node scripts/verify-pos.cjs prepare` applies it to the test DBs and must report
  "No difference detected". The old `prisma/migrations` folder is preserved history,
  never replayed. Applying a migration to the store database needs the user's OK and a
  `pg_dump -Fc` backup first (PostgreSQL 18 tools: `C:/Program Files/PostgreSQL/18/bin`);
  backups live in git-ignored `.local/backups/` and `.local/implementation/`.
- After adding columns, a running API with the old client keeps working, but one that
  restarts on the new client fails on user queries until the store DB is migrated.
- Commit only when asked. Feature work happens on a branch; `main` is for PRs.

## Domain rules (do not regress)

- **Money**: Decimal columns; round each line (`lib/money.ts` `lineMoney`, `taxMoney`,
  `roundMoney`). Show amounts with `formatCurrency`.
- **Sales are booked facts**: lines snapshot name, price, unit cost, tax rate/treatment
  (`pricingVersion = 1`). Reports and reprints use the snapshot, never today's product.
  Missing costs stay "—"/"Unavailable"; never fill a missing cost with a guess. Units sold
  beyond recorded stock carry an estimated (ESTIMATED) cost: profit is still shown, marked
  "not final" with the estimated amount, until a manager resolves those stock exceptions
  (`costBasis: 'PROVISIONAL'`, `provisionalReason` and
  `costCompleteness.pendingEstimatedCost` in `financialMetrics.service.ts`). Every screen
  and export that shows such a profit carries the "not final" mark and the reason.
- **One source for sales figures**: every sales/profit number (Dashboard, Reports, Finances,
  Admin dashboard, store list) comes from `getFinancialMetrics`/`getFinancialBreakdowns` with
  store-timezone ranges; don't sum `sale.total` by hand.
- **Refunds and voids** are dated reversal events: they count on the day they happen,
  not on the original sale's day. Voids are immutable. Refunds go back to the original
  tender (cash→cash, card→card with the terminal reference, gift card→same card, store
  credit→same customer, house charge reduces the debt); EBT/SNAP refunds are blocked.
- **Payments**: one Payment dialog takes successive tenders, saved to IndexedDB
  (`services/paymentSession.ts`) before the sale is submitted. Cards are charged on a
  separate terminal; the POS only records the approval reference. Sales, refunds and
  voids carry idempotency keys, and lost responses retry with the same key. Offline
  sales are cash only (`services/syncService.ts`).
- **Blind drawer close** (on unless the owner turns it off in Settings > Taxes & Payments;
  `cashControl.blindClose`, `services/cashControl.service.ts`): a cashier counts the drawer
  before seeing what it should hold. While their drawer is open the server sends a
  cashier no expected amount, cash sales, cash refunds or tender totals
  (`GET /shifts/current`, the open shift's Z-report, the dashboard's payment totals); the
  expected amount and difference show once they clock out. Managers and owners always
  see them. Do not add a cashier-visible figure that gives the expected cash away.
- **Stock never blocks a sale.** Selling below zero creates an inventory exception that
  managers resolve in Stock Control. Packs/cartons share base-unit stock with their
  single. Corrections never create artificial profit.
- **Multi-store**: everything is scoped by `locationId`. `SUPER_ADMIN` is the platform
  owner: no store of their own, read-only store preview (`store/adminViewStore.ts`),
  and store writes are denied by the backend.
- **Auth**: access JWTs carry a refresh-session id; the `users_revoke_sessions` trigger
  ends sessions on password/role/store/active changes. Cashier discounts, refunds and
  voids need manager approval (the API answers 428 and the app opens the approval dialog).
  Lottery money is not merchandise revenue.
- **Register PIN**: works only on a computer a manager set up as a register
  (Settings > Devices; the server stores only a SHA-256 hash of its secret) for staff of
  that store. PINs are bcrypt-hashed, 4–6 digits, guessable ones refused. Five wrong PINs
  pause PIN sign-in (never the password). Accounts with 2FA cannot use a PIN. Switching
  cashier ends the browser's previous session only after the new PIN is right. Unlock
  answers 422 for a wrong PIN so the client never treats it as an expired session.

## Frontend conventions

- Use the shared pieces: `components/ui` (Button, Input, Select, Checkbox, Textarea,
  Modal, ConfirmDialog + `useConfirm`, Alert, LoadingState/Spinner, Table, Badge, Kbd,
  DateControl/DateRangePicker) and `components/common` (PageHeader, PageTabs,
  WorkflowNavigation, Workspace's `ManagementPage`/`DataPanel`/`SummaryStrip`/`FormSection`,
  AboutNumbers, EmptyState). No `window.confirm/alert/prompt`.
- **Words**: plain store language ("Sales today", "Sales after refunds", "Balance
  Corrections"). Put method notes behind an "About these numbers" disclosure. Tab labels
  use Title Case.
- **Dates**: `formatDate` / `formatDateTime` from `lib/utils` (optional `timeZone`),
  e.g. "Nov 4, 2026, 2:11 PM". Business-day strings use `friendlyDate`
  (`lib/calendarDates`). Don't call `toLocaleString` on dates.
- **Colors**: HSL tokens in `index.css` and `styles/workspace.css`. Dark mode is pure
  black (#000 page, #111 cards, neutral greys), with blue only for actions. Status text
  uses `text-success/-warning/-destructive` (AA-contrast tokens) on `bg-*/10`.
- **Navigation**: `lib/navigation.ts` drives the sidebar (titled sections fold as an
  accordion; the current section opens itself) and quick-find (Ctrl+K).
- **Data**: `useScopedQuery` caches per user/store; any non-GET response invalidates
  reads in this and other tabs (`services/queryCache.ts`). Live badges subscribe with
  `subscribeScopedQueryInvalidation` (see `hooks/useInventoryExceptionCount.ts`).
- **Register** (`pages/POS.tsx`): a finished sale stays in the cart as "Sale complete"
  (change due, receipt options); nothing pops up, so the next scan always counts.
  Scanner input comes from `services/hardware.ts` (keyboard wedge; scan sounds). Products
  without photos show as compact text tiles.
- **Scans are local-first**: `services/registerCatalog.ts` answers a scan from the
  register's saved catalog (IndexedDB, `services/offlineDb.ts`) with no request, online
  or offline; the server is asked (`GET /products/resolve-barcode`) only when the copy
  has no match. `services/syncService.ts` keeps the copy current with
  `GET /products?updatedSince=` (changed rows only) and downloads everything only for a
  new store, a copy over 12 hours old, or a count mismatch. UPC/EAN forms of one code
  match through `backend/src/utils/barcode.ts` (shared with the frontend). Checkout still
  re-prices on the server, so a stale cached price is never charged. A computer set up
  as a register keeps its store's product catalog across cashier sign-outs; customer
  details are always cleared.
- **Offline**: "offline" means the POS server does not answer, not only that the browser
  says so (`services/connection.ts`: a request with no answer triggers a check of
  `/api/health`, and only a failed check takes the register offline; use `isOffline()` /
  `useOffline()`, never `navigator.onLine`, in register code). A register that starts
  with no answer keeps the person who was signed in (`authStore.loadUser`,
  `sessionUnverified`) and re-checks the session when the server returns; a refused
  session still signs out. The cashier's open drawer is remembered on the register
  (`services/openShift.ts`) so offline cash sales have a drawer. The built app is
  installable and its pages are saved by a service worker (`vite-plugin-pwa` in
  `vite.config.ts`; API requests are never cached). Updates wait for the person:
  `components/common/AppUpdateNotice.tsx` applies one only when no sale or payment is open.
- **Reports** (`pages/InsightsWorkspace.tsx`): Overview, Sales, Inventory (Stock Health),
  Staff (Employee Sales), Exports, one view each. The analysis extras (ABC, product
  matrix, forecast, what-if, anomalies, bundles, leaderboards, inventory report) were
  removed at the owner's request: don't bring them back without asking.

## Environment notes

- Windows 11; PowerShell and Git Bash are both available; Python works for scripted edits.
- Dev servers: API 5000, app 5173. Browser tests: 5001/5174. If a page says "Route not
  found" for a new endpoint, the running API is stale: restart it with `npm run dev`.
- Memory is tight: run long test suites in the foreground in batches. Background shells
  may be stopped when memory runs low.
- Dev seed logins (disposable databases only): `superadmin@pos.com` / `superadmin123`,
  `admin@pos.com` / `admin123`, `manager@pos.com` / `manager123`, `cashier@pos.com` / `cashier123`.
