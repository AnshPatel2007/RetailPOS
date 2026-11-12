import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, ShoppingCart, Ticket, Clock, Package, Truck, ArrowLeftRight, Tag, Users, Wallet,
  TrendingUp, DollarSign, BarChart3, FileText, Settings, Shield, UserCog, Monitor, Building2,
} from 'lucide-react';

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'CASHIER';
const ALL: Role[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER'];
const MANAGERS: Role[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'];
const STORE_LEADS: Role[] = ['ADMIN', 'MANAGER'];

export interface NavLink {
  name: string;
  href: string;
  icon: LucideIcon;
  roles: Role[];
  /** Other words people use for this place; quick-find matches them too. */
  keywords?: string;
  /** Shown only to someone who runs more than one store (see `runsSeveralStores`). */
  severalStores?: boolean;
}
export interface NavSection { title?: string; items: NavLink[] }

export const STOCK_CONTROL = '/inventory/stock-control';

/**
 * The main menu, grouped by the job being done: selling first, then the
 * catalogue, customers, money, and store administration last.
 */
export const sidebarSections: NavSection[] = [
  { items: [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ALL, keywords: 'home today summary' },
    { name: 'My Stores', href: '/stores', icon: Building2, roles: ['ADMIN'], severalStores: true, keywords: 'locations all stores overview switch business' },
    { name: 'POS', href: '/pos', icon: ShoppingCart, roles: ALL, keywords: 'register checkout sell sale' },
    { name: 'Lottery', href: '/lottery', icon: Ticket, roles: ALL, keywords: 'scratch tickets instant games' },
    { name: 'My Shift', href: '/my-shift', icon: Clock, roles: ['CASHIER'], keywords: 'clock in clock out drawer' },
  ] },
  { title: 'Products', items: [
    { name: 'Products', href: '/inventory', icon: Package, roles: MANAGERS, keywords: 'inventory catalog items sku barcode labels single' },
    { name: 'Purchasing', href: '/inventory/purchasing', icon: Truck, roles: MANAGERS, keywords: 'purchase orders po receive vendor' },
    { name: 'Stock Control', href: STOCK_CONTROL, icon: ArrowLeftRight, roles: MANAGERS, keywords: 'counts transfers exceptions adjustments' },
    { name: 'Promotions', href: '/promotions', icon: Tag, roles: MANAGERS, keywords: 'deals discounts bogo mix match happy hour' },
  ] },
  { title: 'Customers', items: [
    { name: 'Customers', href: '/customers', icon: Users, roles: ALL, keywords: 'directory loyalty points phone' },
    { name: 'Gift Cards & Accounts', href: '/customers/accounts', icon: Wallet, roles: MANAGERS, keywords: 'gift cards store credit house accounts charge' },
    { name: 'Customer Insights', href: '/customers/insights', icon: TrendingUp, roles: MANAGERS, keywords: 'segments campaigns birthdays' },
  ] },
  { title: 'Money & reports', items: [
    { name: 'Finances', href: '/financial', icon: DollarSign, roles: MANAGERS, keywords: 'money expenses budgets accounting' },
    { name: 'Reports', href: '/insights/reports', icon: BarChart3, roles: STORE_LEADS, keywords: 'analysis sales report' },
    { name: 'Reports', href: '/analytics', icon: BarChart3, roles: ['SUPER_ADMIN'], keywords: 'analysis sales report stores' },
  ] },
  { title: 'Store', items: [
    { name: 'Team & Time', href: '/team-time', icon: UserCog, roles: MANAGERS, keywords: 'shifts staff payroll employees' },
    { name: 'Audit Log', href: '/audit-log', icon: FileText, roles: MANAGERS, keywords: 'activity history who changed' },
    { name: 'Settings', href: '/settings', icon: Settings, roles: ALL, keywords: 'preferences configuration' },
    { name: 'Admin Panel', href: '/admin', icon: Shield, roles: ['SUPER_ADMIN'], keywords: 'stores users platform' },
  ] },
];

/** Places inside pages (tabs and sections) that quick-find can jump straight to. */
const pageViews: (NavLink & { within: string })[] = [
  { within: 'Products', name: 'Packs & cartons', href: '/inventory?view=packs', icon: Package, roles: MANAGERS, keywords: 'variety pack case carton' },
  { within: 'Purchasing', name: 'Purchase orders', href: '/inventory/purchasing/orders', icon: Truck, roles: MANAGERS, keywords: 'po receive order' },
  { within: 'Purchasing', name: 'Receive delivery', href: '/inventory/purchasing/receive', icon: Truck, roles: MANAGERS, keywords: 'receive delivery scan truck check in invoice phone' },
  { within: 'Purchasing', name: 'Suppliers', href: '/inventory/purchasing/suppliers', icon: Truck, roles: MANAGERS, keywords: 'vendors distributors' },
  { within: 'Purchasing', name: 'Reorder suggestions', href: '/inventory/purchasing/suggestions', icon: Truck, roles: MANAGERS, keywords: 'low stock reorder' },
  { within: 'Purchasing', name: 'Price review', href: '/inventory/purchasing/price-review', icon: Truck, roles: MANAGERS, keywords: 'cost change margin' },
  { within: 'Purchasing', name: 'Credits owed', href: '/inventory/purchasing/credits', icon: Truck, roles: MANAGERS, keywords: 'supplier credit damaged rejected return refund owed' },
  { within: 'Stock Control', name: 'Stock exceptions', href: STOCK_CONTROL + '/exceptions', icon: ArrowLeftRight, roles: MANAGERS, keywords: 'negative stock oversold' },
  { within: 'Stock Control', name: 'Stock counts', href: STOCK_CONTROL + '/counts', icon: ArrowLeftRight, roles: MANAGERS, keywords: 'cycle count physical count' },
  { within: 'Stock Control', name: 'Transfers', href: STOCK_CONTROL + '/transfers', icon: ArrowLeftRight, roles: MANAGERS, keywords: 'move stock between stores' },
  { within: 'Stock Control', name: 'Movement history', href: STOCK_CONTROL + '/movements', icon: ArrowLeftRight, roles: MANAGERS, keywords: 'adjustments log' },
  { within: 'Gift Cards & Accounts', name: 'Gift cards', href: '/customers/accounts/gift-cards', icon: Wallet, roles: MANAGERS },
  { within: 'Gift Cards & Accounts', name: 'Store credits', href: '/customers/accounts/store-credits', icon: Wallet, roles: MANAGERS },
  { within: 'Gift Cards & Accounts', name: 'House accounts', href: '/customers/accounts/house-accounts', icon: Wallet, roles: MANAGERS, keywords: 'charge account tab' },
  { within: 'Finances', name: 'Expenses', href: '/financial?tab=expenses', icon: DollarSign, roles: MANAGERS, keywords: 'bills costs' },
  { within: 'Finances', name: 'Recurring expenses', href: '/financial?tab=recurring', icon: DollarSign, roles: MANAGERS, keywords: 'rent utilities monthly' },
  { within: 'Finances', name: 'Budgets', href: '/financial?tab=budgets', icon: DollarSign, roles: MANAGERS },
  { within: 'Finances', name: 'Profit & loss', href: '/financial?tab=pnl', icon: DollarSign, roles: MANAGERS, keywords: 'p&l pnl income statement' },
  { within: 'Finances', name: 'Inventory costs', href: '/financial?tab=inventory', icon: DollarSign, roles: MANAGERS, keywords: 'stock value valuation cost corrections' },
  { within: 'Finances', name: 'Balance corrections', href: '/financial/reconciliation', icon: DollarSign, roles: ['ADMIN'], keywords: 'reconciliation fix drawer gift card store credit house account balance old voids' },
  { within: 'Reports', name: 'Sales report', href: '/insights/reports/sales', icon: BarChart3, roles: STORE_LEADS, keywords: 'transactions refunds voids' },
  { within: 'Reports', name: 'Stock health', href: '/insights/reports/inventory', icon: BarChart3, roles: STORE_LEADS, keywords: 'low stock out of stock dead stock inventory report' },
  { within: 'Reports', name: 'Employee sales', href: '/insights/reports/staff', icon: BarChart3, roles: STORE_LEADS, keywords: 'staff cashier sales' },
  { within: 'Reports', name: 'Exports', href: '/insights/reports/exports', icon: BarChart3, roles: STORE_LEADS, keywords: 'quickbooks csv scan data accounting download' },
  { within: 'Team & Time', name: 'Shifts', href: '/team-time/shifts', icon: Clock, roles: MANAGERS, keywords: 'clock z report drawer close' },
  { within: 'Team & Time', name: 'Staff', href: '/team-time/staff', icon: UserCog, roles: ['ADMIN'], keywords: 'employees users team members' },
  { within: 'Team & Time', name: 'Payroll', href: '/team-time/payroll', icon: UserCog, roles: ['ADMIN'], keywords: 'wages hours pay' },
  { within: 'Settings', name: 'Profile & security', href: '/settings?section=profile', icon: Settings, roles: ALL, keywords: 'password two factor 2fa' },
  { within: 'Settings', name: 'Store settings', href: '/settings?section=store', icon: Settings, roles: ['SUPER_ADMIN', 'ADMIN'], keywords: 'store name address' },
  { within: 'Settings', name: 'Taxes & payments', href: '/settings?section=payments', icon: Settings, roles: ['SUPER_ADMIN', 'ADMIN'], keywords: 'tax rate surcharge ebt' },
  { within: 'Settings', name: 'Receipts', href: '/settings?section=receipts', icon: Settings, roles: ['SUPER_ADMIN', 'ADMIN'], keywords: 'receipt footer logo' },
  { within: 'Settings', name: 'Devices', href: '/settings?section=devices', icon: Settings, roles: ALL, keywords: 'printer scanner cash drawer hardware' },
  { within: 'Settings', name: 'Email & export jobs', href: '/settings/jobs', icon: Settings, roles: ['SUPER_ADMIN', 'ADMIN'], keywords: 'background jobs email queue' },
  { within: 'POS', name: 'Customer display', href: '/customer-display', icon: Monitor, roles: ALL, keywords: 'second screen' },
];

export interface QuickFindEntry extends NavLink { within?: string }

/** Runs more than one store as ADMIN (an owner of several stores): My Stores is shown. */
export const runsSeveralStores = (user: { stores?: { role: string }[] } | null | undefined) =>
  (user?.stores?.filter(store => store.role === 'ADMIN').length ?? 0) > 1;

export function navigationFor(role: string | undefined, severalStores = false): QuickFindEntry[] {
  const allowed = (link: NavLink) => !!role && link.roles.includes(role as Role) && (!link.severalStores || severalStores);
  return [...sidebarSections.flatMap(section => section.items), ...pageViews].filter(allowed);
}

/** Every typed word must appear in the name, its page or its keywords; names that start with the query rank first. */
export function matchNavigation(entries: QuickFindEntry[], query: string): QuickFindEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return entries;
  const scored = entries.map(entry => {
    const name = entry.name.toLowerCase();
    const haystack = [name, entry.within, entry.keywords].filter(Boolean).join(' ').toLowerCase();
    if (!words.every(word => haystack.includes(word))) return null;
    const score = name.startsWith(words[0]) ? 0 : name.includes(words[0]) ? 1 : 2;
    return { entry, score };
  }).filter((item): item is { entry: QuickFindEntry; score: number } => !!item);
  return scored.sort((a, b) => a.score - b.score).map(item => item.entry);
}
