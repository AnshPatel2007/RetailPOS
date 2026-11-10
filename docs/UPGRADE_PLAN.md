# POS Upgrade Plan (November 2026)

> Approved November 10, 2026. Implement the work packages in order, starting with Phase 0. Nothing in this plan has been built yet.

## Context

The strategic review found the system strong on inventory truth and accounting, and weak at the edge of the store (scan speed, offline start, printing, card entry), in owner-facing guidance, and in multi-store ownership. This plan turns that review into ordered work packages (WP) that can be built one at a time without another planning session.

Findings that drive the order (all verified in code):

- Every scan is a server search (`frontend/src/pages/POS.tsx:416-434`); scanning fails offline although a local catalog exists.
- The register re-downloads the whole catalog and customer list every 30 seconds (`frontend/src/services/syncService.ts` `syncAll` → `cacheAllData`). At a few thousand products this alone exceeds the 1,000 requests per 15 minutes limit.
- "Charge" waits on three sequential requests (`POS.tsx:207-216`).
- No service worker: the app cannot start offline.
- Rate limits are keyed by IP and `trust proxy` is unset (`backend/src/server.ts:40-121`).
- Cashiers see the expected drawer amount before counting (`frontend/src/pages/Shifts.tsx:285,496`).
- `Customer.email` and `phone` are globally unique although customers are per store (`schema.prisma:778-779`).
- 18 local commits and 235 uncommitted changes exist only on this machine; `wip/oct-2026-checkpoint` has no upstream.

## Owner decisions (already made, do not re-ask)

| Topic | Decision |
|---|---|
| Multi-store | Build shared catalog and multi-store owners in full (Phases 3 and 5). |
| Card terminals | Build a processor-neutral terminal layer plus a simulator. Manual reference entry stays the live mode. No real processor. |
| Profit display | When stock exceptions are open, show profit with the estimated part called out, instead of "Unavailable". Exports mark the period as not final. |
| Owner brief | May include one-sentence computed findings (missed sales, unusual days, margin slipping). No charts, no new analysis pages. |

## Ground rules for the implementer

1. Read `CLAUDE.md`, `docs/testing.md` and `DATABASE_MIGRATIONS.md` before starting. Their rules override this plan where they conflict, except the profit rule changed in WP 2.1.
2. `backend/.env` points at the real store database. Never seed, reset, push or test against it. Use `node scripts/verify-pos.cjs prepare|backend|browser`.
3. Every schema change edits `backend/prisma/schema.prisma` and adds a reviewed SQL migration under `backend/prisma/reconciled/migrations/<next timestamp>_<name>/migration.sql`. Copy index and foreign-key naming from a recent migration (for example `20261105020000_register_pin_sign_in`). `prepare` must report "No difference detected". Triggers are invisible to the drift check: list each new one in `DATABASE_MIGRATIONS.md` under "What a schema diff cannot see".
4. Applying a migration to the store database needs the owner's OK and a `pg_dump -Fc` backup. Ask at each phase checkpoint, never mid-package.
5. Ask once, at the start, whether to make a local commit after each work package. The owner has previously wanted one local commit per part and no pushes without asking.
6. One work package at a time, in the order below. Each ends with: `npx tsc --noEmit -p frontend; npx tsc --noEmit -p backend`, `npm run lint --workspace=frontend`, the new tests, and the affected existing suites. Run browser specs in the foreground in batches of about eight.
7. New backend route areas must be added to `operationAreas` in `backend/src/middleware/auth.ts` so platform-admin preview stays read-only and inactive stores stay read-only.
8. Frontend: use the shared components and wording rules in `CLAUDE.md` (plain store language, Title Case tabs, `formatCurrency`, `formatDate`, no `window.confirm`). New pages register in `frontend/src/lib/navigation.ts` (sidebar and quick-find) and `frontend/src/App.tsx`.
9. Pure logic shared by register and server lives in `backend/src/utils/` and is re-exported from `frontend/src/lib/` (pattern: `frontend/src/lib/money.ts`, `lib/promotionEngine.ts`).
10. Frontend unit tests are `frontend/tests/*.test.cjs` and must be added to the explicit file list in the `test:unit` script of `frontend/package.json`.
11. Before touching any AI call, load the `claude-api` skill to confirm current model ids and parameters.

## Reuse map (do not rebuild these)

| Need | Use |
|---|---|
| Money rounding | `backend/src/utils/moneyNumbers.ts` (`roundMoney`, `lineMoney`, `taxMoney`) |
| Sales and profit figures | `getFinancialMetrics`, `getFinancialBreakdowns`, `getProductFinancialMetrics` in `backend/src/services/financialMetrics.service.ts` |
| Store-local dates | `getReportCalendar`, `reportCalendar` in `services/reportDates.service.ts` |
| Stock movement and cost | `moveInventory`, `lockInventory` (`services/inventory.service.ts`); `postInventoryValue` (`services/inventoryCost.service.ts`) |
| Receiving and landed cost | `receiveOrder` (`services/purchaseReceiving.service.ts`), `allocateReceiptCosts`, `receiveStock` (`services/receiptCost.service.ts`) |
| Reviewed imports (preview then apply) | `previewInventoryImport`, `applyInventoryImport` (`services/inventoryImport.service.ts`) |
| Target-margin pricing | `pickRule`, `suggestPrice`, `priceReview`, `storeRules` (`services/pricing.service.ts`) |
| Related-item ranking | `rankRelatedProducts`, `relatedProducts` (`services/inventoryException.service.ts`) |
| Wrong-product corrections | `reclassStock`, `correctSaleLine` (`services/stockCorrection.service.ts`) |
| Barcode and SKU collisions | `assertSellingIdentifiersAvailable`, `resolveSellableProducts`, `projectSellingUnit` (`services/productSellingUnit.service.ts`) |
| Store scoping | `getLocationFilter`, `resolveWriteLocation`, `assertOwnsRecord` (`utils/locationFilter.util.ts`) |
| Idempotent operations | `OperationReceipt` model and `services/operationReceipt.service.ts` |
| Queued email | `enqueueDigestEmails` (`services/emailDelivery.service.ts`), `queueEmail` (`services/queuedEmail.service.ts`) |
| Background jobs | `enqueueJob` (`services/jobQueue.service.ts`) |
| Manager approval | `requireTransactionApproval` (`services/managerApproval.service.ts`), 428 flow in `frontend/src/services/api.ts` |
| Cached reads | `useScopedQuery` (`frontend/src/hooks/useScopedQuery.ts`); live badges via `subscribeScopedQueryInvalidation` |
| Page chrome | `ManagementPage`, `DataPanel`, `SummaryStrip`, `FormSection` (`components/common/Workspace.tsx`), `PageHeader`, `PageTabs`, `WorkflowNavigation`, `EmptyState` |
| Labels | `components/inventory/BarcodeLabelPrint.tsx` |
| Logout cleanup | `clearSessionState` (`frontend/src/services/session.ts`) |
| Durable payments | `savePaymentSession`, `currentPaymentSession` (`frontend/src/services/paymentSession.ts`), `terminalCheckouts` table and `components/pos/TerminalRecovery.tsx` |

## Work package overview

Size: S = up to two days, M = up to a week and a half, L = two to four weeks.

