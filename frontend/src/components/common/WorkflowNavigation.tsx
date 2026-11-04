import { createContext, useContext } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { can } from '@/lib/capabilities';
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
  const tabs = views.length > 1 ? <PageTabs label={label + ' views'} items={views.map(view => ({ id: view.path, label: view.label, href: view.path }))} value={location.pathname} /> : undefined;
  return <WorkflowContext.Provider value={{ title, tabs, secondaryTabs }}>{children}</WorkflowContext.Provider>;
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
      {/* In-flow (the tab bar scrolls and would clip an absolutely placed badge); self-start lifts it to the top-right. */}
      <span className="-mr-1 -mt-2 self-start min-w-[1.25rem] rounded-full bg-destructive px-1 text-center text-[11px] font-semibold leading-5 text-destructive-foreground tabular-nums"
        aria-label={`${count} need review`}>{count}</span>
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
export const purchasingViews = [
  { label: 'Orders', path: '/inventory/purchasing/orders' },
  { label: 'Reorder Suggestions', path: '/inventory/purchasing/suggestions' },
  { label: 'Price Review', path: '/inventory/purchasing/price-review' },
  { label: 'Suppliers', path: '/inventory/purchasing/suppliers' },
];

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
