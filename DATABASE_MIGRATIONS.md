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
3. Against that clone, run `npm run db:baseline --workspace=backend`. This command
   refuses to mark the baseline unless the complete schema matches the immutable
   `prisma/reconciled/baseline.prisma`. Investigate any drift; do not suppress it.
4. Run `npm run db:migrate:deploy --workspace=backend`, then
   `npm run db:check --workspace=backend` and the integration tests.
5. Repeat the baseline/deploy/check on the backed-up installation during a
   maintenance window. Baseline is a **one-time** command. It preserves existing
   migration records and business data. Normal starts run deployment only.

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

## Verification performed locally, 2026-10-15

- Created a database backup and a matching local uploads copy under ignored
  `.local/implementation/`.
- The disposable fresh-install and browser databases now have all eight reviewed
  migrations: baseline, scoped exports/attachments, manager approvals, inventory
  versions, purchase receipts, transfer receipts, session revocation and drawer ledger.
- Restored upgrade: baseline check and forward migrations passed; zero drift;
  retained 2 sales, 9 products, 5 users, $115.86 sales total and 613 stock units.
- The local development database received the same migrations after backups,
  with identical before/after totals and zero schema drift. The purchase receipt
  backup includes a fresh database dump, uploads copy and verification JSON under
  `.local/implementation/pre-purchase-receipts-1791991894443/`.
- Transfer receipts were checked on the restored clone, then applied locally
  after pausing the API and taking a matching backup under
  `.local/implementation/pre-transfer-receipts-1792018055739/`. All 2 sales,
  9 products, 5 users, 1 transfer, $115.86 sales total and 613 stock units remained
  unchanged. The API was restarted and both localhost services passed health checks.
- The original migration history remains present.
- Session revocation was verified on the restored clone and local database with
  zero drift and the trigger present. The local API was paused for the matching
  backup under `.local/implementation/pre-session-revocation-1792031678370/`.
  All business totals and 17 existing unrevoked session records were preserved;
  the migration itself does not force a bulk logout. Local services restarted successfully.
- The drawer ledger was verified on the restored clone, then applied locally
  after pausing the API and taking a database/uploads backup under
  `.local/implementation/pre-drawer-ledger-1792073848169/`. All business totals,
  existing closed drawer expectations, actual counts and differences were
  unchanged; two original sale entries were backfilled. Schema drift was zero
  and the immutable-ledger trigger was present. Local API/frontend health checks passed.
- A new empty `pos_drawer_fresh_test` database installed all eight migrations.
  Its schema has zero drift, no sales, and all three custom triggers. The existing
  integration and browser databases also received the new migration.

The inventory-version migration installs a PostgreSQL trigger. Every quantity
change increments the product version, including writes through older paths.
Do not replace this migration with schema push: Prisma's schema diff does not
represent the trigger. Concurrency tests verify its behavior.

Purchase receipt history is additive. Previously closed orders are marked
`receivingHistoryKnown = false`; no historical receipt quantities are invented.
New accepted/damaged/rejected quantities start at zero, and receipt relations
prevent deletion of financial/stock history through ordinary order deletion.

Transfer receipt history is also additive. Existing non-draft shipments are
marked `receivingHistoryKnown = false`; earlier delivery events and destination
product identities are not guessed. Legacy shipments need explicit destination
product matching before accepting additional stock. New events cannot delete
their transfer/item history through cascading relations.

The session migration installs `users_revoke_sessions`. Password, role, store
assignment and activation changes revoke that user's sessions in the same
transaction. Access tokens now carry the refresh-session ID and are checked
against its current status. Older access tokens must renew once using a valid
refresh cookie or sign in again. As with the inventory-version trigger, Prisma
schema diff alone does not verify this trigger; integration tests exercise
revocation, rollback and login/password-reset races.

The drawer migration adds `drawer_entries` with `Decimal(14,2)` signed cash
amounts and a trigger rejecting update/delete. It backfills only original sale
cash after change and explicit paid-in/out/safe-drop records. Existing shifts
are marked `drawerHistoryComplete = false`: no paying drawer is inferred for
old refunds or voids. Stored closed expectations/counts/differences are preserved.
Fresh shifts default to complete history for these supported drawer operations.
Other booked money remains Float until its separately reviewed conversion;
new account cash funding/repayments are now integrated; correction UI remains separate work.

This establishes local migration compatibility. Off-host backup retention,
production restore timing, receipt-content checks, and pilot hardware acceptance
still need operational validation.

## Account funding checkpoint (2026-10-15)

Migration `20261015010000_account_funding` adds immutable fixed-decimal
account-operation receipts and nullable links from existing account transactions
and drawer entries. It changes account-history deletion to Restrict. No existing
balance or historical funding tender is rewritten; unknown older funding details
remain unavailable. The new `account_operations_immutable` trigger is covered
by integration tests, alongside the existing three triggers.