| WP | Title | Impact | Size | Depends on |
|---|---|---|---|---|
| 0.1–0.3 | Save plan, back up branch, production upgrade | Critical | S | Owner's go-ahead |
| 1.1 | Local-first catalog and scanning | Critical | M | — |
| 1.2 | One request to start checkout | High | S | — |
| 1.3 | Installable app that starts offline | High | M | 1.1 |
| 1.4 | Rate limits per user, correct client IP | High | S | — |
| 1.5 | Blind drawer close | Medium | S | — |
| 1.6 | Customers unique per store | Medium | S | — |
| 1.7 | AI model setting; remove unused analytics API | Low | S | — |
| 2.1 | Profit with the estimated part shown | High | M | — |
| 2.2 | Stock losses by cause | Medium | M | — |
| 2.3 | Attention list and morning brief | High | M | 2.1, 2.2 |
| 3.1 | Organizations and store access (data) | High | M | — |
| 3.2 | Active-store sessions and store switching | High | L | 3.1 |
| 3.3 | My Stores overview, access management | High | M | 3.2, 2.3 |
| 4.1 | Receive a delivery by scanning (phone) | High | M | 1.1 |
| 4.2 | Cost-change check at receiving; supplier credits | High | M | 4.1 |
| 4.3 | Labels to print after price changes | Medium | S | — |
| 4.4 | Suggested spot counts; stock accuracy | Medium | M | — |
| 4.5 | One reorder engine with delivery days | Medium | M | — |
| 4.6 | Mis-scan suggestions that learn | Medium | S | — |
| 4.7 | Missed-sales estimate | Medium | M | 2.3 |
| 5.1 | Shared catalog: data and linking | High | L | 3.2 |
| 5.2 | Shared catalog: edit, price, add to store | High | L | 5.1 |
| 5.3 | Store-side guards, catalog screen, transfers | High | M | 5.2 |
| 6.1 | Silent receipt printing and drawer kick | High | M | — |
| 6.2 | Card terminal layer and simulator | Medium | M | — |
| 6.3 | Quiet register self-checks | Medium | S | — |
| 6.4 | Store quick keys | Medium | S | — |
| 6.5 | Handover notes and tasks | Medium | M | — |

Phase 6 packages have no dependencies and can be pulled forward whenever the owner has the hardware to test them.

---

## Phase 0: Protect the work (needs the owner)

- **0.1** Done: this plan is saved as `docs/UPGRADE_PLAN.md` and noted in project memory.
- **0.2** With the owner, review `git status` (many root documents such as `ROADMAP.md`, and about 20 files under `docs/`, show as deleted while `docs/testing.md` is untracked; confirm that is intended), commit the working tree on `wip/oct-2026-checkpoint`, and push the branch to `origin` as a backup. Do not merge to `main`.
- **0.3** Production upgrade is the owner's decision and follows `DATABASE_MIGRATIONS.md` ("Upgrading the Render installation") exactly. Not a coding task. Nothing in this plan may deploy before it.

---

## Phase 1: Register speed and reliability

### WP 1.1 Local-first catalog and scanning

**Why.** Scans depend on the network, and the catalog is re-downloaded every 30 seconds.

**Backend**
- `backend/src/utils/barcode.ts` (new, pure): `barcodeVariants(code)` returns the code plus its UPC-A/EAN-13/GTIN-14 zero-padded forms when it is 8–14 digits; otherwise just the code. Mirror the idea in `matchesBarcode` (`services/productCatalog.service.ts:65`). Re-export from `frontend/src/lib/barcode.ts`.
- `getProducts` (`controllers/product.controller.ts:33`): accept `updatedSince` (ISO date). When present: add `AND: [{ OR: [{ updatedAt: { gte } }, { sellingUnits: { some: { updatedAt: { gte } } } }] }]` (do not overwrite the search `OR`), ignore the `isActive` filter so deactivated rows are returned, and add `serverTime` (ISO) and `activeTotal` (count of active products and active packs for the store) to the response.
- New `GET /api/products/resolve-barcode?code=` in `routes/product.routes.ts` (place above `/:id`). Looks up, within `req.user.locationId`, in order: `Product.barcode in variants`, `ProductSellingUnit.barcode in variants`, and for manager roles `ProductSupplier.packBarcode in variants`. Returns `{ matches: [{ kind: 'PRODUCT' | 'PACK' | 'SUPPLIER_CASE', product, supplierCase?: { supplierId, supplierName, packSize, packCost } }] }` using `packagingSummary` / `projectSellingUnit` for the product shape.

**Frontend**
- `services/offlineDb.ts`: add `saleBlockedReason`, `stockVersion`, `updatedAt` to `OfflineProduct` and its mapping; add `applyProductDelta(rows, scope, isCurrent)` (bulkPut active rows, bulkDelete inactive ids, store `syncedThrough` in the `products_cache_scope` setting).
- `services/syncService.ts`: `cacheProducts()` does a full download only when there is no cache, the scope differs, the cache is older than 12 hours, or the local active count differs from `activeTotal`. Otherwise it requests `updatedSince = syncedThrough − 5 s`. Customers refresh at most once every 15 minutes. Remove the unconditional `cacheAllData()` from each `syncAll`.
- New `services/registerCatalog.ts`: builds an in-memory `Map<variant, OfflineProduct[]>` from Dexie after each sync and on load; `lookupBarcode(code)` returns `{ kind: 'one' | 'many' | 'none' | 'unavailable' }`; `toRegisterProduct(offline)` maps to the `Product` type (replace the `as any` mapping in `POS.tsx` `loadProducts`).
- `pages/POS.tsx` `handleBarcodeScan`: resolve locally first. `one` adds the item with no request. `many` shows the existing "tap the one you are selling" message. `none` or `unavailable` while online falls back to `resolve-barcode` and puts hits into the cache; while offline it shows the existing not-found message with "Sell as misc item". The price-embedded branch looks up the item code locally. The receipt-reference branch is unchanged.
- The server quote at checkout already re-prices, so a stale cached price cannot be charged.

**Tests**
- `frontend/tests/barcode.test.cjs`: variant table (UPC-A vs EAN-13, non-numeric codes).
- Backend integration `registerCatalog.workflow.test.ts`: `updatedSince` returns changed products and packs, includes deactivated rows, `activeTotal` is right; `resolve-barcode` finds product, pack, supplier case (manager only), other stores never.
- Browser `local-scan.spec.ts`: after login wait for the cache, block `**/api/products**` with `page.route`, type a barcode with `page.keyboard.type(code, { delay: 5 })` + Enter (pattern in `checkout-keyboard.spec.ts`), expect the item in the cart. Second case: `context.setOffline(true)` and scan.

**Done when** a scan of a cached item makes no network request, the register makes one small catalog request per sync cycle, and offline scans add items.

### WP 1.2 One request to start checkout

**Backend.** `quoteSale` (`controllers/sale.controller.ts:904`): add to the existing `Promise.all` a lookup of the caller's open shift (`userId`, `locationId`, `isClosed: false`, select `id`). Add to the response `shiftId` (or null) and `storeSettings` (`publicStoreSettings(location.settings)` plus name, address, city, state, phone, timezone).

**Frontend.** In `store/storeSettingsStore.ts` export the function that maps a location payload into the store (currently inside `fetchSettings`) as `applyLocationSettings(data)`. In `POS.tsx` `startCheckout` remove the `fetchSettings` and `shiftService.getCurrent` calls: call `saleService.quote` only, apply settings from the response, set `checkoutShiftId` from `shiftId`, and show "Clock in before taking payment." when it is null.

**Tests.** Extend the quote integration test for `shiftId` and `storeSettings`. Browser: in `checkout-quote.spec.ts` count requests between pressing Charge and the Payment dialog; expect exactly one.

### WP 1.3 Installable app that starts offline

- Add dev dependency `vite-plugin-pwa` (check its peer range supports Vite 7 before installing: `npm view vite-plugin-pwa peerDependencies`). Configure in `frontend/vite.config.ts`: `registerType: 'prompt'`, precache the built shell, `navigateFallback: '/index.html'`, `navigateFallbackDenylist: [/^\/api\//]`, no runtime caching for `/api`.
- Manifest: name "POS System", `display: 'standalone'`, `start_url: '/'`, 192 and 512 pixel icons plus a maskable one in new `frontend/public/`. Add `<link rel="manifest">` and theme colour to `index.html`.
- Update policy: never reload during a sale. New `components/common/AppUpdateNotice.tsx` shows "An update is ready" and applies it only when the cart is empty and no payment session is open (read `useCartStore` and `currentPaymentSession`).
- Confirm startup makes no blocking network call: `authStore` is persisted and `api.ts` only refreshes on a 401. If any startup path signs the user out on a network error, change it to keep the session and show the offline indicator.
- `frontend/vercel.json`: add a `headers` rule setting `Cache-Control: no-cache` for `/sw.js` and the manifest.

