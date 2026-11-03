# Reproduce POS verification

From the repository root, with dependencies installed and local PostgreSQL
configured in `backend/.env`:

```powershell
node scripts/verify-pos.cjs prepare
node scripts/verify-pos.cjs backend
node scripts/verify-pos.cjs browser
npm.cmd run test:unit --workspace=frontend
npm.cmd run lint --workspace=frontend
npm.cmd run build
```

The verifier derives two separately named `_reliability_test` and
`_reliability_e2e` databases from the development database name. It validates the
targets before creation, migrations and test cleanup. These databases are
disposable: integration tests truncate them and browser setup reseeds its target.
Never put real store records in a test database. The operational database is
used only to derive local connection settings. The runner never cleans it.

The backend command accepts optional repository test paths relative to `backend`;
the browser command accepts optional spec paths relative to `frontend`. Edge is
the default installed browser; set `E2E_BROWSER_CHANNEL` to another installed
Playwright channel when appropriate. Browser tests use ports 5001 and 5174, apart
from the localhost application at 5000 and 5173. Email providers are mocked and
test servers disable delivery workers.

Run the production build after test servers stop. On Windows, a live Prisma
process holds its generated engine DLL and can prevent `prisma generate` from
replacing it. Stop only the known application/test processes, generate/build,
then restart the application. A typecheck can run while the client is in use.

Earlier checkpoints used the guarded local runner with `pos_bulk_void_test` and
`pos_bulk_void_e2e`. The final complete runs used the versioned runner above with
fresh `pos_system_reliability_test` and `pos_system_reliability_e2e` targets:
580 backend tests and 109 browser scenarios passed. A final isolated promotion
edit-race case passed afterward. The runner does not silently migrate or reuse
the operational database. See [workflow coverage](./workflow-verification.md),
[performance measurements](./performance-acceptance.md),
[recovery](./recovery-acceptance.md) and
[physical/provider acceptance](./hardware-provider-acceptance.md) for scope and
limitations. Current run results are recorded in
[the remaining acceptance register](./remaining-implementation.md).
