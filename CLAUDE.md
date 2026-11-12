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
- **Stock changes say why.** A movement that is not a sale or a receipt passes `reason`
  to `moveInventory` (the adjustment reason, `COUNT_DIFFERENCE`, the exception
  resolution, `TRANSFER_DAMAGED_OR_MISSING`...); it is stored on the value entry.
  Finances > Inventory Costs > Losses (`services/stockLossReport.service.ts`) groups
  real losses by cause at cost and lists paper corrections (wrong product rung up,
  delivery entered late, sold without scanning) apart: those are never counted as loss.
- **Cost changes and supplier credits**: receiving stores each line's previous cost
  (`purchase_receipt_items.previousUnitCost`, read in `receiveOrder` before
  `receiveStock` changes the item's cost; a receipt import must not write the cost
  first). The receipt review (`previewInventoryImport`, kind RECEIPT) returns a
  `costReview` per changed line: before/after, percent, margin at today's price and the
  target-margin suggestion; rises of at least `purchasing.costChangeAlertPercent`
  (Settings > Pricing, default 3) are flagged. `services/supplierCredit.service.ts`:
  damaged/rejected goods the invoice charged for (`supplierBilledForProblems`, assumed
  when an invoice number is entered) and supplier returns create OPEN credits;
  Purchasing > Credits Owed records and settles them once (RECEIVED or WRITTEN_OFF).
  Credits never change stock or inventory value.
- **Shelf labels**: price changes are stamped by trigger (`priceChangedAt` on products
  and packs, any write path); Products > "Labels to print (N)" and Price Review's
  "Print labels for these items" print them through `BarcodeLabelPrint`, and confirming
  marks each printed for the price change it was printed for
  (`services/shelfLabels.service.ts`, `POST /products/labels/printed`). Raw SQL that
  writes times must write UTC (`now() AT TIME ZONE 'UTC'`): a local database session
  may run in local time.
- **Spot counts** (Stock Control > Counts): `services/countSuggestion.service.ts` ranks
  what to count next with the pure `scoreCountCandidates` (never/long ago counted, stock
  value, 30-day sales, a hand adjustment in 14 days, quick to count), leaving out items
  with an open exception or on an open count; "Start Suggested Count" makes a PARTIAL
  count of them. Stock accuracy = items on counts approved in the last 30 days whose
  count matched the record (`GET /cycle-counts/accuracy`).
- **Reorder suggestions** have one engine: the pure `planReorder` in
  `services/reorderPlan.ts` (unit tested) behind `loadReorderPlan` in
  `services/reorder.service.ts`. A supplier with delivery days
  (`Supplier.deliveryDays`, 0 = Sunday) is planned to the delivery after next plus two
  days (the next delivery is the first delivery day at least the lead time away, never
  today); others keep 14 days of cover and a 7-day urgency window. Days are store days
  (`storeDay`). The supplier form offers the weekdays deliveries usually arrived
  (`GET /suppliers/:id/delivery-days/suggestion`) but never saves them by itself.
- **Mis-scan suggestions learn**: an exception's related items
  (`relatedProducts`/`rankRelatedProducts` in `services/inventoryException.service.ts`)
  rank items mixed up with it in the last 180 days (`mixUpHistory`: SOLD_AS_OTHER
  reclasses and sale-line corrections, either direction; +25 each, at most +75) and items
  at the same price (+15). The attention list names the likeliest pair with stock to
  count (`likelyMixUps`). Nothing is corrected automatically.
- **Missed sales** (`services/missedSales.service.ts`) is an estimate, always worded
  "about": items with 21+ days of history selling 1+ a day over the 28 days before the
  week; out-of-stock stretches from the stock log (a stretch with a sale in it is
  skipped); only the store's selling hours (a sale in that local hour on half the 28
  days); capped at three average days per item; valued at today's price. The attention
  rule `emptyShelves` runs on Mondays for the last seven store days, at $20 or more.
- **Attention list and morning brief** (`services/attention.service.ts`,
  `services/ownerBrief.service.ts`): one rule per exported function returns one plain
  sentence with its amount and the page that fixes it; the Dashboard (owners and
  managers) and the morning brief email share the list. Every number is computed from
  records. The brief covers the last complete store day, goes out once per store day
  from `OWNER_BRIEF_HOUR` (default 07:00 store time) unless Settings > Notifications >
  "Morning brief email" is off, and its AI paragraph is used only when every number in
  it appears in the data (`narrativeNumbersSupported`); otherwise the template is sent.
  Add new attention rules to `attentionRules`, never a number the records cannot back.