**Tests.** A node test that runs after `npm run build --workspace=frontend` and asserts `dist/sw.js` and the manifest exist and that the precache list includes `index.html`. Manual check (record the result): `npm run build`, `npm run preview`, load once, sign in, stop the API and go offline, reload: the register opens, cached items scan, a cash sale queues.

### WP 1.4 Rate limits per user, correct client IP

In `backend/src/server.ts`:
- `app.set('trust proxy', process.env.TRUST_PROXY ?? (production ? 1 : false))` before the limiters. Document `TRUST_PROXY` in `SETUP.md` and `backend/render.yaml`.
- `generalLimiter`: `keyGenerator` returns `'u:' + userId` when the bearer token verifies (`verifyToken` from `utils/jwt.ts`, no database read), otherwise the IP. Login, PIN, password-reset and financial limiters stay IP-based, which is correct once the proxy is trusted.
- After the next production deploy, check the Render log for `express-rate-limit` validation warnings (`ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`, `ERR_ERL_PERMISSIVE_TRUST_PROXY`) and adjust `TRUST_PROXY`.

**Tests.** Unit test with supertest and `NODE_ENV` not `test` for the key generator: two users behind one IP have separate budgets (export the key function to test it directly).

### WP 1.5 Blind drawer close

- Setting: add `cashControl: z.object({ blindClose: z.boolean() }).strict()` to `updateStoreSettingsSchema` and `publicStoreSettings` (`validators/storeSettings.validator.ts`), saved by `updateMyStoreSettings` (owner only, like payment settings). Default when absent: `true`.
- `getCurrentShift` (`controllers/shift.controller.ts:192`): when the caller's role is CASHIER and blind close is on, omit `expectedDrawer`, `expectedCash`, `calculatedExpected`, `cashSales`, `cashRefunds`, `cashVoids`, `cashMovementNet`, `cashGiftFunding`, `cashHousePayments`, `totalCashSales`, `drawerEntries`, and add `blindClose: true`. `clockOut` is unchanged: its summary reveals expected and difference after the count.
- `pages/Shifts.tsx`: when `currentShift.blindClose`, hide the "Expected in Drawer" tile, the expected box and breakdown in the clock-out dialog, and the live difference banner. Keep "Counted cash" and `DrawerCountHelper`.
- `pages/Settings.tsx` (Taxes & payments): a checkbox "Cashiers count the drawer before seeing the expected amount".

**Tests.** Integration: cashier response lacks the fields with the setting on, has them with it off; manager always has them. Update `drawer-reconciliation.spec.ts`.

### WP 1.6 Customers unique per store

- Schema: remove `@unique` from `Customer.email` and `Customer.phone`; add `@@unique([email, locationId])` and `@@unique([phone, locationId])`.
- Migration: drop `customers_email_key` and `customers_phone_key`; create `customers_email_locationId_key` and `customers_phone_locationId_key`. Existing data already satisfies the looser rule.
- Code: replace every `customer.findUnique({ where: { email } })` / `{ phone }` with `findFirst` scoped by `locationId` (start in `controllers/customer.controller.ts`, then grep the backend, seeds and test fixtures).

**Tests.** Integration: the same phone and email can exist at two stores; a duplicate inside one store is refused with the existing message.

### WP 1.7 AI model setting; remove unused analytics API

- New `backend/src/config/ai.ts` exporting `AI_MODEL = process.env.AI_MODEL || <current id>`. Replace the hard-coded id in `controllers/aiChat.controller.ts`, `controllers/product.controller.ts`, `controllers/productIdentify.controller.ts`, `services/assistant.service.ts`, `services/dailyDigest.service.ts`. No behaviour change.
- Optional cleanup: the frontend calls only `analyticsService.getCustomerInsights`. Remove the other methods from `frontend/src/services/api.ts`, their routes and handlers in `routes/analytics.routes.ts` / `controllers/analytics.controller.ts`, and tests that exist only for them. Keep `salesAnomalies` in `services/inventoryAnalytics.service.ts` (WP 2.3 uses it) and anything `services/analyticsTools.service.ts` imports. Skip this bullet if any removal is not clearly safe.

**Phase 1 checkpoint.** Full backend suite in batches, register browser specs, then ask the owner about committing and about applying the WP 1.6 migration to the store database.

---

## Phase 2: Honest numbers and the owner brief

### WP 2.1 Profit with the estimated part shown

**Rule change.** Missing costs still make profit unavailable. Open stock exceptions no longer do: profit is shown and labelled as including estimates.

**Backend** (`services/financialMetrics.service.ts`)
- In the SQL of `getFinancialMetrics`, add `pendingEstimatedCost`: the sum of line cost for `costStatus = 'ESTIMATED'` lines joined to an unresolved exception (same join as `pendingStockProblems`).
- In `summarizeFinancialMetrics`: compute `costOfGoodsSold`, `grossProfit`, `operatingProfit`, `netProfit` and margins whenever `costIncomplete` is zero, even with `pendingStockProblems > 0`. New `costBasis` value `'PROVISIONAL'` when pending. `costCompleteness` gains `pendingEstimatedCost`; `complete` stays false while pending; label "Includes estimated costs awaiting review". `unavailableReason` is null in this case; add `provisionalReason`: "Includes $X of estimated cost for N stock exceptions. Resolve them in Stock Control to confirm."
- `getProductFinancialMetrics`: for pending rows return profit and margin with `costBasis: 'PROVISIONAL'` instead of null.
- Consumers to review: `controllers/financial.controller.ts`, `controllers/location.controller.ts`, `services/adminDashboard.service.ts`, `services/overallReport.service.ts`, `services/profitAndLossWorkbook.service.ts`, `services/salesForecast.service.ts`, `controllers/analytics.controller.ts`.

**Frontend**
- `components/financial/ProfitAndLossStatement.tsx`, `pages/Reports.tsx`, `pages/admin/AdminDashboard.tsx`, `pages/PriceReview.tsx`: when `costBasis === 'PROVISIONAL'` show the figure with a status line built from `provisionalReason` and a link to `/inventory/stock-control/exceptions`.
- `services/profitAndLossExport.ts`, `services/profitAndLossWorkbook.ts` and the backend workbook: add a note row "Not final: includes estimated costs awaiting review" when provisional.

**Tests.** Update the assertions in `retailInventory.acceptance.test.ts`, `connectedPacks.acceptance.test.ts`, `financialMetrics.workflow.test.ts` and `estimated-pnl.spec.ts`: profit is a number, basis is `PROVISIONAL`, the estimated amount matches, and resolving the exception flips the basis. Missing-cost cases still return null.

**Docs.** Rewrite the "Sales are booked facts" bullet in `CLAUDE.md` to the new rule.

### WP 2.2 Stock losses by cause

- Schema: `InventoryValueEntry.reason String?` (new rows only; the table is append-only so history is not backfilled).
- `services/inventory.service.ts`: `Movement` gains optional `reason`; pass it into `postInventoryValue` (`services/inventoryCost.service.ts`), which stores it. Callers set it: `adjustInventory` and `bulkUpdateStock` (`controllers/inventoryAdjustment.controller.ts`, the chosen reason), exception `recordCount` (the resolution), `reclassStock` and `correctSaleLine` (`WRONG_SKU_SOLD` and siblings), cycle-count approval (`COUNT_DIFFERENCE`), transfer loss (`TRANSFER_DAMAGED_OR_MISSING`), supplier return (`SUPPLIER_RETURN`).
- New `services/stockLossReport.service.ts`: for a store and date range, group entries with negative `valueChange` and a loss kind into: Damaged, Expired, Waste, Theft, Lost, Count shortfall, Transfer loss, Other, and "Reason not recorded" (older rows). Separately report paper corrections that are not losses: wrong product rung up, deliveries entered late, items sold without scanning. Amounts are cost value; missing values stay "Unavailable".
- Route `GET /api/inventory-costs/losses?startDate&endDate` in `routes/inventoryCost.routes.ts`.
- UI: a "Losses" sub-tab in `components/financial/InventoryCostPanel.tsx` (Finances > Inventory Costs) with a `SummaryStrip` (real loss, paper corrections) and a table by cause, behind an "About these numbers" note.

