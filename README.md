# POS System

A multi-store point of sale for convenience, liquor and grocery stores: a fast
keyboard-and-scanner register, products with packs and cartons, purchasing and stock
control, customers and accounts, promotions, lottery, finances and reports, and
staff time and payroll, plus a platform-admin shell for running several stores.

**Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Zustand, React Aria, Recharts
**Backend:** Node.js, Express, TypeScript, Prisma, PostgreSQL, JWT sessions

## What it does

**Register**
- Scan or search; a scan works wherever the cursor is. Each scan shows what was added
  and beeps; an unknown barcode offers "Sell as misc item" or "Add product".
- F1 Cash, F2 Card, Enter to charge. Cash, card (on a separate terminal), gift card,
  store credit and house account, split across several payments in one dialog.
  EBT/SNAP eligibility is tracked per product, but EBT is not offered as a tender yet.
- A finished sale stays in the cart with the change due and Print / Email / View
  receipt. Nothing pops up, so the next scan starts the next sale.
- Hold and recall sales, misc items, quantity pad, promotions, age checks, loyalty,
  quick refunds and voids with manager approval, offline cash sales, a customer display.
- Staff sign in by name and PIN on a computer set up as a register, lock it between
  customers and switch cashier (see `CLAUDE.md` for the security rules).

**Back office**
- Products: single items and packs/cartons/variety packs sharing one stock,
  barcode lookup with photos, CSV and supplier-receipt imports, label printing,
  margin pricing.
- Purchasing (orders, receiving, reorder suggestions, price review) and Stock Control
  (exceptions when something sells below zero, counts, transfers between connected
  stores, movement history). The exception count updates live.
- Customers, gift cards, store credit and house accounts; promotions; lottery (rack or
  machine) with daily entry and reports.
- Finances: expenses, recurring expenses, budgets, Profit & Loss (with Excel export),
  inventory costs (opening review, value by date, value ledger, monthly summary) and
  owner-only balance corrections.
- Reports: overall report, sales and refunds, stock health, employee sales, and
  accounting/scan-data exports.
- Team & Time: shifts with drawer counts, staff, payroll. Audit log. Settings for the
  store, taxes and payments, receipts, pricing rules, notifications and devices.
- Multi-store isolation by `locationId`; roles SUPER_ADMIN (platform), ADMIN (owner),
  MANAGER, CASHIER. Two-step sign-in, session revocation, durable email/export/webhook
  jobs, an AI assistant (optional), and a read-only public API with webhooks (`API.md`).
- Light and dark (pure black) themes; Ctrl+K finds any page.

## Getting started

```bash
npm install
# create backend/.env and frontend/.env from their .env.example files
npm run db:migrate:deploy --workspace=backend   # empty database only: see SETUP.md
npm run dev                                     # API :5000, app :5173
```

Full instructions: [SETUP.md](./SETUP.md). Testing: [docs/testing.md](./docs/testing.md).
Changing the database: [DATABASE_MIGRATIONS.md](./DATABASE_MIGRATIONS.md).
Working on the code (including with Claude Code): [CLAUDE.md](./CLAUDE.md).

## Project structure

```
backend/
  src/controllers, routes, services, policies, middleware, validators, utils, config
  src/__tests__/          Jest unit + integration tests
  prisma/schema.prisma    canonical schema
  prisma/reconciled/      baseline + reviewed migrations (the only ones deployed)
  scripts/                migrate wrapper, e2e server/seed, imports, backfills
frontend/
  src/pages, components/{ui,common,pos,register,settings,…}, store, services, hooks, lib, styles
  e2e/                    Playwright specs     e2e-audit/   UX audit harness
  tests/                  Node unit tests
scripts/                  verify-pos (test runner), performance, recovery, interaction inventory
docs/testing.md
```

## Deployment

`npm run build` builds `backend/dist` and `frontend/dist`. The frontend deploys to
Vercel (`frontend/vercel.json`) and the API to Render (`backend/render.yaml`, start
command `npm run db:migrate:deploy && npm run start`). Use a strong `JWT_SECRET`, a
separate stable `JOB_ENCRYPTION_KEY`, `NODE_ENV=production`, HTTPS, and `FRONTEND_URL`
set for CORS. Back up the database and `backend/uploads` together.

## License

MIT
