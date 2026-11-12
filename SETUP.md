# Setup Guide

## Prerequisites

- **Node.js** v18+ (tested on v24) - [Download](https://nodejs.org/)
- **PostgreSQL** v14+ (tested on 18) - [Download](https://www.postgresql.org/download/)
- **npm** (comes with Node.js)

## 1. Database Setup

Install PostgreSQL, then create a database:

```sql
CREATE DATABASE pos_system;
```

Optionally create a dedicated user:

```sql
CREATE USER pos_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE pos_system TO pos_user;
```

## 2. Install Dependencies

```bash
npm install
```

This installs root, backend, and frontend dependencies via npm workspaces.

## 3. Environment Variables

### Backend (`backend/.env`)

Copy `backend/.env.example`; it lists every setting with comments. The minimum:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/pos_system"
JWT_SECRET="your-super-secret-jwt-key-min-32-characters-long-change-in-production"
JWT_EXPIRES_IN="7d"
PORT=5000
NODE_ENV="development"
FRONTEND_URL="http://localhost:5173"
```

### Frontend (`frontend/.env`)

```env
VITE_API_URL=/api
```

In development Vite forwards `/api` to `http://localhost:5000`. For a deployed frontend,
set the full API URL (for example `https://your-api.onrender.com/api`).

## 4. Database Schema & Seeding

Use the reviewed migrations in `backend/prisma/reconciled/migrations`.
For an existing database, follow [the backup and baselining procedure](./DATABASE_MIGRATIONS.md)
before applying changes. Do not run reset or schema push against store data.

For a new, empty development database, run from the repository root:

```bash
npm run db:migrate:deploy --workspace=backend
npm run db:generate --workspace=backend
npm run db:check --workspace=backend

# Optional demo data: only on a disposable development installation
npm run db:seed --workspace=backend
```

For an already reconciled installation, back up the database and uploads, verify
the upgrade on a restored clone, then deploy the reviewed migrations and check
schema drift. Generate the client after schema changes and restart the API.

The seed creates: a Main Store location, demo users (super admin/admin/manager/cashier), sample products, customers, suppliers, categories, and tax rates.

## 5. Run the Application

```bash
# From root directory - starts both backend and frontend
npm run dev
```

Or run separately in two terminals:

```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev
```

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:5000/api
- **Health check**: http://localhost:5000/api/health

## Default Login Credentials

> **WARNING**: Development only. Change all passwords before production use.

| Role | Email | Password | Access |
|------|-------|----------|--------|
| Super Admin | superadmin@pos.com | superadmin123 | Platform administration and authorized read-only store preview |
| Admin | admin@pos.com | admin123 | Assigned store, all store-level features |
| Manager | manager@pos.com | manager123 | Assigned store only |
| Cashier | cashier@pos.com | cashier123 | POS operations, assigned store only |

## First Time Usage

1. Sign in as the owner (`admin@pos.com` on a seeded development database).
2. Add products in **Products** (scan a barcode to look it up), or import a CSV.
3. Clock in (**Team & Time > Shifts**, or **My Shift** for cashiers); sales need an open shift.
4. Open **POS** and sell.
5. Optional, for a shared counter: on the register computer, a manager opens
   **Settings > Devices > Set up this computer**, and each person sets a PIN in
   **Settings > Profile & Security**. Staff then sign in by name and PIN and can lock
   the register between customers.

## Database Management

```bash
# Visual database browser
cd backend && npm run db:studio
# Opens Prisma Studio at http://localhost:5555

# Inspect reviewed migration state and schema drift
npm run db:status
npm run db:check
```

## Building for Production

```bash
npm run build
```

Outputs: `backend/dist/` and `frontend/dist/`

**Production checklist:**
- Strong JWT secret (32+ characters)
- Production database URL
- `NODE_ENV=production`
- `TRUST_PROXY` matches the hosting proxy (default `1` in production). It makes sign-in and request limits apply per caller; without it every store shares one limit behind the host's proxy
- HTTPS enabled
- CORS configured for production domain
- Database backups configured

## Troubleshooting

**"Database operation failed" (including at login):** inspect the API error and
run `npm run db:status --workspace=backend` and `npm run db:check --workspace=backend`.
If migrations are pending, follow [DATABASE_MIGRATIONS.md](./DATABASE_MIGRATIONS.md).
Do not force a schema reset or accept data loss to clear the error.

**Password reset or other email has not arrived:** reset requests return the same
response for known and unknown accounts. A known active account creates an
encrypted delivery job in the same transaction as its reset token. The HTTP
response confirms the request was queued, not that mail reached an inbox.

Configure either SENDGRID_API_KEY with an authorized EMAIL_FROM sender, or the
SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER and SMTP_PASS settings for your
provider. Check the provider's current sender and network requirements; test with
a designated test recipient before enabling delivery. Set APP_URL to the deployed
frontend URL so links point to the correct application.

For local development keep BACKGROUND_WORKER_DISABLED=true,
EMAIL_DELIVERY_WORKER_DISABLED=true, OWNER_BRIEF_DISABLED=true and
BIRTHDAY_EMAILS_DISABLED=true. The first flag disables the durable email, export
and webhook worker. The second disables the separate owner-email delivery worker;
the remaining flags stop the morning brief and birthday schedulers. The morning
brief goes to each store's owners from OWNER_BRIEF_HOUR (store-local, default 7)
until noon, once per store day, unless the store turns off "Morning brief email"
in Settings; OWNER_BRIEF_EMAILS can narrow who receives it. The older names
DAILY_DIGEST_DISABLED, DAILY_DIGEST_HOUR and DAILY_DIGEST_EMAILS still work. Work can be queued
while delivery is disabled. Review pending jobs before enabling a worker in a
configured deployment. NODE_ENV=test also disables the durable worker.

PAYROLL_SCHEDULER_DISABLED=true also prevents automatic expense generation on a
local preview. Enable the scheduler only in the intended store deployment after
reviewing its payroll schedule; owner processing remains available explicitly.

Owners can inspect store jobs at Settings > Email & export jobs (`/settings/jobs`); each user can inspect
own password/security notification states in Settings > Profile. Digest delivery
has its separate delivery history. A provider acceptance is distinct from inbox
arrival. Unknown email outcomes require review and provider evidence before a
manual retry. A missing provider is recorded as failed, never as delivered.

Set JOB_ENCRYPTION_KEY to a separate stable secret of at least 32 characters and
keep it in the deployment's protected secret backup. Existing installations may
initially fall back to JWT_SECRET; changing the effective encryption key makes
queued content unreadable. Restore the key with the database and matching uploads.
`node scripts/verify-recovery.cjs` rehearses a backup and restore without touching
the store database (see [docs/testing.md](./docs/testing.md)).

**Port already in use:** an old API or Vite process is still running. Stop it, or change
`PORT` in `backend/.env` / the port in `frontend/vite.config.ts`.

**"Route not found" for a feature that exists in the code:** the API process is older
than the code (for example started with plain `node` instead of `npm run dev`, which
restarts on changes). Stop it and run `npm run dev` in `backend/`. If the change added
database columns, apply its migration first (see [DATABASE_MIGRATIONS.md](./DATABASE_MIGRATIONS.md)).

The POS assistant is available from the chat icon on all screens. Configure
`ANTHROPIC_API_KEY` in the backend environment for replies. General help is
available before sign-in; store analysis requires an owner or manager account.
The public help endpoint has no store-data tools. Opening the panel does not
call the provider. Missing configuration or provider failure keeps the question
available for retry. Automated assistant tests mock the provider and make no
paid requests.

**Database connection error:** Verify PostgreSQL is running and `DATABASE_URL` in `backend/.env` is correct.

**Prisma client errors:** Run `cd backend && npm run db:generate`.

**Module not found:** Delete `node_modules` directories and run `npm install` again.