**Tests.** Integration `stockLosses.workflow.test.ts`: one adjustment per reason lands in the right bucket; a wrong-product correction appears under corrections, not loss; other stores excluded.

### WP 2.3 Attention list and morning brief

**Backend**
- New `services/attention.service.ts`: `collectAttention(locationId, now)` returns `{ asOf, items: Finding[] }` where `Finding = { key, kind, severity: 'high' | 'medium' | 'low', sentence, amount?: number, count?: number, href }`. Each rule is a small exported function so later packages can add rules. All numbers are computed here; nothing is generated by AI.

| Rule | Source | Fires when | Link |
|---|---|---|---|
| Stock exceptions | `inventoryException` open or recount requested | count > 0; mention the oldest | `/inventory/stock-control/exceptions` |
| Profit not confirmed | `getFinancialMetrics` for yesterday | `costBasis === 'PROVISIONAL'` | same |
| Drawer difference | `Shift` closed in the last 24 h | `abs(cashDifference) >= 5` | `/team-time/shifts` |
| Prices below target | `priceReview()` | any BELOW_COST or BELOW_MINIMUM rows | `/inventory/purchasing/price-review` |
| Deliveries not matched to an invoice | `listUnmatched(open)` (`services/stockCorrection.service.ts`) | any | exceptions page |
| Bills due | `Expense` with `dueDate` within 7 days and status PENDING or APPROVED | any | `/financial?tab=expenses` |
| Orders overdue | `PurchaseOrder` ORDERED or PARTIALLY_RECEIVED with `expectedAt` in the past | any | `/inventory/purchasing/orders` |
| Refunds or voids unusually high | yesterday's count vs the 28-day daily average | count ≥ 3 and more than twice the average | `/insights/reports/sales` |
| Unusual sales day | `salesAnomalies` for yesterday | flagged | reports overview |
| Email or export failures | `BackgroundJob` FAILED or REVIEW | any | `/settings/jobs` |

- Route `GET /api/reports/attention` (ADMIN, MANAGER) in `routes/report.routes.ts`.
- Rename `services/dailyDigest.service.ts` to `ownerBrief.service.ts`. The brief covers the previous complete store day (`calendar.day(-1)` to `calendar.day()`), compares with the same weekday a week earlier, and includes the attention items (high first, at most seven). Send hour defaults to 07:00 store-local (`OWNER_BRIEF_HOUR`; keep reading `DAILY_DIGEST_HOUR` as a fallback). Send only when the store's `notificationSettings.endOfDayReports` is not false. Keep the database idempotency key (`brief:<locationId>:<store date>`); do not rely on the in-memory `lastSentDate`.
- Narrative: AI writes three to five sentences from the computed JSON; the template fallback stays. Add a guard: extract every number from the AI text and require each to appear in the data (formatted or raw); on any mismatch use the template.
- Keep `POST /api/reports/daily-digest/send` working as "Send brief now".

**Frontend**
- New `components/common/AttentionList.tsx` (one row per finding: sentence, amount, action link). Show it at the top of `pages/Dashboard.tsx` for ADMIN and MANAGER via `useScopedQuery(['attention'])`. Empty state: "Nothing needs attention right now."
- Replace the second `SummaryStrip` count tiles for owners (Customers, Products) with money tiles when data is available: profit yesterday (with basis), bills due this week, supplier credits owed (after WP 4.2). Keep the existing tiles for cashiers.
- Settings label: rename "End of day reports" to "Morning brief email".

**Tests.** Integration `attention.workflow.test.ts`: seed each condition and assert one finding with the right amount and link; nothing fires on a clean store. Unit: the numeric guard rejects an invented number. Update `digest-delivery.spec.ts` and add a dashboard browser check.

**Phase 2 checkpoint.** As Phase 1; migrations: WP 2.2.

---

## Phase 3: Multi-store owners

Design in one sentence: a user keeps a home store, may be granted other stores, and each sign-in session has one **active store**; the server sets `req.user.locationId` and `req.user.role` from the active store, so existing store scoping keeps working unchanged.

### WP 3.1 Organizations and store access (data)

**Schema** (`schema.prisma`)

```prisma
model Organization {
  id        String   @id @default(uuid())
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  locations Location[]
  owners    OrganizationOwner[]
  @@map("organizations")
}
model OrganizationOwner {
  id             String   @id @default(uuid())
  organizationId String
  userId         String
  createdById    String?
  createdAt      DateTime @default(now())
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user           User @relation("OrganizationOwnerships", fields: [userId], references: [id], onDelete: Cascade)
  @@unique([organizationId, userId])
  @@index([userId])
  @@map("organization_owners")
}
model UserStoreAccess {
  id          String   @id @default(uuid())
  userId      String
  locationId  String
  role        UserRole
  createdById String?
  createdAt   DateTime @default(now())
  user        User     @relation("StoreAccess", fields: [userId], references: [id], onDelete: Cascade)
  location    Location @relation(fields: [locationId], references: [id], onDelete: Cascade)
  @@unique([userId, locationId])
  @@index([locationId])
  @@map("user_store_access")
}
// Location:      organizationId String?  + relation (onDelete: Restrict)
// RefreshToken:  activeLocationId String?
```

**Migration** (additive, plus backfill and two triggers)
- Backfill: one organization per existing location (same name); set `locations.organizationId`.
- Backfill `user_store_access` from every user with a store and a role other than SUPER_ADMIN.
- Backfill `organization_owners`: every active ADMIN of a store owns that store's organization.
- Trigger `locations_default_organization` (BEFORE INSERT): when `organizationId` is null, create an organization named after the store and assign it. This keeps every seed and test that creates a location working without edits. The column stays nullable in Prisma; code reads it through a helper that throws if null.
- Trigger `users_sync_home_access` (AFTER INSERT OR UPDATE OF `locationId`, `role` ON users): upsert the access row for the home store with the home role; when the home store changes, delete the old home row.

**Backend**
- New `services/organization.service.ts`: `organizationIdOf(locationId)`, `isOwner(userId, organizationId)`, `syncOwnerAccess(tx, organizationId)` (every owner gets ADMIN access to every store in the organization; call after adding an owner or a store).
- `controllers/location.controller.ts` `createLocation`: accept an optional `organizationId` (platform admin); call `syncOwnerAccess`.

**Tests.** Integration `organizations.workflow.test.ts`: triggers create the organization and home access; changing a user's home store moves the access row; `syncOwnerAccess` grants owners the new store.

### WP 3.2 Active-store sessions and store switching

**Backend**
- `middleware/auth.ts` `authenticate`: in the existing user query also select `storeAccess { locationId, role, location { isActive } }` and the session's `activeLocationId`. If the role is not SUPER_ADMIN and `activeLocationId` is set and differs from the home store: find the access row; if missing, throw `new AppError('Your access to this store ended. Switch stores to continue.', 403, { code: 'STORE_ACCESS_ENDED' })`; otherwise use that store and that row's role as the effective store and role. Everything after this point (restricted areas, read-only checks, wage privacy) uses the effective values. Set `req.user = { id, email, role, locationId, homeLocationId }` (extend `AuthRequest` in `types/index.ts`).
- `controllers/auth.controller.ts`:
  - `GET /api/auth/stores`: the caller's stores `[{ locationId, name, role, isActive, isHome, isCurrent }]`.
  - `POST /api/auth/switch-store { locationId }`: require an access row; refuse with 409 "Clock out before switching stores." when the caller has an open shift at the current store; set `refreshToken.activeLocationId` for `req.sessionId`; write an `ActivityLog` `STORE_SWITCHED`; return the same user payload as sign-in.
  - Sign-in and `/auth/me` responses return the effective `role`, `locationId`, `location`, plus `homeLocationId`, `stores` and `organization: { id, name, storeCount, isOwner }`.
  - `refreshAccessToken`: if it creates a new session row, copy `activeLocationId`.
