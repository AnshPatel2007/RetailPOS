import { createContext, useContext } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { can } from '@/lib/capabilities';
import { PageTabs } from './PageTabs';

interface WorkflowContextValue {
  title: string;
  tabs: React.ReactNode;
  secondaryTabs?: React.ReactNode;
}
const WorkflowContext = createContext<WorkflowContextValue | null>(null);
export const useWorkflowNavigation = () => useContext(WorkflowContext);

export function WorkflowNavigation({ label, views, children, secondaryTabs }: { label: string; views: { label: string; path: string }[]; children: React.ReactNode; secondaryTabs?: React.ReactNode }) {
  const location = useLocation();
  const title = label === 'Customers / Accounts' ? 'Customer Accounts' : label.split(' / ').slice(-1)[0] || label;
  const tabs = views.length > 1 ? <PageTabs label={label + ' views'} items={views.map(view => ({ id: view.path, label: view.label, href: view.path }))} value={location.pathname} /> : undefined;
  return <WorkflowContext.Provider value={{ title, tabs, secondaryTabs }}>{children}</WorkflowContext.Provider>;
}

/** Keep old bookmarks, selected records and filters when their destination moves. */
export function PreserveRedirect({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={to + location.search + location.hash} replace />;
}

export const stockControlViews = [
  { label: 'Transfers', path: '/inventory/stock-control/transfers' },
  { label: 'Counts', path: '/inventory/stock-control/counts' },
  { label: 'Movement History', path: '/inventory/stock-control/movements' },
];

export const purchasingViews = [
  { label: 'Orders', path: '/inventory/purchasing/orders' },
  { label: 'Suppliers', path: '/inventory/purchasing/suppliers' },
  { label: 'Reorder Suggestions', path: '/inventory/purchasing/suggestions' },
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
