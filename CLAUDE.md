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
  `docs/UPGRADE_PLAN.md`: the roadmap, what is built, and the list of known problems
  (add a problem there when you find one).

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
  The demo seed (`npm run db:seed`) refuses any database that holds a store or a user
  unless it is a disposable test database (`utils/seedGuard.ts`); keep that check first.
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
- **Store days**: a date sent to the API is a whole day in the store's time zone (`storeDateRange` /
  `getReportRange` in `services/reportDates.service.ts`); never read a date with the server's clock.
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
- **Invoice receiving** (Nov 2026, `services/deliveryInvoice.service.ts`,
  `invoiceReading.service.ts`, `invoiceMatching.service.ts`,
  `deliveryInvoiceReceiving.service.ts`; `/api/delivery-invoices`): anyone working in the
  store may photograph a supplier's invoice (up to 5 photos, or its PDF); the photos and a
  draft are saved before the AI reads them, so a failed read is kept to read again.
  Reading never sends the catalog. Lines match SURE only from a match an owner confirmed
  on an earlier invoice from that supplier (`invoice_item_matches`), the supplier's item
  number or the printed barcode; an AI pick among the closest names is only ever "to
  check"; returns and credits are never received. Only owners and managers change or
  receive an invoice (version-checked), and receiving goes through the reviewed receipt
  import: its id is stored on the invoice before it is applied, and every retry, change or
  discard first settles it (`settlePreviousImport`: applied, finish that receipt; not
  applied, delete it), so stock never arrives twice. Confirmed lines are remembered with
  their case size, and the item's supplier link gets the item number, case size and case
  cost. The alert `invoicesToConfirm` opens the oldest waiting invoice. Tests never call
  the AI: under `NODE_ENV=test` only, a request may carry a prepared reading
  (`testReading`).
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
- **Money Ahead** (Finances > Money Ahead, owners only; pure `planCash` in `services/cashPlan.ts`,
  loader `services/cashPlan.service.ts`, `/api/financial/cash-plan`): the next 14 store days. In:
  each weekday's usual sales (median of the last six, `getFinancialBreakdowns`), cash the same day,
  card money N business days later less the fee; lottery sales and the weekly sweep only once the
  owner chose the sweep day. Out: unpaid bills by due date (overdue ones today), recurring expenses
  (`services/recurringDates.ts`, shared with Generate Due Expenses), payroll at period end (about the
  last three periods), supplier deliveries on their delivery days (an open order's own amount, or
  about the last four deliveries), sales tax when scheduled, planned items. Estimates say "about".
  "Money today" counts only on the store day it was entered. With fewer than four of every weekday
  the plan is learning and raises no alert; the attention rule `cashTight` (owners only) names a day
  in the coming week that runs short (or, without money today, where $500 more goes out than comes
  in). Its settings live in `cash_plan_settings`, never in the store settings registers receive.
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
- **Shared catalog** (Nov 2026, `services/sharedCatalog.service.ts`, `sharedCatalogEdit.service.ts`,
  `catalogGuards.service.ts`; `/api/catalog`; Products > Shared Catalog, `/inventory/catalog`, for owners of
  several stores): a `CatalogItem` per organization owns the shared fields of the store products linked to it
  (`Product.catalogItemId`; packs through `ProductSellingUnit.catalogPackId`): name, SKU, barcode, category,
  brand/size/description and selling rules. Each store keeps its own stock, cost and price; the price follows
  the shared one only while `priceFollowsCatalog` is on (switched by the owner or a store admin). Only owners
  change the catalog; each change takes the organization's advisory lock and is all or nothing (a clash in one
  store refuses it and names the store). Store-side writes refuse a linked item's shared fields and a following
  price (`guardProductChange`/`guardPackChange`: item and pack forms, bulk tools, Price Review, stock files);
  a new product write path goes through the same guard, and the item form never sends those fields
  (`SHARED_FORM_FIELDS` in `pages/Inventory.tsx`). Linking existing products is a reviewed preview, then an
  idempotent apply (`CATALOG_LINK`) that never changes prices or stock. A transfer finds the receiving store's
  item through the catalog link before the SKU.
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

- **Shared code builds alone**: the frontend imports some backend files (`lib/barcode.ts`, `lib/money.ts`,
  `lib/promotionEngine.ts`, `lib/capabilities.ts`, the lottery validator and readiness types). Vercel installs
  only the frontend's packages, so those files (and everything they import, types included) must never reach
  `@prisma/client`, `express` or another backend-only package; a package the frontend uses goes in
  `frontend/package.json`. To check, build the frontend in a clean copy after `npm install` inside `frontend/`.

- Use the shared pieces: `components/ui` (Button, Input, Select, Checkbox, Textarea,
  Modal, ConfirmDialog + `useConfirm`, Alert, LoadingState/Spinner, Table, Badge, Kbd,
  DateControl/DateRangePicker) and `components/common` (PageHeader, PageTabs,
  WorkflowNavigation, Workspace's `ManagementPage`/`DataPanel`/`SummaryStrip`/`FormSection`,
  AboutNumbers, EmptyState). No `window.confirm/alert/prompt`.