- `controllers/registerPin.controller.ts`: a PIN works on a register when the user has access to the register's store (access row), not only when it is the home store (`:164`, `:177`). Start that session with `activeLocationId` set to the register's store.
- Sweep for code that reads the acting user's store from the user row instead of `req.user.locationId`. Known: `controllers/shift.controller.ts:29` (payroll frequency and timezone must come from the active store's location), activity-log writes in `auth.controller.ts`. Grep `findUnique({ where: { id: req.user`, `employee.location`, `.user.locationId`.
- `controllers/inventoryTransfer.controller.ts`: stores are connected when they share an organization or have a `StoreConnection`.

**Frontend**
- `store/authStore.ts`: `stores`, `organization`, `switchStore(locationId)`. `switchStore` refuses while the cart has items, a payment session is open, or unsynced offline sales exist for the current store; otherwise it calls the API, runs the store-scoped parts of `clearSessionState` (cart, settings, offline caches; keep the sign-in), bumps `changeStoreContextGeneration()`, sets the new `user`, and re-runs `syncService.cacheAllData()`.
- `services/api.ts`: on 403 with `details.code === 'STORE_ACCESS_ENDED'`, reload the store list and switch to the home store with a notice.
- `components/common/StoreSwitcher.tsx`: add a second mode for store users with more than one store (list from `authStore.stores`, calls `switchStore`). Mount it in `components/Layout.tsx` where the platform switcher is mounted, and in `components/pos/POSTopBar.tsx` as a read-only store name.

**Tests**
- Integration `multiStoreAccess.workflow.test.ts`: default active store is home; after switching, products, sales and reports are the other store's; writes land in the active store; effective role follows the access row (ADMIN at home, MANAGER elsewhere cannot do owner actions there); removing access returns 403 with the code; an open shift blocks switching; PIN sign-in on the second store's register works and is scoped to it; session refresh keeps the active store.
- Browser `store-switching.spec.ts`: owner with two seeded stores switches, the dashboard and product list change, a non-empty cart blocks the switch. Add the second-store access to `backend/scripts/e2e-seed.cjs`.

### WP 3.3 My Stores overview and access management

**Backend**
- New `routes/organization.routes.ts` (area `organization`; add to `routes/index.ts` and `operationAreas`).
  - `GET /api/organization/overview`: for each store where the caller has ADMIN access, in one RepeatableRead transaction: today's sales and transactions with trend (`getFinancialMetrics`, store timezone via `reportCalendar`), yesterday's profit and basis, open exception count, attention count, last closed shift difference.
  - `GET /api/organization/access`, `POST /api/organization/access { email, locationId, role }`, `DELETE /api/organization/access/:id`: owners only; the store must be in an organization they own; role limited to MANAGER or CASHIER; the user must already exist in the organization. Granting ADMIN and adding owners stays a platform-admin action (preserves the July privilege-escalation fix).
  - Platform admin: `GET/POST /api/organizations`, `PUT /api/locations/:id` accepts `organizationId`, `POST/DELETE /api/organizations/:id/owners`; each calls `syncOwnerAccess`.
- `ownerBrief.service.ts`: recipients are the store's ADMINs plus the organization's owners. An owner of several stores gets one email with a section per store.

**Frontend**
- New `pages/MyStores.tsx` at `/stores` (ADMIN; shown in the sidebar only when `organization.storeCount > 1`): one card per store with the figures above and "Open store" (calls `switchStore`).
- `pages/Team.tsx`: list home staff plus staff with access to the active store (badge "Also works here"); owners get "Give access to another store".
- `pages/admin/StoreManagement.tsx`: organization column, move a store to an organization, manage owners.

**Tests.** Integration: overview returns only the caller's stores and matches each store's own dashboard numbers; access grants respect organization and role limits; cross-organization attempts are refused. Browser: My Stores opens a store.

**Phase 3 checkpoint.** Migrations: WP 3.1. Run the whole backend suite: this phase touches authentication.

---

## Phase 4: Receiving, counts and purchasing

### WP 4.1 Receive a delivery by scanning

**Why.** Deliveries are entered late or not at all; the invoice-photo flow needs a desk.

- New page `pages/ReceiveDelivery.tsx` at `/inventory/purchasing/receive` (add to `purchasingViews` in `App.tsx` and to `lib/navigation.ts`), laid out for a phone first.
  1. Choose supplier (`components/common/SupplierPicker.tsx`); optionally pick an open order for that supplier to prefill lines.
  2. Scan loop. New `components/common/CameraScanner.tsx` uses the browser `BarcodeDetector` with the rear camera when available; otherwise a text field. USB scanners already work through `hardware.scanner.onScan`. Each code goes to `GET /api/products/resolve-barcode` (WP 1.1). A product, pack or supplier-case match adds a line with pack size and last cost prefilled; the user enters cases or units. Unknown codes offer a short "new item" form (name, price, cost; SKU defaults to the barcode).
  3. Optional invoice number, date, freight, tax, discount.
  4. Review and save through the existing reviewed import: `POST /api/products/imports/receipt/preview` then `POST /api/products/imports/:id/apply` (see `hooks/useInventoryImport.ts`, `components/inventory/ImportReview.tsx`). No new write path.
- Count at the cheap moment: when a scanned item's recorded stock is at or below its low-stock level and it has no open exception, show an optional "How many are on the shelf right now, before this delivery?" field. Answers are posted before the receipt through `POST /api/products/:id/adjust-inventory` with reason `MANUAL_COUNT`, the product's `stockVersion`, and an idempotency key. Items with an open exception show a link to it instead.

**Tests.** Browser `receive-delivery.spec.ts`: scan a pack barcode and a supplier-case barcode, enter quantities, save; stock and unit cost are right; a shelf count posts first. Integration coverage comes from WP 1.1 and the existing import tests.

### WP 4.2 Cost-change check at receiving; supplier credits

**Schema**
- `PurchaseReceiptItem.previousUnitCost Decimal? @db.Decimal(24, 8)`.
- New model `SupplierCredit { id, locationId, supplierId, receiptId?, reason String /* DAMAGED | REJECTED | SHORT | PRICE | RETURN | OTHER */, amount Decimal(14,2), status String @default("OPEN") /* OPEN | RECEIVED | WRITTEN_OFF */, notes?, createdById, createdAt, settledAt?, settledById? }` with `@@index([locationId, status])`.

**Backend**
- `receiveOrder` (`services/purchaseReceiving.service.ts`): read each product's current `cost` before `receiveStock` overwrites it and store it as `previousUnitCost`. New optional body flag `supplierBilledForProblems` (default true when an invoice number is present): when damaged or rejected quantities exist, create an OPEN `SupplierCredit` for `(damaged + rejected) × unit cost`.
- `supplierReturn` (`services/inventoryCostReview.service.ts`): also create an OPEN credit with reason RETURN.
- `previewInventoryImport` (kind RECEIPT): add `costReview` per matched row: previous unit cost, new unit cost, percent change, margin at the current price, and the suggested price from `pickRule` + `suggestPrice`. Flag rows whose cost rose by 3% or more (store setting `purchasing.costChangeAlertPercent`, default 3).
- New routes in `routes/supplier.routes.ts`: `GET /api/suppliers/credits`, `POST /api/suppliers/credits` (manual), `POST /api/suppliers/credits/:id/settle { status, notes }`.
- Extend `getSupplierPerformance` with a cost-change history (last 10 changes) and fill rate (accepted ÷ ordered).
- Attention rules (add to `attention.service.ts`): "Supplier credits outstanding" (total, and amount older than 30 days); "Costs went up" (receipts in the last 7 days with flagged changes).

