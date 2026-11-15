import { createContext, useContext } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { can } from '@/lib/capabilities';
import { managesSharedCatalog } from '@/lib/navigation';
import { PageTabs } from './PageTabs';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import { useInventoryExceptionCount } from '@/hooks/useInventoryExceptionCount';

interface WorkflowContextValue {
  title: string;
  tabs: React.ReactNode;
  secondaryTabs?: React.ReactNode;
}
const WorkflowContext = createContext<WorkflowContextValue | null>(null);
export const useWorkflowNavigation = () => useContext(WorkflowContext);

export function WorkflowNavigation({ label, views, children, secondaryTabs }: { label: string; views: { label: React.ReactNode; path: string }[]; children: React.ReactNode; secondaryTabs?: React.ReactNode }) {
  const location = useLocation();
  const title = label === 'Customers / Accounts' ? 'Gift Cards & Accounts' : label.split(' / ').slice(-1)[0] || label;
  const tabs = views.length > 1 ? <PageTabs label={label + ' views'} items={views.map(view => ({ id: view.path, label: view.label, href: view.path }))} value={currentView(views, location.pathname)} /> : undefined;
  return <WorkflowContext.Provider value={{ title, tabs, secondaryTabs }}>{children}</WorkflowContext.Provider>;
}

/** The view a path belongs to: itself, or the deepest view it sits under (a sub-tab keeps its tab lit). */
function currentView(views: { path: string }[], pathname: string) {
  return views.filter(view => pathname === view.path || pathname.startsWith(view.path + '/'))
    .sort((a, b) => b.path.length - a.path.length)[0]?.path ?? pathname;
}

/** Keep old bookmarks, selected records and filters when their destination moves. */
export function PreserveRedirect({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={to + location.search + location.hash} replace />;
}

/** Stock Control tabs, with the open-exception count on the top-right of "Exceptions". */
export function StockControlNavigation({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(state => state.user);
  const { locationId, isAdminViewing } = useEffectiveLocation();
  const count = useInventoryExceptionCount(can(user?.role, 'inventory.read') && (user?.role !== 'SUPER_ADMIN' || isAdminViewing), user?.role === 'SUPER_ADMIN' ? locationId : null);
  const views = stockControlViews.map(view => view.path.endsWith('/exceptions') && count > 0 ? { ...view, label: (
    <>Exceptions
      {/* Sits on the tab's top-right corner without widening it; the tab bar leaves room so it isn't clipped. */}
      <span className="page-tab-badge" aria-label={`${count} need review`}>{count}</span>
    </>) } : view);
  return <WorkflowNavigation label="Inventory / Stock Control" views={views}>{children}</WorkflowNavigation>;
}

// Exceptions first: it is the only view that asks for action (the sidebar badge points here).
export const stockControlViews = [
  { label: 'Exceptions', path: '/inventory/stock-control/exceptions' },
  { label: 'Counts', path: '/inventory/stock-control/counts' },
  { label: 'Transfers', path: '/inventory/stock-control/transfers' },
  { label: 'Movement History', path: '/inventory/stock-control/movements' },
];

// Orders (the landing view) first, then the steps around them; suppliers are reference data, last.
// At most five tabs in a row: what a supplier owes sits under Suppliers, and Price Review under Products.
export const purchasingViews = [
  { label: 'Orders', path: '/inventory/purchasing/orders' },
  { label: 'Receive Delivery', path: '/inventory/purchasing/receive' },
  { label: 'Reorder Suggestions', path: '/inventory/purchasing/suggestions' },
  { label: 'Suppliers', path: '/inventory/purchasing/suppliers' },
];
export const SUPPLIER_CREDITS = '/inventory/purchasing/suppliers/credits';
const supplierViews = [
  { id: '/inventory/purchasing/suppliers', label: 'Suppliers', href: '/inventory/purchasing/suppliers' },
  { id: SUPPLIER_CREDITS, label: 'Credits Owed', href: SUPPLIER_CREDITS },
];

/** Purchasing tabs; the Suppliers tab carries its two views (the list, and what suppliers owe). */
export function PurchasingNavigation({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const suppliers = pathname === supplierViews[0].href || pathname.startsWith(supplierViews[0].href + '/');
  return <WorkflowNavigation label="Inventory / Purchasing" views={purchasingViews}
    secondaryTabs={suppliers ? <PageTabs label="Supplier views" items={supplierViews} value={pathname} /> : undefined}>{children}</WorkflowNavigation>;
}

export const PRICE_REVIEW = '/inventory/price-review';
export const SHARED_CATALOG = '/inventory/catalog';
/**
 * The Products page's tabs. Single Items and Packs are one page (`?view=`); Price Review is
 * its own; Shared Catalog shows for an owner of several stores.
 */
export function ProductTabs({ value }: { value: 'singles' | 'packs' | 'price-review' | 'catalog' }) {
  const shared = useAuthStore(state => managesSharedCatalog(state.user));
  return <PageTabs label="Products views" value={value} items={[
    { id: 'singles', label: 'Single Items', href: '/inventory' },
    { id: 'packs', label: 'Packs', href: '/inventory?view=packs' },
    { id: 'price-review', label: 'Price Review', href: PRICE_REVIEW },
    ...(shared ? [{ id: 'catalog', label: 'Shared Catalog', href: SHARED_CATALOG }] : []),
  ]} />;
}

export const accountViews = [
  { label: 'Gift Cards', path: '/customers/accounts/gift-cards' },
  { label: 'Store Credits', path: '/customers/accounts/store-credits' },
  { label: 'House Accounts', path: '/customers/accounts/house-accounts' },
];
export function TeamNavigation({ children }: { children: React.ReactNode }) {
  const role = useAuthStore(state => state.user?.role);
  const views = [
    ...(can(role, 'staff.manage') ? [{ label: 'Staff', path: '/team-time/staff' }] : []),
    { label: 'Shifts', path: '/team-time/shifts' },
    ...(can(role, 'payroll.manage') ? [{ label: 'Payroll', path: '/team-time/payroll' }] : []),
  ];
  return <WorkflowNavigation label="Team & Time" views={views}>{children}</WorkflowNavigation>;
}
export function ShiftRedirect() {
  const role = useAuthStore(state => state.user?.role);
  return <PreserveRedirect to={role === 'CASHIER' ? '/my-shift' : '/team-time/shifts'} />;
}