- **Multi-store**: everything is scoped by `locationId`. `SUPER_ADMIN` is the platform
  owner: no store of their own, read-only store preview (`store/adminViewStore.ts`),
  and store writes are denied by the backend. Every store belongs to an
  `Organization` (the database gives a new store its own); `UserStoreAccess` lists the
  stores a person may work in with their role there, and the home store's row follows
  `users.locationId`/`role` by trigger. Owners (`OrganizationOwner`) get ADMIN access to
  every store of their organization: call `syncOwnerAccess` after adding an owner or a
  store (`services/organization.service.ts`; read a store's organization with
  `organizationIdOf`). Granting ADMIN or ownership stays a platform-admin action.
- **Active store**: each sign-in works in one store (`refresh_tokens.activeLocationId`,
  null = home). `authenticate` sets `req.user.locationId`/`role` to that store and the
  role there (`actingStore` in `services/session.service.ts`); `req.user.homeLocationId`
  is the person's own store. Read the acting store from `req.user`, never from the user
  row; to ask "may this person act in store X", use `roleAtStore` (manager approval,
  PIN sign-in, exports do). Sign-in, `/auth/me` and `POST /auth/switch-store` share one
  payload (`sessionUser`: `stores`, `organization`, `homeLocationId`). Switching is
  refused by the server while the person's drawer at the current store is open, and by
  the app (`authStore.switchStore`) while the cart, held sales, a payment, a terminal
  payment or an offline sale belongs to the current store. If access to the switched-to
  store is removed, the next request answers 403 `STORE_ACCESS_ENDED`, the session goes
  home, and the app reloads the person there. A PIN sign-in on another store's register
  starts the session in that store. Stores of one organization are connected for
  transfers (`storesConnected`).
- **Owners of several stores** (`routes/organization.routes.ts`): My Stores (`/stores`,
  shown when the person runs more than one store as ADMIN) reads
  `GET /organization/overview` (`services/storeOverview.service.ts`), whose today figures
  share `salesTrend`/`todayRanges` with the Dashboard. Owners give their own staff
  MANAGER or CASHIER access to their other stores from Team & Time > Staff
  (`/organization/access`); ADMIN access, ownership and moving a store between
  businesses are platform-admin actions (`/organizations`, `PUT /locations/:id
  { organizationId }`, Admin > Stores > Business). Removing access is refused while that
  person's drawer is open at the store. The morning brief goes to everyone who runs a
  store as ADMIN; an owner of several stores instead gets one email with a section per
  store (`sendOwnerCombinedBrief`), in their home store's morning.
- **Auth**: access JWTs carry a refresh-session id; the `users_revoke_sessions` trigger
  ends sessions on password/role/store/active changes. Cashier discounts, refunds and
  voids need manager approval (the API answers 428 and the app opens the approval dialog).
  Lottery money is not merchandise revenue.
- **Register PIN**: works only on a computer a manager set up as a register
  (Settings > Devices; the server stores only a SHA-256 hash of its secret) for anyone
  with access to that store, in their role there. PINs are bcrypt-hashed, 4–6 digits, guessable ones refused. Five wrong PINs
  pause PIN sign-in (never the password). Accounts with 2FA cannot use a PIN. Switching
  cashier ends the browser's previous session only after the new PIN is right; requests
  the previous person still has in flight then fail to renew, so the client waits for the
  switch (`trackSignIn`/`signInSettled` in `services/sessionGeneration.ts`) before ever
  signing out. Unlock answers 422 for a wrong PIN so the client never treats it as an
  expired session.

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
- **Receiving by scanning** (Purchasing > Receive Delivery, `pages/ReceiveDelivery.tsx`;
  line logic in `lib/deliveryLines.ts`, laid out for a phone): supplier, optional open
  order, then scans through `components/common/CameraScanner.tsx` (the browser's
  BarcodeDetector on the rear camera, or a typed/USB code) answered by
  `GET /products/resolve-barcode` (a supplier's case barcode brings its case size and cost;
  managers also get `openExceptionId`). Saving goes only through the reviewed receipt
  import (`/products/imports/receipt/preview`, then `/apply`); don't add another receiving
  write path. Low items without an open exception offer a shelf count, posted first
  (`adjust-inventory`, `MANUAL_COUNT`, `expectedVersion`, idempotency key). The list stays
  in this browser per store and person until it is saved.
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