- **Buttons and layout** (the Nov 2026 UI pass; checked by `frontend/tests/ui-rules.test.cjs`
  in `test:unit` for every `<Modal>`, and by `e2e/ui-rules.spec.ts` in the browser):
  one filled (primary/destructive) button per page header, pop-up footer or card, the
  others outline or ghost. A page header shows at most 3 buttons (2 on a phone), the main
  one last; `HeaderActions` folds the rest under "More". A pop-up's buttons sit in its
  fixed footer, built with `DialogActions` (Cancel, then the main button; a delete or void
  as `remove`, apart on the left; a form submits through its `form` id). A footer never
  says "Close" (the header X is "Close"); a pop-up that only shows information has no
  footer. A table row shows one word plus a "…" menu (`RowActions`); delete lives only in
  that menu, red, and asks first (`useConfirm`). Tables stack into cards on a phone
  (`Table` `stackOnPhone`, on by default; a table with its own phone layout passes
  `stackOnPhone={false}`), and pop-ups become bottom sheets.
- **Alerts**: the attention rules reach owners and managers only through the Alerts bell
  (`components/common/AttentionAlerts.tsx`); nothing about them sits on the Dashboard. At
  sign-in the bell just shows how many are unread; opening it clears the number. An alert
  that arrives during the visit slides in at the top right for about 4 seconds (with ×
  and "View alerts") and the number pops. Read and dismissed marks are kept per person and
  store in the browser (a dismissed alert returns when its wording changes).
- **Products carry no pictures** (the owner's choice, Nov 2026): no image field, catalog
  photo or picture before a product's name.
- **Words**: plain store language ("Sales today", "Sales after refunds", "Balance
  Corrections"). Put method notes behind an "About these numbers" disclosure. Tab labels
  use Title Case.
- **Dates**: `formatDate` / `formatDateTime` from `lib/utils` (optional `timeZone`),
  e.g. "Nov 4, 2026, 2:11 PM". Business-day strings use `friendlyDate`
  (`lib/calendarDates`). Don't call `toLocaleString` on dates.
- **Look** (chosen by the owner Nov 2026): component styles live in `index.css`,
  `styles/controls.css` and `styles/workspace.css`; the app's look is the layer
  `styles/look.css`, every rule under `:root[data-look="new"]` (set on <html> in
  `index.html`). Black is the action color in light mode and orange in dark mode (no white
  fills there), with one bright orange (`--brand`) for what needs attention and for taking
  money; titles and numbers in Archivo (`--display`). Every page opens on a black band
  (`PageHeader` marks `.page-band`) with folder tabs; lists have a black heading row;
  panels are square with a black top edge; back-office forms slide in as side panels
  (`Modal` adds `.app-dialog-panel`) with filled fields and small-capital labels
  (`.field-label`). Dark mode is pure black. Status text uses
  `text-success/-warning/-destructive` (AA-contrast tokens) on `bg-*/10`.
- **Navigation**: `lib/navigation.ts` drives the top bar (`components/common/TopBar.tsx`:
  sections become drop-downs; short menus stay a plain row), the phone drawer (titled
  sections fold as an accordion; the current section opens itself) and quick-find (Ctrl+K).
- **Data**: `useScopedQuery` caches per user/store; any non-GET response invalidates
  reads in this and other tabs (`services/queryCache.ts`). Live badges subscribe with
  `subscribeScopedQueryInvalidation` (see `hooks/useInventoryExceptionCount.ts`).
- **Register** (`pages/POS.tsx`): a finished sale stays in the cart as "Sale complete"
  (change due, receipt options); nothing pops up, so the next scan always counts.
  Cart lines are addressed by their line key (`lib/cartLines.ts`): a deli or scale price-label
  scan is a line of its own at the label's price, and the server accepts repeated lines of a
  product only for those (price-embedded with the label price).
  Scanner input comes from `services/hardware.ts` (keyboard wedge; scan sounds). Tiles are
  colored by category (`lib/categoryColor.ts`), with categories down the left on wider
  screens and a dark sale panel.
- **Age checks** (`components/pos/AgeVerificationModal.tsx`, `lib/idScan.ts`): an age-restricted item asks for
  the customer's ID the moment it is in the cart (tap, scan, search or a restored sale), once per sale for that
  age; closing without a check removes the items it did not cover (`cancelAgeCheck` in `pages/POS.tsx`), and
  Charge keeps the check as a last safeguard. `readIdBarcode` reads every common scanner output: the raw AAMVA
  PDF417 text (line breaks kept, dropped or typed as `<LF>`; letters in either case, as Caps Lock inverts them;
  MMDDCCYY or CCYYMMDD; DAA full names on older cards), fields a scanner parsed itself (any of `$ ^ | , ;` tab or
  line breaks, any order, optional DOB/EXP/ISS labels: an unlabeled earliest date is the birth date, an unlabeled
  future date the expiry), and a magnetic stripe (track 2). Scans come from a 2D scanner's keystroke burst, caught
  before any field or button (an Enter inside it must never press one),
  or from the camera where the browser's BarcodeDetector reads pdf417 (Android, Mac; not Windows or iPhone).
  Under age or an expired ID shows DO NOT SELL; typing the date of birth and the logged visual check remain.
  The result shows the name, city and state with the age so the cashier can compare them with the card and the
  customer (never stored; the sale logs only the method and birth date). A scan that holds no ID details (the
  small barcode at the top of a license, a product) is answered with "scan the larger barcode"; the POS cannot
  choose which barcode the scanner reads (a scanner's "picklist"/centering mode can).
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
- **Receiving from an invoice photo** (`components/deliveries/`): the register top bar's
  Delivery button and Receive Delivery's main action open `InvoiceCapture` (photos shrunk
  to 2000 px on the device, `lib/imageCompress.ts`). Receive Delivery lists the invoices
  waiting for an OK; `?invoice=<id>` opens `InvoiceReview`: photos beside the lines, the
  lines that need a person first ("Is this …?" Yes / pick another / add as new / skip),
  each decision saved as it is made, one "Receive N units" button.
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