**Frontend**
- `components/inventory/ImportReview.tsx`: a "Cost changes" block above the rows ("$7.10 → $7.45, margin 18%, target 22%, suggested $9.59") with a link to Price Review.
- `pages/Suppliers.tsx`: a "Credits Owed" tab (list, mark received or written off, add manually).
- Receipt dialogs: checkbox "The invoice charged for the damaged or rejected items".

**Tests.** Integration `supplierCredits.workflow.test.ts` and additions to the import tests: previous cost stored, flagged change returned, credit created and settled, other stores excluded.

### WP 4.3 Labels to print after price changes

- Schema: `Product.priceChangedAt DateTime?`, `Product.labelPrintedAt DateTime?`; the same two on `ProductSellingUnit`.
- Triggers `products_price_changed` and `product_selling_units_price_changed` (BEFORE UPDATE OF price): set `priceChangedAt = now()` when the price differs. A trigger covers every write path (product form, price review, bulk update, shared catalog).
- Routes: `GET /api/products/labels/pending`, `POST /api/products/labels/printed { productIds, sellingUnitIds }` (above `/:id`).
- UI: `pages/Inventory.tsx` header action "Labels to print (N)" opens `BarcodeLabelPrint` with the pending items; confirming the print marks them printed. `pages/PriceReview.tsx`: after applying prices offer "Print labels for these items".
- Attention rule: "N shelf labels are out of date".

**Tests.** Integration: a price change sets the date through each write path; marking printed clears the list.

### WP 4.4 Suggested spot counts; stock accuracy

- `GET /api/cycle-counts/suggested?limit=8` (`controllers/cycleCount.controller.ts`, above `/:id`). Rank active tracked products without an open exception or open count by a documented score:
  - +40 never counted, or +1 per day since the last count log (types `CYCLE_COUNT`, `COUNT`, `MANUAL_COUNT`, `MISCOUNT`, `EXCEPTION_COUNT`), capped at 40;
  - +0 to 30 by inventory value rank within the store;
  - +0 to 20 by 30-day units sold rank;
  - +15 if a manual adjustment was posted in the last 14 days;
  - +10 if recorded stock is between 0 and its low-stock level (few units to count).
  Return the reasons with each item. Put the scoring in a pure function for unit tests.
- `GET /api/cycle-counts/accuracy`: of items counted in the last 30 days (approved counts), the share whose counted quantity equalled the expected quantity.
- UI `pages/CycleCount.tsx`: "Start Suggested Count" creates a PARTIAL count from the suggestions (existing `POST /api/cycle-counts`); show "Stock accuracy NN% (last 30 days)" in the page summary. Check the count entry screen at phone width and fix overflow.

**Tests.** Unit for scoring; integration for the endpoint (excludes exception items, other stores) and accuracy.

### WP 4.5 One reorder engine with delivery days

- Schema: `Supplier.deliveryDays Int[] @default([])` (0 = Sunday … 6 = Saturday).
- New `services/reorder.service.ts`: move the logic out of `getSuggestedOrders` (`controllers/purchaseOrder.controller.ts:314`) into a pure `planReorder(input)` plus a loader; the controller becomes a thin wrapper with the same response shape, adding `nextDelivery`, `followingDelivery` and `basis` per supplier.
- Rule when a supplier has delivery days: an order placed today arrives on the first delivery day at least `leadTime` days away (D1) and must last until the delivery after that (D2). Needed units = velocity × days until D2 + two days of safety − (stock + on order), rounded to cases as today. An item is urgent when stock ÷ velocity is less than the days until D1. Without delivery days keep the current 14-day and 7-day constants.
- `GET /api/suppliers/:id/delivery-days/suggestion`: weekdays on which the supplier's receipts arrived at least three times in the last eight weeks. Shown in the supplier form as a suggestion; never saved automatically.
- Delete `inventoryPredictions` and its route if nothing else imports it after WP 1.7.
- Attention rule: on the day before a supplier's order must go in, "Coke delivers Tuesday. 14 items will run out before the following delivery." linking to suggestions filtered by supplier.

**Tests.** Unit tests for `planReorder` (with and without delivery days, case rounding, on-order stock). Existing `suggestedOrders.workflow.test.ts` must still pass.

### WP 4.6 Mis-scan suggestions that learn

- `relatedProducts` (`services/inventoryException.service.ts`): load, for the store and the last 180 days, counts of `StockReclass` (reason `SOLD_AS_OTHER`) and `SaleItemCorrection` pairs involving the target product. Pass them to `rankRelatedProducts` as `history: Map<productId, number>`.
- `rankRelatedProducts`: +25 per past confusion (cap +75) with reason "Mixed up before (N times)"; +15 when the candidate has the same price as the target, reason "Same price".
- Attention rule: when an open exception has a candidate with history or the same price, and that candidate has stock on hand: "Blue Razz shows −4 while Grape shows 9 and they were mixed up 3 times before. Count both."
- No automatic correction.

**Tests.** Extend the ranking tests in `retailInventory.acceptance.test.ts`: history and same price move a candidate to the top.

### WP 4.7 Missed-sales estimate

- New `services/missedSales.service.ts`, estimate only, labelled "about":
  - Products with at least 21 days of sales history and an average of one unit a day over the prior 28 days.
  - Out-of-stock interval: from an `InventoryLog` row that takes `newQty` to zero or below until the next row above zero, inside the last seven complete store days.
  - Skip any interval that contains a sale of that product (the record was wrong, not the shelf).
  - Count only selling hours: local hours in which the store had a sale on at least half of the last 28 days.
  - Missed units = selling hours out × (average daily units ÷ average selling hours per day), capped at three average days; value at the current price.
- Attention rule (weekly, in Monday's brief and the dashboard): "Empty shelves cost about $180 last week; Ice was about $70 of it." Fire only at $20 or more; name the top three items.

**Tests.** Integration with fixed dates: a seeded stockout produces the expected estimate; an interval containing a sale is ignored; slow sellers are excluded.

**Phase 4 checkpoint.** Migrations: 4.2, 4.3, 4.5.

---

## Phase 5: Shared catalog

Design in one sentence: each store keeps its own `Product` rows (stock, cost, price and every existing relation), and an owner-managed `CatalogItem` links the same item across stores and owns the shared fields.

### WP 5.1 Shared catalog: data and linking

**Schema**

```prisma
model CatalogItem {
  id             String   @id @default(uuid())
  organizationId String
  name           String
  sku            String
  barcode        String?
  description    String?
  brand          String?
  productFamily  String?
  variant        String?
  size           String?
  baseUnitName   String   @default("unit")
  categoryName   String?
  image          String?
  isTaxable      Boolean  @default(true)
  minimumAge     Int?
  ebtEligible    Boolean  @default(false)
  priceEmbedded  Boolean  @default(false)
  saleBlockedReason String?
  defaultPrice   Decimal? @db.Decimal(14, 4)
  isActive       Boolean  @default(true)
  version        Int      @default(0)
  createdById    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  packs          CatalogPack[]
  products       Product[]
  @@unique([organizationId, sku])
  @@unique([organizationId, barcode])
  @@index([organizationId, name])
  @@map("catalog_items")
}
model CatalogPack {
  id              String  @id @default(uuid())
  catalogItemId   String
  name            String
  sku             String?
  barcode         String
  unitsPerPackage Int
  defaultPrice    Decimal? @db.Decimal(14, 4)
  isActive        Boolean @default(true)
  version         Int     @default(0)
  catalogItem     CatalogItem @relation(fields: [catalogItemId], references: [id], onDelete: Cascade)
  sellingUnits    ProductSellingUnit[]
  @@unique([catalogItemId, barcode])
  @@map("catalog_packs")
}
// Product:            catalogItemId String?  priceFollowsCatalog Boolean @default(false)
//                     @@unique([catalogItemId, locationId])
// ProductSellingUnit: catalogPackId String?  priceFollowsCatalog Boolean @default(false)
```

**Backend**
- New `services/sharedCatalog.service.ts`, `controllers/sharedCatalog.controller.ts`, `routes/catalog.routes.ts` (area `catalog`; add to `routes/index.ts` and `operationAreas`). Middleware `requireOrganizationOwner`: resolves the active store's organization and requires an `OrganizationOwner` row.
- `GET /api/catalog?search&page`: items with one listing per store `{ locationId, storeName, productId, price, priceFollowsCatalog, stockQuantity, isActive }` and the stores that do not carry the item.
- Linking existing products (stateless preview, idempotent apply):
  - `POST /api/catalog/link/preview { primaryLocationId }`: group unlinked products across the organization's stores by normalized barcode (`barcodeVariants`), then by SKU plus lower-cased name. For each group return the proposed shared fields (from the primary store's product), the member products, field differences between stores, and a fingerprint (hash of member ids and `updatedAt`).
  - `POST /api/catalog/link/apply { idempotencyKey, primaryLocationId, groups: [{ fingerprint, productIds, makeStoresMatch }] }`: recompute each group, refuse changed fingerprints with 409, create the `CatalogItem` and `CatalogPack` rows (packs from the primary product's selling units; other stores' packs link by barcode), and set `catalogItemId` / `catalogPackId`. Only when `makeStoresMatch` is true copy the shared fields onto the other stores' products. Record the result in `OperationReceipt` (kind `CATALOG_LINK`) for safe retries.
