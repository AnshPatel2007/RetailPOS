# Setup Guide

## Prerequisites

- **Node.js** v18+ (tested on v24) - [Download](https://nodejs.org/)
- **PostgreSQL** v14+ - [Download](https://www.postgresql.org/download/)
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
VITE_API_URL=http://localhost:5000/api
```

## 4. Database Schema & Seeding

> **This project syncs the schema with `prisma db push` — do NOT run `prisma migrate`.**
> The `migrations/` folder is stale and missing the current schema; a migrated database
> lacks columns the code expects, and the app fails with "Database operation failed"
> (including at login).

```bash
# Generate Prisma client
cd backend
npm run db:generate

# Sync the database to the current schema
npm run db:push

# Seed sample data
npm run db:seed
cd ..
```

Re-run `npm run db:push` **every time you pull changes** that touch `backend/prisma/schema.prisma`.

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
| Super Admin | superadmin@pos.com | superadmin123 | All stores, admin panel, all permissions |
| Admin | admin@pos.com | admin123 | Assigned store, all store-level features |
| Manager | manager@pos.com | manager123 | Assigned store only |
| Cashier | cashier@pos.com | cashier123 | POS operations, assigned store only |

## First Time Usage

1. Login with admin credentials
2. Clock in via the Shifts page
3. Navigate to POS and start making sales
4. Add products via the Inventory page as needed

## Database Management

```bash
# Visual database browser
cd backend && npm run db:studio
# Opens Prisma Studio at http://localhost:5555

# Reset database completely (drops all data, re-syncs schema, re-seeds)
cd backend && npx prisma db push --force-reset && npm run db:seed
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
- HTTPS enabled
- CORS configured for production domain
- Database backups configured

## Troubleshooting

**"Database operation failed" (including at login):** the database schema is out of date
with the code — usually after pulling new changes, or after running the stale migrations.
Fix: `cd backend && npm run db:push`, then restart the backend.

**"Forgot password" fails or the email never arrives:** the backend needs a way to
send mail — without one, in production the request fails outright (you'll see
"Failed to send password reset email"); nothing is sent silently either way.

- **On Render specifically**, outbound SMTP is blocked entirely (confirmed:
  connections to `smtp.gmail.com` time out on both port 587 and 465, before
  credentials are ever checked) — raw `SMTP_*` vars alone will not work. Set
  `SENDGRID_API_KEY` instead: sign up at [sendgrid.com](https://sendgrid.com)
  (free tier), verify a "Single Sender" email address (Settings → Sender
  Authentication — no custom domain required), create an API key (Settings →
  API Keys), and set `EMAIL_FROM` to that same verified sender address. Email
  then sends over HTTPS, which isn't blocked.
- **For local dev**, `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASS`/
  `EMAIL_FROM` still work directly (a Gmail address with an
  [App Password](https://myaccount.google.com/apppasswords) is enough) — SMTP
  isn't blocked on a home/dev network, and `SENDGRID_API_KEY` can simply be left
  unset there.

Also set `APP_URL` to your deployed frontend's URL (e.g.
`https://your-app.vercel.app`) — otherwise, even once email sends, the reset link
inside it points at `localhost` and does nothing for a real visitor. `APP_URL` falls
back to `FRONTEND_URL` automatically if not set separately.

**Port already in use:** Change `PORT` in `backend/.env` or port in `frontend/vite.config.ts`.

**Database connection error:** Verify PostgreSQL is running and `DATABASE_URL` in `backend/.env` is correct.

**Prisma client errors:** Run `cd backend && npm run db:generate`.

**Module not found:** Delete `node_modules` directories and run `npm install` again.
