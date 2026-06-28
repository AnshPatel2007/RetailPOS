# Square-Style POS System

A complete Point of Sale system built with modern technologies, replicating Square POS functionality with multi-store support.

## Tech Stack

**Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Zustand, Recharts
**Backend:** Node.js, Express, TypeScript, Prisma ORM, PostgreSQL, JWT

## Features

### Core POS
- Fast, touch-friendly product grid with stock badges (green/amber/red)
- Product search by name, SKU, or barcode
- Quantity numpad for quick entry
- Cart persistence across page refreshes (localStorage)
- Hold up to 5 sales and recall them later
- Multiple payment methods (Cash, Card, Gift Card, Store Credit)
- Automatic tax calculation (pulled from location settings)
- Keyboard shortcuts: F1 Cash, F2 Card, F4 Checkout, F5 Hold, F6 Held Sales, / Search
- Void and refund transactions
- Customer association with sales

### Live Dashboard
- Auto-refreshes every 30 seconds with manual refresh button
- KPI cards with trend indicators (% change vs yesterday/last week)
- Hourly sales bar chart (last 12 hours)
- Top 5 products today widget
- Active shifts with live timer
- Low stock alerts (clickable, navigates to inventory)

### Inventory Management
- Products, variants, SKUs, barcodes
- Real-time stock tracking with low-stock alerts
- Stock adjustments and audit logs
- Bulk operations (update stock, prices, categories, activate/deactivate)
- Supplier management and purchase orders
- Auto-deduction on sales, auto-restoration on refunds

### Multi-Store Architecture
- Complete data isolation per location via `locationId` scoping
- All entities scoped: products, customers, sales, suppliers, categories, tax rates, discounts, expenses
- Admin override: `?locationId=<id>` on any endpoint
- Admin POS viewing: read-only access to any store's POS
- Cross-store reporting and analytics

### Reporting & Analytics
- Sales reports by date range, location, employee, customer
- Inventory reports with stock value and profit margins
- Employee performance metrics
- Category performance analysis
- Hourly sales patterns
- Financial summaries and profit/loss statements

### Employee Management
- Role-based access: SUPER_ADMIN, ADMIN, MANAGER, CASHIER
- Clock in/out with shift tracking
- Cash drawer reconciliation
- Activity logging

### Additional
- Customer directory with loyalty points
- Expense tracking with approval workflows
- Barcode scanner support (USB keyboard emulation)
- Receipt printer support (ESC/POS)
- Dark mode support

## Project Structure

```
/frontend              # React frontend
  /src
    /components        # Reusable UI components
    /pages             # Page components
    /hooks             # Custom React hooks
    /services          # API service layer
    /store             # Zustand state management
    /types             # TypeScript types
    /utils             # Utility functions

/backend               # Express backend API
  /src
    /controllers       # Request handlers
    /routes            # API routes
    /services          # Business logic
    /middleware         # Auth, error handling
    /utils             # Utilities
    /config            # Configuration
    /validators        # Request validators
  /prisma              # Schema and migrations
```

## Getting Started

See [SETUP.md](./SETUP.md) for detailed installation instructions.

### Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure backend environment
#    Create backend/.env with DATABASE_URL, JWT_SECRET, etc.

# 3. Run database migrations and seed
npm run db:migrate
npm run db:seed

# 4. Start development servers
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:5000/api

### Default Credentials

> **WARNING**: Development credentials only. Change immediately in production.

| Role | Email | Password |
|------|-------|----------|
| Super Admin | admin@pos.com | admin123 |
| Manager | manager@pos.com | manager123 |
| Cashier | cashier@pos.com | cashier123 |

## API Endpoints

All endpoints support `?locationId=<id>` for admin users to access specific store data.

| Route | Description |
|-------|-------------|
| `GET /api/health` | Health check |
| `/api/auth/*` | Authentication (login, logout, refresh, change password) |
| `/api/products/*` | Products CRUD, low-stock, bulk operations |
| `/api/categories/*` | Categories CRUD |
| `/api/sales/*` | Sales, refunds, voids, receipts |
| `/api/customers/*` | Customers, loyalty points, purchase history |
| `/api/suppliers/*` | Suppliers, product links, performance |
| `/api/purchase-orders/*` | Purchase orders, receiving, auto-generate |
| `/api/expenses/*` | Expenses, approval, payment tracking |
| `/api/shifts/*` | Clock in/out, shift management |
| `/api/reports/*` | Dashboard, sales, inventory, employee reports |
| `/api/analytics/*` | Trends, top products/customers, hourly patterns |
| `/api/financial/*` | P&L, cash flow, financial summaries |
| `/api/locations/*` | Store management (admin) |
| `/api/users/*` | User management, roles, location assignment |

## Performance

- Auth middleware caches user lookups (5-minute TTL, avoids DB hit per request)
- Low-stock queries run at SQL level (field-to-field comparison via raw query)
- Tax rate fetched once per transaction (not per line item)
- Dashboard queries run concurrently via `Promise.all`
- Frontend cart persisted to localStorage (survives refresh)
- Database indexes on frequently queried columns

## Deployment

```bash
npm run build
```

Update environment variables for production:
- Strong JWT secret (32+ characters)
- Production DATABASE_URL
- `NODE_ENV=production`
- HTTPS enabled
- CORS configured for production domain

## License

MIT
