Run `node scripts/verify-recovery.cjs` from the repository root with PostgreSQL
available locally and `backend/.env` configured. `PG_BIN` can override the
PostgreSQL binary directory. The script reads the source database and uploads,
creates uniquely named databases ending in `_test`, applies reviewed migrations
to a fresh database and a restored database, and checks schema drift. It never
drops a database or writes to the source.

The private `.local/recovery-verification-*` artifact contains the database dump,
original-column row fingerprints, uploads backup and SHA-256 manifest, matching
restored uploads, command log and result JSON. The comparison includes every
pre-existing column and row. Newly added columns are checked by schema diff
without changing the original-row comparison. Keep the database and its matching
uploads together. A database-only restore cannot restore receipt attachments or
generated exports.

Keep `JOB_ENCRYPTION_KEY` in the deployment's protected secret backup. When it is
unset, jobs derive encryption from `JWT_SECRET`; changing that secret makes
existing queued content unreadable. Prefer a separate stable key of at least 32
characters before first production use. The key must be restored separately from
these artifacts. Never commit keys, database dumps, or customer uploads. A restore
check must also confirm that an authorized completed export downloads with its
recorded checksum and an encrypted queued message can be decrypted with the
restored deployment key.

The verifier checks each restored durable job with that key and checks completed
export bytes/checksums against the matching restored uploads. It prints only
counts, never message contents. A source without such records reports zero
checks; this does not establish a populated-job restore result. Authorized HTTP
download and tamper rejection are also covered by the background-job workflow
test using its disposable database.

Acceptance on 2026-10-20 retained all 156 original rows and the matching upload,
with no schema drift on either the fresh install or restored upgrade. The private
artifact is `.local/recovery-verification-1792501801656`. That source had no durable
jobs or completed exports, so both corresponding counts are zero. The full-day
simulation passed its signed report, liability, stock, payroll and $162 closing
cash assertions.

Pause transaction intake and workers for an operational backup checkpoint, or use
a coordinated snapshot process. The verifier rejects changed rows or files during
its checks. It leaves its disposable databases and artifacts for review; remove
them only through an explicit, guarded maintenance action.

`backend/src/__tests__/integration/fullDayAcceptance.workflow.test.ts` exercises a
simulated trading day with cash, gift cards, store credit, house-account charges
and payment, item returns, an original gift reversal, owner payroll payment,
an external expense and closing cash. It compares signed report entries,
financial totals, product units/costs, account liabilities and counted drawer
cash, and checks manager wage privacy. It does not establish physical terminal
settlement or a real store pilot.