- `POST /api/catalog/from-product { productId }`: create a catalog item from one store's product and link it.

**Tests.** Integration `sharedCatalog.link.workflow.test.ts`: grouping by barcode variant and by SKU and name; differences reported; apply links products and packs; changed product gives 409; retry with the same key returns the first result; non-owner 403; another organization's products never appear.

### WP 5.2 Shared catalog: edit, price, add to store

- `PUT /api/catalog/:id { expectedVersion, fields }`: lock the catalog row; for every linked product check SKU and barcode availability in that store with `assertSellingIdentifiersAvailable` (excluding the product itself); update the shared fields on each product (name, sku, barcode, description, brand, family, variant, size, base unit name, image, taxable, minimum age, EBT, price-embedded, sale hold); set `categoryId` by finding or creating a category with `categoryName` in that store (case-insensitive); bump `version`; write one `ActivityLog` per store. Any conflict rolls back the whole change and names the store.
- `PUT /api/catalog/:id/price { expectedVersion, defaultPrice, apply: 'FOLLOWING' | 'ALL' | { locationIds } }` and `PUT /api/catalog/packs/:id/price`: update `defaultPrice` and the prices of the selected listings (`ALL` and explicit stores also turn on `priceFollowsCatalog`).
- `POST /api/catalog/:id/publish { locationId, price?, followPrice, lowStockAlert? }`: create the store's `Product` with stock 0, linked, with its packs as `ProductSellingUnit` rows, after identifier checks. If an unlinked product with the same barcode or SKU exists there, answer 409 with `details.existingProductId` so the screen can offer "Link it instead" (`POST /api/catalog/:id/link { productId }`).
- `POST /api/catalog/publish { itemIds, locationId, followPrice }`: bulk version for opening a new store; returns created and skipped items.
- `POST /api/catalog/:id/unlink { productId }`: clear the link; the store's product becomes independent.
- Packs: `POST/PUT /api/catalog/:id/packs` create or edit a catalog pack and propagate to linked stores' selling units the same way.
- Not in this version: variety-pack contents stay per store. A variety pack can be a catalog item, but its component list is not propagated.

**Tests.** Integration `sharedCatalog.workflow.test.ts`: rename propagates to all stores; a barcode conflict in one store rolls everything back; price to followers only; publish creates stock-0 product and packs; publish conflict returns the existing product; bulk publish to an empty store; unlink.

### WP 5.3 Store-side guards, catalog screen, transfers

**Backend guards**
- `updateProduct` (`controllers/product.controller.ts:287`) and `updateSellingUnit` (`controllers/sellingUnit.controller.ts`): when the row is linked, refuse changes to shared fields with 409 "This is managed in the Shared Catalog." Refuse a price change while `priceFollowsCatalog` is true with "This price follows the shared catalog. Turn off Follow shared price to set a store price." Allow toggling `priceFollowsCatalog` (owner or store ADMIN); turning it on sets the price to the catalog default.
- `applyPrices` (`controllers/pricing.controller.ts:97`) and `bulkUpdatePrice`: skip following items and report them; `priceReview` rows include `priceFollowsCatalog`.
- `previewInventoryImport`: for linked products report shared-field changes, and price changes on following items, as row errors.
- `recordTransferReceipt` (`services/transferWorkflow.service.ts`): before the SKU match, if the source product has a `catalogItemId`, use the destination store's product with the same `catalogItemId`; when creating a destination product from a linked source, link the new product too.

**Frontend**
- New `pages/SharedCatalog.tsx` at `/inventory/catalog` (Products section; shown when `organization.isOwner && organization.storeCount > 1`): table of items with a chip per store (price, "follows" badge, "not carried"), actions Edit, Set Price, Add To Store; a "Link Existing Products" wizard (choose primary store, review groups and differences, apply); "Add all to a store" for new stores.
- `pages/Inventory.tsx` product form: for linked products show a notice "Shared item: name, barcode and selling rules are managed in the Shared Catalog", disable those fields, and add "Follow shared price". For unlinked products in a multi-store organization offer owners "Add to Shared Catalog".
- `pages/PriceReview.tsx`: following items show "Shared price"; owners get "Apply to all stores".

**Tests.** Integration: guards refuse shared-field and following-price edits; imports flag them; transfer receipt maps by catalog link and links created products. Browser `shared-catalog.spec.ts`: link two seeded stores, rename an item and see it in the second store, set a shared price, add an item to a store.

**Phase 5 checkpoint.** Migration: WP 5.1. Run the product, pack, import, transfer and pricing suites in full.

---

## Phase 6: Register hardware and workflow

### WP 6.1 Silent receipt printing and drawer kick

- New `frontend/src/services/escpos.ts` (pure): builder for initialise, alignment, bold, double size, line feed, cut, Code 128 barcode, and drawer kick (`ESC p 0 25 250`); `receiptToEscPos(receipt, settings)` producing a `Uint8Array` at 48 columns (80 mm) or 32 (58 mm), using the same content as `generateReceiptHTML`.
- New `frontend/src/services/printerTransport.ts`: interface `{ id, connect(), isConnected(), write(bytes), disconnect() }` with implementations `serial` (Web Serial: `navigator.serial.requestPort`, previously granted ports via `getPorts()`, baud rate setting), `usb` (WebUSB: printer-class device, claim interface, `transferOut`), and a test double.
- `services/hardware.ts`: `HardwareSettings.receiptPrinter` gains `transport: 'browser' | 'serial' | 'usb'`, `baudRate`, `columns`. `ReceiptPrinter.print` writes bytes when a transport is connected and falls back to the browser window otherwise. `openDrawer` sends the kick. `CashDrawer.isConnected()` reflects the transport. `checkStatus` reports it.
- Settings > Devices: "Connect receipt printer" (needs a click, as browsers require), "Print test receipt", "Open drawer", and a note that serial works with printers exposing a COM port and USB only when Windows has not claimed the printer.
- Chromium only (Edge, Chrome). Other browsers keep the print window.

**Tests.** `frontend/tests/escpos.test.cjs`: byte-exact output for a fixed receipt, the kick sequence, column wrapping. Browser spec with the test transport (`window.__posPrinterTransport`): completing a cash sale writes a receipt and a drawer kick with auto-print on. Owner checklist for real hardware in the release notes.

### WP 6.2 Card terminal layer and simulator

