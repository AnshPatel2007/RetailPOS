# Database changes and recovery

The canonical schema is `backend/prisma/schema.prisma`. Deployment uses **only**
`backend/prisma/reconciled/migrations`. The earlier migrations and their database
history are preserved unchanged for audit; several old migrations remove data
and must not be replayed against the current schema.

## Existing installation

1. Stop operational writes and back up PostgreSQL with `pg_dump -Fc`. Back up
   `backend/uploads` with the same recovery point. Keep copies off the host.
2. Restore into an isolated database and verify record counts, transaction totals,
   and uploaded documents before touching the original installation.
3. Against that clone, run `npm run db:bridge --workspace=backend`, then
   `npm run db:baseline --workspace=backend`. The bridge applies a reviewed,
   purely additive SQL file from `prisma/reconciled/bridges/` only when the
   database differs from the baseline by exactly that file; otherwise it changes
   nothing and refuses. The baseline refuses to mark itself applied unless the
   complete schema matches the immutable `prisma/reconciled/baseline.prisma`.
   Investigate any refusal; do not suppress it.
4. Run `npm run db:migrate:deploy --workspace=backend`, then
   `npm run db:check --workspace=backend` and the integration tests.
5. Repeat the bridge/baseline/deploy/check on the backed-up installation during a
   maintenance window. Bridge and baseline are **one-time** commands. They preserve
   existing migration records and business data. Normal starts run deployment only.

## Upgrading the Render installation deployed from GitHub `main` (July 20, 2026)

That installation was built by `prisma db push --accept-data-loss` at every start
(commit `434d023`). Its schema is short of the baseline only by the payroll and
store-connection additions, covered by
`bridges/20260720_github_main_to_baseline.sql` (new nullable/defaulted columns,
two new tables, indexes and foreign keys; nothing dropped or converted).

Rehearsed locally on 2026-11-03: the July schema plus the July seed and
July-format sales (cash, split card/cash with float residue, a partial item
refund, a status-only void, open and closed shifts) went through bridge,
baseline and all reconciled migrations. Drift check: no difference. Sales,
refund, customer, shift and stock totals were identical before and after. The new
API logged in and served sales, products, reports, analytics and pricing from it.
The bridge refused a database in any other state.

Order matters, because the old release rewrites the schema on every start:

1. In the Render dashboard, confirm the service's **Start Command** is
   `npm run db:migrate:deploy && npm run start`. A dashboard value overrides
   `render.yaml`; if it still runs `prisma db push`, the new release would push
   past the migrations (skipping triggers, views and sequences) and the old one
   would undo the bridge on its next start.
2. Back up the production database (`pg_dump -Fc` with the external URL from the
   Render dashboard) and rehearse steps 2–4 above on a restored local clone.
3. Suspend the Render service so the old release cannot restart in between.
4. With `DATABASE_URL` set to the production external URL in the environment, run
   `npm run db:bridge`, `npm run db:baseline`, `npm run db:migrate:deploy` and
   `npm run db:check` from `backend/`.
5. Deploy the new release (frontend and backend together) and resume the service.
   Its start command finds every migration applied.
6. If customers, suppliers or categories are missing for a store, run
   `npx ts-node scripts/backfillLocationScoping.ts` (dry run), then with `--apply`.
   It only fills rows whose store is still empty.

Do not use `db push --accept-data-loss`, reset, or test cleanup against an
operational database. If deployment fails, keep the old application stopped,
inspect the migration, and restore the database **and** matching uploads when
rollback is required; do not guess which statements completed.

## New installation and future changes

Run `npm run db:migrate:deploy --workspace=backend` on an empty database, generate
the Prisma client, build, and check readiness. The wrapper copies the canonical
schema to an ignored file beside the reconciled migrations for Prisma CLI use.
Never edit that generated copy or the immutable baseline.

Add reviewed, forward SQL migrations to the reconciled directory. Verify both a
fresh installation and an upgrade of a restored clone. Review precision changes,
backfills, constraints, and long-running locks explicitly. Keep schema and SQL
changes in the same release. Credentials must be environment variables, not
arguments or checked-in files.

## Making a schema change

1. Edit `backend/prisma/schema.prisma` and add
   `backend/prisma/reconciled/migrations/<timestamp>_<name>/migration.sql`. Prefer
   additive changes (nullable or defaulted columns, new tables). Index, constraint
   and foreign-key names must match what Prisma expects, or the drift check fails.
2. Run `node scripts/verify-pos.cjs prepare`. It applies the migration to the
   disposable test databases and must report "No difference detected" for each.
   Then run the affected backend and browser tests (`docs/testing.md`).
3. To apply it to the local store database: stop the API, back up with
   `pg_dump -Fc` into `.local/backups/<name>-<date>/` with a copy of
   `backend/uploads`, record key totals (sales count and sum, products, users, live
   sessions), run `npm run db:migrate:deploy --workspace=backend` and
   `npm run db:check --workspace=backend`, compare the totals, then restart the API.
   On Windows, stop the API before `prisma generate` (it locks the engine DLL).

## What a schema diff cannot see

These live only in the reviewed migrations, which is why `db push` must never
replace them. Integration tests exercise them.