All nine migrations installed into empty `pos_accounts_fresh_test` with zero
drift and no sales/account operations. The restored upgrade clone retained its
business snapshots. Local deployment followed an API pause and database/uploads
backup at `.local/implementation/pre-account-funding-1792092163839/`.
Before/after sales, stock, users, transfers, closed drawer counts, account balances
and account-history counts matched. The local API and frontend restarted with
HTTP 200 health checks. The integration and browser test databases also received
the migration. Full-application money conversion and general correction workflows
are not part of this additive migration.

## Original sale allocation checkpoint (2026-10-15)

Migration `20261015020000_sale_allocations` adds nullable pricing-version,
original cost/tax/discount/surcharge/points fields and refund allocation fields.
Existing rows remain unversioned; historical costs and loyalty redemption are
not guessed. Four new triggers protect versioned sale facts, sale lines, allocated
refunds and their lines. Status/receipt metadata can still change. Existing booked
Float fields are retained for a separate reviewed conversion.

A fresh `pos_sale_snapshots_fresh_test` database installed all ten migrations
with zero drift and eight custom triggers. The restored clone kept its original
sale/line facts and marked both existing sales as unversioned. Local deployment
followed an API pause and database/uploads backup at
`.local/implementation/pre-sale-snapshots-1792110016565/`. All sale amounts,
quantities, customer points/spend, balances and closed drawer totals matched the
pre-upgrade snapshot (2 sales, $115.86 total, 9 products, 613 units, 5 users).
Local API/frontend checks returned HTTP 200. The current integration and browser
databases also received this migration.

## Reviewed inventory import checkpoint (2026-10-16)

Migration `20261016000000_inventory_imports` adds saved immutable previews and
applied import results. It changes no existing product, sale or account facts.
The ninth custom trigger protects reviewed payloads and applied results.

All eleven reconciled migrations installed into `pos_imports_fresh_test` with
zero drift. `pos_imports_upgrade_test` restored the current backup, upgraded and
retained hashes/counts for every preexisting business table. The local upgrade
followed a verified API pause and backup at
`.local/implementation/pre-inventory-imports-1792161425884/`. The backup includes
the database, uploads manifest/copy, table hashes and verification logs. This
installation had no uploaded files, so attachment-content restore acceptance is
not established by this run.

Before/after hashes matched on the operational local database: 2 sales totaling
$115.86, 9 products, 613 stock units and 5 users were preserved, including customer,
account and closed drawer facts. The database retains its older migration history
alongside all eleven reconciled entries. API/frontend checks returned HTTP 200.
The integration and browser databases also received migration 11. SETUP.md now
uses this migration workflow instead of its obsolete schema-push/reset advice.

## Dated void events, verified 2026-10-16

`20261016010000_sale_void_events` adds one event per voided sale with Decimal
amount/tax/cost, original item/tender JSON, actor, approval, paying shift and
idempotency identity. `sale_voids_immutable` rejects updates and deletions. No
legacy status-only void is backfilled with a guessed reversal date.

The database and uploads backup is
`.local/implementation/pre-sale-voids-1792198067441/`. The restored
`pos_voids_upgrade_test` database retained every preexisting table hash and its
older applied migration history. Empty `pos_voids_fresh_test` installed all 12
reconciled migrations; both checks reported zero drift and all 10 custom triggers.
The same migration was applied to the guarded integration/browser databases and
the local development database. Before/after hashes matched; 2 sales/$115.86,
9 products/613 stock units and 5 users were preserved. Local API/frontend returned
200 after restarting. Evidence is in the backup directory's verification files.

This is an additive local migration verification, not an off-host disaster
recovery or pilot acceptance claim. General financial correction workflows and
conversion of existing Float monetary columns remain open.


## Fixed precision (2026-10-17)

Migration 20261017000000_fixed_precision_money converts 75 Float fields in 35
tables to numeric storage. Booked USD uses Decimal(14,2); unit prices/costs and
wages use Decimal(14,4); percentage fields use Decimal(9,4) where applicable.
The transaction refuses nonfinite values and precision differences larger than
one millionth before ALTER TABLE. Review rejected records; do not bypass the
guard or silently round historical money. Pure binary floating-point residue
within that tolerance is removed by the declared scale conversion.

A fresh installation and restored local upgrade passed schema checks. Canonical
row hashes (monetary fields normalized to declared scale), uploads and prior
migration records were preserved. The rejection/rollback scenario was verified
against an independent restored database. The local backup and verification are
under .local/implementation/pre-decimal-money-1792250766431. There are thirteen
reconciled migrations and ten custom triggers. Local data retained 3 sales /
$1,241.97, 9 products / 544 units and 5 users. Generate the Prisma client and deploy
this schema together with its application changes; the old Float assumptions
are incompatible with the new Decimal client types.

Email delivery queue: 20261017010000_email_delivery_queue is an additive enum/table/index/FK migration. Fresh database and restored-clone deployment passed with zero drift. The local upgrade preserved every preexisting row hash, applied migration record, all ten custom triggers and uploads. Matched backup and proofs: .local/implementation/pre-email-queue-1792270684527. Fourteen reconciled migrations are applied.
