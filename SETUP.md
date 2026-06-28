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

## 4. Database Migration & Seeding

```bash
# Generate Prisma client
cd backend
npm run db:generate

# Run all migrations
npm run db:migrate

# Seed sample data
npm run db:seed
cd ..
```

The seed creates: a Main Store location, demo users (admin/manager/cashier), sample products, customers, suppliers, categories, and tax rates.

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
| Super Admin | admin@pos.com | admin123 | All stores, all permissions |
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

# Reset database completely
cd backend && npx prisma migrate reset && npm run db:seed
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

**Port already in use:** Change `PORT` in `backend/.env` or port in `frontend/vite.config.ts`.

**Database connection error:** Verify PostgreSQL is running and `DATABASE_URL` in `backend/.env` is correct.

**Prisma client errors:** Run `cd backend && npm run db:generate`.

**Module not found:** Delete `node_modules` directories and run `npm install` again.