- New `frontend/src/services/terminal/types.ts`:
  ```ts
  export type TerminalResult =
    | { status: 'APPROVED'; approvedCents: number; reference: string; brand?: string; last4?: string; entryMode?: string }
    | { status: 'DECLINED'; reason: string }
    | { status: 'CANCELLED' }
    | { status: 'UNKNOWN'; reason: string };   // must be reconciled before another checkout
  export interface TerminalAdapter {
    id: string; label: string;
    status(): Promise<{ connected: boolean; detail?: string }>;
    charge(request: { amountCents: number; reference: string; signal: AbortSignal }): Promise<TerminalResult>;
    cancel(): Promise<void>;
  }
  ```
- Adapters: `manual` (today's typed reference; the default) and `simulator` (approves after about a second; amounts ending in .01 decline, .02 approve half, .03 return UNKNOWN). `terminal/index.ts` picks the adapter from `HardwareSettings.cardReader.adapter`; the simulator is selectable only in development builds or when the test flag is set.
- `components/pos/EnhancedPaymentModal.tsx`: with a non-manual adapter the card tile shows "Send $X to terminal". Before calling `charge`, save an event `{ action: 'TERMINAL_REQUESTED', reference }` through `onSavePayments` so a crash is recoverable. APPROVED adds the card payment with the approved amount and reference through the existing save path (partial approvals leave a balance). DECLINED shows the reason inline. UNKNOWN, or a saved request with no result on reopening, shows "Check the terminal: was $X approved?" with "Yes, enter the reference" and "No, not charged"; reuse the `TerminalRecovery` pattern so no new checkout starts until it is answered.
- Schema: `SalePayment.details Json?` (brand, last four, entry mode, adapter). Accept it in `createSaleSchema` (`validators/sale.validator.ts`) and store it in `createSale`. Print "VISA ending 1234" on receipts when present.

**Tests.** `frontend/tests/terminal.test.cjs` for the simulator and the request/result state logic. Browser `terminal-simulator.spec.ts`: approve, decline, partial, unknown then recovery. Integration: `details` is stored and returned.

### WP 6.3 Quiet register self-checks

- New pure module `backend/src/utils/cartChecks.ts` (re-exported in `frontend/src/lib/cartChecks.ts`): `lineHints(line)` and `tenderHint(total, tendered)`.
  - Quantity 25 or more, or a quantity of 10, 100 or 1,000 on a single (not a pack): "Check quantity", with one-tap "Make it 1" and "Make it N ÷ 10".
  - Hand-changed price under half or over double the catalog price: "Check price", with "Restore $9.99".
  - The same barcode added twice within 1.5 seconds (beyond the scanner's own 300 ms guard): "Scanned twice?", with "Remove one".
  - Cash tendered at least ten times the total and at least $100 over: "Tendered $1,000 for $12.40?".
- `components/pos/CartItemCard.tsx` shows a small hint on the line; `EnhancedPaymentModal.tsx` shows the tender hint. Never a dialog; Charge is never blocked.

**Tests.** `frontend/tests/cart-checks.test.cjs`; one browser check that a hint appears and its fix works.

### WP 6.4 Store quick keys

- Setting: `quickKeys: z.array(z.object({ id: z.string().uuid(), label: z.string().max(24).optional() })).max(40)` in `updateStoreSettingsSchema` and `publicStoreSettings`; `updateMyStoreSettings` verifies each id is a product or pack of the store.
- `pages/POS.tsx` and `components/pos/CategoryTabs.tsx`: rename the Favorites tab "Quick Keys"; show the store's keys first, then the cashier's own favorites. Managers get "Edit Quick Keys" (add from search, reorder, relabel, remove). Keys load by id like favorites and from the local catalog when offline.

**Tests.** Integration for validation; browser: a manager adds a key and a cashier sees it.

### WP 6.5 Handover notes and tasks

- Schema: `StoreTask { id, locationId, kind String /* TASK | HANDOVER */, title, detail?, assignedToId?, dueDate?, status String @default("OPEN") /* OPEN | DONE | DISMISSED */, createdById, completedById?, completedAt?, createdAt }` with `@@index([locationId, status, createdAt])`.
- New `routes/task.routes.ts` (area `tasks`; add to `operationAreas`): list open tasks for the store (cashiers see unassigned and their own), create (managers; any role for HANDOVER), complete, dismiss (managers).
- `pages/Shifts.tsx`: the clock-out dialog gets an optional "Note for the next shift" (saved as HANDOVER). The current-shift card shows "Notes from the last shift" until acknowledged, and a task checklist.
- Team & Time: a "Tasks" tab for managers (add `TeamNavigation` view and navigation entry).
- The manager's work queue stays the attention list (WP 2.3); tasks are for things people write down.

**Tests.** Integration `storeTasks.workflow.test.ts` (scoping, roles, lifecycle); browser: leave a note at clock-out, the next sign-in sees and acknowledges it.

---

## Phase 7: Later (design notes only, not part of this build)

- **Tax classes and bottle deposits.** `TaxClass` per store (name, rate) with `Product.taxClassId`; deposit as a per-unit fee line. Touches `priceSaleItems`, the cart, receipts, refunds and tax reports together; plan it on its own.
- **Expiry dates.** Nearest expiry captured per receipt line for flagged categories; "pull or mark down this week" attention rule.
- **Sold by weight.** Decimal quantities across stock, cost ledger and sale lines; own migration.
- **A real card processor.** Implement `TerminalAdapter` against the chosen processor; the server would create and confirm the charge.
- **Distributor electronic invoices, live accounting sync, store-scoped API keys, customers shared across an organization, cash-limited order builder, measured price experiments, a store calendar of local events.**

## Verification

Per work package: the tests listed in it, plus

```powershell
npx tsc --noEmit -p frontend; npx tsc --noEmit -p backend
npm run lint --workspace=frontend
node scripts/verify-pos.cjs prepare            # after any schema change: "No difference detected"
node scripts/verify-pos.cjs backend <changed and affected test files>
npm run test:unit --workspace=frontend
node scripts/verify-pos.cjs browser <specs> --project=chromium
```

Per phase checkpoint: the full backend suite and the browser suites in batches of about eight specs, then a manual pass in the running app (`npm run dev`) of the phase's screens as owner, manager and cashier, at desktop and phone width, light and dark.

End-to-end acceptance for the whole plan:

1. With the API stopped and the network off, the installed register opens, scans cached items instantly, and queues a cash sale that syncs once on reconnect.
2. Pressing Charge makes one request before the Payment dialog.
3. A cashier closing a drawer never sees the expected amount first; the manager sees the difference afterwards.
4. With an open stock exception, yesterday's profit shows with its estimated part; resolving the exception confirms it.
5. The morning brief lists yesterday's facts and the attention items, and every number in its text exists in the computed data.
6. An owner with two stores switches between them without signing out, sees both on My Stores, renames a shared item once, and sets one shared price; each store keeps its own stock and cost.
7. A delivery received by scanning on a phone updates stock and cost, flags a cost increase, and suggests a price.
8. With the test printer transport, a cash sale prints silently and kicks the drawer; with the terminal simulator, approve, decline, partial and unknown all end in a correct, recoverable state.

## Risks and things to watch

- **Phase 3 touches every request.** Keep the change inside `authenticate`; do not edit per-controller scoping. Run the full suite before and after.
- **Triggers.** Four new triggers (default organization, home access sync, and two price-changed). Each must be listed in `DATABASE_MIGRATIONS.md` and exercised by an integration test, because the drift check cannot see them.
- **Immutable tables.** `inventory_value_entries` and `sale_payments` block updates. New columns there are written at insert only.
- **Hard deletes.** `deleteProduct` removes the row, so the delta sync cannot see it; the `activeTotal` mismatch check and the 12-hour full refresh cover this.
- **Service worker updates.** Never reload a register mid-sale; the update notice applies only when idle.
- **Shared catalog scope.** Variety-pack contents and customers are not shared in this version; say so in the screen copy.
- **Hardware.** Printing and terminals cannot be proven without devices; ship them behind settings that default to today's behaviour.