- **Triggers.** `product_stock_version` increments a product's version on every
  quantity change. `users_revoke_sessions` ends a user's sessions when the password,
  role, store or active flag changes. The `*_immutable` triggers block updates and
  deletes on booked history: sales, sale lines and payments, refunds and refund
  tenders, sale voids, drawer entries, account operations, operation receipts,
  inventory imports, values, revisions and corrections, supplier returns, lottery
  audit and earnings, and background job content and attempts. Two identifier
  triggers stop one barcode or SKU from belonging to both a product and a pack in
  the same store. `locations_default_organization` gives a store inserted (or moved
  out of an organization) without an organization its own, named after the store.
  `users_sync_home_access` keeps each person's home-store row in `user_store_access`
  in step with `users.locationId` and `role`: when the home store changes the old row
  goes, unless the person owns that store's organization (then it stays ADMIN), and
  platform admins keep no row. `products_price_changed` and
  `product_selling_units_price_changed` stamp `priceChangedAt` (UTC) whenever a
  product's or pack's price changes, whatever wrote it, for the shelf labels to print.
- **Views.** `effective_inventory_values` and `reported_inventory_values`.
- **Precision.** Booked USD is `Decimal(14,2)`; unit prices, costs and wages are
  `Decimal(14,4)`; percentages are `Decimal(9,4)`. The Float-to-Decimal conversion
  refused any value that would change by more than one millionth.
- **History is never invented.** Older records that lack new facts are marked rather
  than guessed: `receivingHistoryKnown = false` on earlier purchase orders and
  transfers, `drawerHistoryComplete = false` on earlier shifts, and no
  `pricingVersion` on sales made before allocations. Status-only legacy voids are
  reviewed in Finances > Balance Corrections > Old Voids.

## Recent changes

- **`20261112030000_supplier_delivery_days` (2026-11-12).** Purely additive:
  `suppliers.deliveryDays INTEGER[]` (0 = Sunday ... 6 = Saturday), an empty list for
  every existing supplier, which keeps their two-week reorder planning. The app needs
  it. Not yet applied to the store database (Phase 4 checkpoint).

- **`20261112020000_shelf_label_dates` (2026-11-12).** Purely additive. Nullable
  `priceChangedAt` and `labelPrintedAt` on `products` and `product_selling_units`, and
  the `products_price_changed` / `product_selling_units_price_changed` triggers
  (above). No backfill: existing items have no recorded price change, so Products >
  Labels to print starts empty. Trigger times are written as UTC explicitly
  (`now() AT TIME ZONE 'UTC'`), because a local PostgreSQL session may run in local
  time. The app needs it. Not yet applied to the store database (Phase 4 checkpoint).

- **`20261112010000_supplier_credits` (2026-11-12).** Purely additive. New nullable
  column `purchase_receipt_items.previousUnitCost` (the item's cost price before that
  delivery; older receipt lines stay `NULL`, not known) and new table
  `supplier_credits` (money a supplier owes: damaged or rejected goods an invoice
  charged for, returns, shortages, price corrections; `OPEN` until `RECEIVED` or
  `WRITTEN_OFF`), with a foreign key to `suppliers` that blocks deleting a supplier
  that has credits. No triggers, no backfill. The app needs it: this version's Prisma
  client writes both. Not yet applied to the store database (Phase 4 checkpoint).

- **`20261112000000_organizations_store_access` (2026-11-12).** Multi-store owners,
  data only. New tables `organizations`, `organization_owners` and
  `user_store_access`; new nullable columns `locations.organizationId` and
  `refresh_tokens.activeLocationId` (stays `NULL`, meaning the home store, until
  store switching ships). Backfill: one organization per store, named after it; an
  access row for everyone with a store, with their current role; every active ADMIN
  owns their store's organization, so nobody gains or loses access. Adds the
  `locations_default_organization` and `users_sync_home_access` triggers (above).
  The app needs it: this version's Prisma client reads both new columns. Applied to
  the local store database on 2026-11-11 after the backup in
  `.local/backups/pre-phase3-organizations-20261111-231815/`: 3 stores, 3
  organizations named after them, 4 access rows matching each person's home store and
  role, 2 owners; sales (462, $1,608,771.21) and live sessions (25) identical before
  and after.

- **`20261111010000_inventory_value_reason` (2026-11-11).** Adds the nullable column
  `inventory_value_entries.reason`: why a stock change happened (damaged, expired,
  theft, a count difference, a transfer loss...), used by Finances > Inventory Costs >
  Losses. No data changes: the table is append-only, so older rows stay `NULL` and the
  report reads their cause from the resolved stock exception or the stock log where one
  exists. **Unlike the customer change below, the app needs this column**: code from
  this version reads and writes it, so apply the migration to a database before
  running this version against it (backup first, as above). Applied to the local
  store database on 2026-11-11, together with the customer change below, after the
  backup in `.local/backups/pre-phase2-migrations-20261111-212937/`.

- **`20261111000000_customers_unique_per_store` (2026-11-11).** Customer email and
  phone were unique across every store; they are now unique within a store
  (`customers_email_locationId_key`, `customers_phone_locationId_key` replace
  `customers_email_key`, `customers_phone_key`). Existing rows already satisfy the
  looser rule, so no data changes. Applied to the local store database on 2026-11-11
  (see the entry above). A database without it keeps the stricter, global rule and
  the new code works unchanged. If customers with no
  store remain (`backfillLocationScoping.ts`), run that backfill before stores start
  adding customers who already exist elsewhere, or the backfill can meet a duplicate.

- **`20261105020000_register_pin_sign_in` (2026-11-04).** Adds `users.pinHash`,
  `pinSetAt`, `pinFailedAttempts`, `pinLockoutUntil` and the `register_devices` table
  for register PIN sign-in. Purely additive; it does not fire `users_revoke_sessions`.
  Applied to the local store database after the backup in
  `.local/backups/pre-register-pin-20261104-141801/`. Sales (461, $1,608,659.36),
  products (9), users (5) and live sessions (34) were identical before and after.
