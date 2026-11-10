# Testing

Every test runs against **disposable** PostgreSQL databases. Nothing here may point
at the store database in `backend/.env` (`pos_system`); the runners derive separate
names from it and refuse operational targets.

## Everyday commands (from the repository root)

```powershell
node scripts/verify-pos.cjs prepare            # create + migrate the disposable test databases (safe to repeat)
node scripts/verify-pos.cjs backend            # all backend Jest suites
node scripts/verify-pos.cjs backend src/__tests__/integration/registerPin.workflow.test.ts   # one or more files (paths relative to backend/)
node scripts/verify-pos.cjs browser e2e/finishing-pass.spec.ts --project=chromium          # Playwright specs (paths relative to frontend/)
npm run test:unit --workspace=frontend          # small Node unit tests (frontend/tests/*.cjs)
npm run lint --workspace=frontend               # ESLint, zero warnings allowed
npx tsc --noEmit -p frontend; npx tsc --noEmit -p backend
```

- `prepare` creates `<db>_reliability_test` (Jest) and `<db>_reliability_e2e` (browser),
  applies the reviewed migrations and checks schema drift. Integration tests truncate
  their database; browser setup reseeds its own (`backend/scripts/e2e-seed.cjs`).
- Browser tests start their own API on **5001** and Vite on **5174**, separate from the
  development app on 5000/5173. Edge is the default channel (`E2E_BROWSER_CHANNEL`).
  The suite uses one worker because specs share the seeded database.
- Test accounts (all `BrowserTest123!`): `owner@`, `manager@`, `cashier@`,
  `platform@example.test` and workflow-specific ones in `e2e-seed.cjs` /
  `frontend/e2e/utils/auth-helper.ts`. Email, AI and payment providers are mocked.
- Helpers in `frontend/e2e/utils/`: `login`, `confirmInApp`, `chooseOption`,
  `openMenuSection` (sidebar sections fold) and `saleComplete` / `openReceipt`
  (a finished sale shows in the cart, not a pop-up).
- `ui-controls.spec.ts` also runs in Firefox and WebKit (`--project=firefox --project=webkit`).
  On a slow machine WebKit's cold start needs `--timeout=90000`.

## Practical notes

- Run long browser suites in the foreground in batches of about eight specs.
  Claude Code stops background shells when memory runs low.
- Keep source files unchanged during a browser run: Vite hot reload can reset the
  workflow being tested.
- Failures keep screenshots and traces in `frontend/test-results`; the HTML report is
  `frontend/playwright-report`. Both are generated and git-ignored.
- On Windows a running API holds Prisma's engine DLL, so `prisma generate` cannot
  replace it. The JavaScript client still regenerates; stop the API before a clean
  generate or production build.

## Other verification tools

| Command | What it does |
| --- | --- |
| `node scripts/pos-performance.cjs prepare` then `run` | Builds a synthetic 100,000-sale fixture in a `_performance_v2_benchmark` database and times dashboard, inventory, financial and report queries. Writes `.local/performance/<timestamp>.json`. Never touches store data. |
| `node scripts/verify-recovery.cjs` | Backs up the store database and uploads, restores them into new `_test` databases, applies the migrations and proves every original row is unchanged. Keep the database, uploads and `JOB_ENCRYPTION_KEY` together. |
| `npm run audit:interactions` | Writes `docs/interaction-inventory.json`: every interactive control in the frontend with its handler, file and line (a checklist of declarations, not proof they work). |
| `npx playwright test -c playwright.audit.config.ts` (in `frontend/`) | UX audit harness: seeds a demo store, crawls every screen per role and viewport, checks overflow, contrast (axe) and console errors, and records key task flows. Output goes to the git-ignored `.local/ux-audit-2026-11/`. |
