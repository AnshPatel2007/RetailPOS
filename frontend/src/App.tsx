import React, { Suspense, useEffect, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from './store/authStore';
import { useThemeStore } from './store/themeStore';
import { useStoreSettingsStore } from './store/storeSettingsStore';
import { useEffectiveLocation } from './hooks/useEffectiveLocation';
import { Layout } from './components/Layout';
import { LegacyInsightsRedirect } from './pages/InsightsWorkspace';
import { ManagerApprovalDialog } from './components/ManagerApprovalDialog';
import { GlobalAssistant } from './components/assistant/GlobalAssistant';
import { RegisterLockLayer } from './components/register/RegisterLock';
import { AppUpdateNotice } from './components/common/AppUpdateNotice';
import { WorkflowNavigation, PreserveRedirect, StockControlNavigation, purchasingViews, accountViews, TeamNavigation, ShiftRedirect } from './components/common/WorkflowNavigation';
import { changeSessionGeneration } from './services/sessionGeneration';

// Eager-load Login (needed immediately) and AdminLayout (small)
import { Login } from './pages/Login';
import { AdminLayout } from './components/AdminLayout';

import { Analytics as VercelAnalytics } from '@vercel/analytics/react';
import { Spinner } from '@/components/ui/LoadingState';
import { AccessDenied, NotFound } from './components/common/StatusPage';

// Lazy-load all page components
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const MyStores = lazy(() => import('./pages/MyStores').then(m => ({ default: m.MyStores })));
const POS = lazy(() => import('./pages/POS').then(m => ({ default: m.POS })));
const Inventory = lazy(() => import('./pages/Inventory').then(m => ({ default: m.Inventory })));
const Customers = lazy(() => import('./pages/Customers').then(m => ({ default: m.Customers })));
const Shifts = lazy(() => import('./pages/Shifts').then(m => ({ default: m.Shifts })));
const InsightsWorkspace = lazy(() => import('./pages/InsightsWorkspace').then(m => ({ default: m.InsightsWorkspace })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const Suppliers = lazy(() => import('./pages/Suppliers').then(m => ({ default: m.Suppliers })));
const Reports = lazy(() => import('./pages/Reports').then(m => ({ default: m.Reports })));
const Financial = lazy(() => import('./pages/Financial').then(m => ({ default: m.Financial })));
const Reconciliation = lazy(() => import('./pages/Reconciliation').then(m => ({ default: m.Reconciliation })));
const BackgroundJobs = lazy(() => import('./pages/BackgroundJobs').then(m => ({ default: m.BackgroundJobs })));
const GiftCards = lazy(() => import('./pages/GiftCards').then(m => ({ default: m.GiftCards })));
const InventoryTransfers = lazy(() => import('./pages/InventoryTransfers').then(m => ({ default: m.InventoryTransfers })));
const InventoryMovements = lazy(() => import('./pages/InventoryMovements').then(m => ({ default: m.InventoryMovements })));
const CycleCount = lazy(() => import('./pages/CycleCount').then(m => ({ default: m.CycleCount })));
const InventoryExceptions = lazy(() => import('./pages/InventoryExceptions').then(m => ({ default: m.InventoryExceptions })));
const Lottery = lazy(() => import('./pages/Lottery').then(m => ({ default: m.Lottery })));
const AuditLog = lazy(() => import('./pages/AuditLog').then(m => ({ default: m.AuditLog })));
const StoreCredits = lazy(() => import('./pages/StoreCredits').then(m => ({ default: m.StoreCredits })));
const Promotions = lazy(() => import('./pages/Promotions').then(m => ({ default: m.Promotions })));
const SuggestedOrders = lazy(() => import('./pages/SuggestedOrders').then(m => ({ default: m.SuggestedOrders })));
const PriceReview = lazy(() => import('./pages/PriceReview'));
const ReceiveDelivery = lazy(() => import('./pages/ReceiveDelivery'));
const CustomerDisplay = lazy(() => import('./pages/CustomerDisplay').then(m => ({ default: m.CustomerDisplay })));
const HouseAccounts = lazy(() => import('./pages/HouseAccounts').then(m => ({ default: m.HouseAccounts })));
const Developers = lazy(() => import('./pages/Developers').then(m => ({ default: m.Developers })));
const Payroll = lazy(() => import('./pages/Payroll').then(m => ({ default: m.Payroll })));
const Team = lazy(() => import('./pages/Team').then(m => ({ default: m.Team })));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const StoreManagement = lazy(() => import('./pages/admin/StoreManagement').then(m => ({ default: m.StoreManagement })));
const UserManagement = lazy(() => import('./pages/admin/UserManagement').then(m => ({ default: m.UserManagement })));
const ResetPassword = lazy(() => import('./pages/ResetPassword').then(m => ({ default: m.ResetPassword })));

const MANAGER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'];

const LoadingSpinner: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center">
    <Spinner size="lg" />
  </div>
);

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuthStore();
  if (isLoading) return <LoadingSpinner />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const SmartRedirect: React.FC = () => {
  const { user, isAuthenticated, isLoading } = useAuthStore();
  if (isLoading) return <LoadingSpinner />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role === 'SUPER_ADMIN') return <Navigate to="/admin" replace />;
  return <Navigate to="/dashboard" replace />;
};

const RoleRoute: React.FC<{
  children: React.ReactNode;
  allowedRoles: string[];
}> = ({ children, allowedRoles }) => {
  const { user, isLoading } = useAuthStore();
  if (isLoading) return <LoadingSpinner />;
  // Denied pages keep the menu so people can carry on somewhere they do have access.
  if (!user || !allowedRoles.includes(user.role)) return <Layout><AccessDenied /></Layout>;
  return <>{children}</>;
};

// Helper to reduce route boilerplate
const PageRoute: React.FC<{
  page: React.ReactNode;
  roles?: string[];
  layout?: 'main' | 'admin';
}> = ({ page, roles, layout = 'main' }) => {
  const user = useAuthStore(state => state.user);
  const { locationId, isReadOnly } = useEffectiveLocation();
  const scopeKey = [user?.id, user?.role, locationId, isReadOnly].join(':');
  const allowed = !roles || (!!user && roles.includes(user.role));
  // The platform shell is only for people allowed in; everyone else sees the denial in their own menu.
  const LayoutComponent = layout === 'admin' && allowed ? AdminLayout : Layout;
  return (
    <ProtectedRoute>
      <LayoutComponent>
        <Suspense fallback={<LoadingSpinner />}>
          {allowed ? <React.Fragment key={scopeKey}>{page}</React.Fragment> : <AccessDenied />}
        </Suspense>
      </LayoutComponent>
    </ProtectedRoute>
  );
};

function AnalyticsEntry() {
  const role = useAuthStore(state => state.user?.role);
  // The platform administrator gets the same reports as store owners, with a store picker.
  return role === 'SUPER_ADMIN' ? <Reports /> : <LegacyInsightsRedirect source="analytics" />;
}

function App() {
  const { loadUser, isAuthenticated, user } = useAuthStore();
  const { theme, setTheme } = useThemeStore();
  const { fetchSettings } = useStoreSettingsStore();
  const { locationId: settingsLocationId } = useEffectiveLocation();

  useEffect(() => {
    loadUser();
  }, []);

  useEffect(() => {
    const changedInAnotherTab = (event: StorageEvent) => {
      if (event.storageArea === localStorage && event.key === 'user' && event.oldValue !== event.newValue) {
        changeSessionGeneration();
        useAuthStore.setState({ user: null, token: null, isAuthenticated: false, isLoading: true });
        window.location.reload();
      }
    };
    window.addEventListener('storage', changedInAnotherTab);
    return () => window.removeEventListener('storage', changedInAnotherTab);
  }, []);

  // Fetch shared store settings once user is authenticated
  useEffect(() => {
    if (isAuthenticated && user) fetchSettings(settingsLocationId || undefined);
  }, [isAuthenticated, user?.id, settingsLocationId, fetchSettings]);

  useEffect(() => {
    setTheme(theme);
  }, [setTheme, theme]);

  return (
    <BrowserRouter>
      <ManagerApprovalDialog />
      <GlobalAssistant />
      <RegisterLockLayer />
      <AppUpdateNotice />
      {import.meta.env.PROD && <VercelAnalytics />}
      <Toaster
        position="top-right"
        containerClassName="app-notifications"
        toastOptions={{
          duration: 4000,
          style: {
            background: 'hsl(var(--card))',
            color: 'hsl(var(--card-foreground))',
            border: '1px solid hsl(var(--border))',
          },
        }}
      />
      <Routes>
        <Route path="/login" element={isAuthenticated ? <SmartRedirect /> : <Login />} />
        <Route
          path="/reset-password"
          element={
            <Suspense fallback={<LoadingSpinner />}>
              <ResetPassword />
            </Suspense>
          }
        />

        {/* Main routes */}
        <Route path="/dashboard" element={<PageRoute page={<Dashboard />} />} />
        <Route path="/stores" element={<PageRoute roles={['ADMIN']} page={<MyStores />} />} />
        <Route path="/pos" element={<PageRoute page={<POS />} />} />
        <Route path="/inventory" element={<PageRoute page={<Inventory />} roles={MANAGER_ROLES} />} />
        <Route path="/customers" element={<PageRoute page={<Customers view="directory" />} />} />
        <Route path="/customers/insights" element={<PageRoute roles={MANAGER_ROLES} page={<Customers key="insights" view="insights" />} />} />
        <Route path="/customers/accounts" element={<PreserveRedirect to="/customers/accounts/gift-cards" />} />
        {([['gift-cards', <GiftCards />], ['store-credits', <StoreCredits />], ['house-accounts', <HouseAccounts />]] as const).map(([view, page]) => <Route key={view} path={'/customers/accounts/' + view} element={<PageRoute roles={MANAGER_ROLES} page={<WorkflowNavigation label="Customers / Accounts" views={accountViews}>{page}</WorkflowNavigation>} />} />)}
        <Route path="/shifts" element={<ProtectedRoute><ShiftRedirect /></ProtectedRoute>} />
        <Route path="/my-shift" element={<PageRoute page={<Shifts />} />} />
        <Route path="/team-time" element={<PreserveRedirect to="/team-time/shifts" />} />
        <Route path="/team-time/shifts" element={<PageRoute roles={MANAGER_ROLES} page={<TeamNavigation><Shifts /></TeamNavigation>} />} />
        <Route path="/team-time/staff" element={<PageRoute roles={['ADMIN']} page={<TeamNavigation><Team /></TeamNavigation>} />} />
        <Route path="/team-time/payroll" element={<PageRoute roles={['ADMIN']} page={<TeamNavigation><Payroll /></TeamNavigation>} />} />
        <Route path="/reports" element={<ProtectedRoute><RoleRoute allowedRoles={['ADMIN', 'MANAGER']}><LegacyInsightsRedirect source="reports" /></RoleRoute></ProtectedRoute>} />
        <Route path="/insights/reports" element={<PreserveRedirect to="/insights/reports/overview" />} />
        <Route path="/insights/reports/:section" element={<PageRoute roles={['ADMIN', 'MANAGER']} page={<InsightsWorkspace />} />} />
        <Route path="/settings" element={<PageRoute page={<Settings />} />} />
        <Route path="/suppliers" element={<PreserveRedirect to="/inventory/purchasing/suppliers" />} />
        <Route path="/analytics" element={<PageRoute page={<AnalyticsEntry />} roles={MANAGER_ROLES} />} />
        <Route path="/financial" element={<PageRoute page={<Financial />} roles={MANAGER_ROLES} />} />
        <Route path="/financial/reconciliation" element={<PageRoute page={<Reconciliation />} roles={['ADMIN']} />} />
        <Route path="/settings/jobs" element={<PageRoute page={<BackgroundJobs />} roles={['ADMIN','SUPER_ADMIN']} />} />
        <Route path="/gift-cards" element={<PreserveRedirect to="/customers/accounts/gift-cards" />} />
        <Route path="/inventory-transfers" element={<PreserveRedirect to="/inventory/stock-control/transfers" />} />
        <Route path="/cycle-counts" element={<PreserveRedirect to="/inventory/stock-control/counts" />} />
        <Route path="/inventory/stock-control" element={<PreserveRedirect to="/inventory/stock-control/exceptions" />} />
        {[["transfers", <InventoryTransfers />], ["counts", <CycleCount />], ["exceptions", <InventoryExceptions />], ["movements", <InventoryMovements />]].map(([view, page]) => <Route key={String(view)} path={'/inventory/stock-control/' + view} element={<PageRoute roles={MANAGER_ROLES} page={<StockControlNavigation>{page}</StockControlNavigation>} />} />)}
        <Route path="/lottery" element={<PageRoute page={<Lottery />} />} />
        <Route path="/audit-log" element={<PageRoute page={<AuditLog />} roles={MANAGER_ROLES} />} />
        <Route path="/store-credits" element={<PreserveRedirect to="/customers/accounts/store-credits" />} />
        <Route path="/promotions" element={<PageRoute page={<Promotions />} roles={MANAGER_ROLES} />} />
        <Route path="/suggested-orders" element={<PreserveRedirect to="/inventory/purchasing/suggestions" />} />
        <Route path="/inventory/purchasing" element={<PreserveRedirect to="/inventory/purchasing/orders" />} />
        {([['orders', <Suppliers key="orders" view="orders" />], ['receive', <ReceiveDelivery />], ['suppliers', <Suppliers key="suppliers" view="suppliers" />], ['suggestions', <SuggestedOrders />], ['price-review', <PriceReview />]] as const).map(([view, page]) => <Route key={view} path={'/inventory/purchasing/' + view} element={<PageRoute roles={MANAGER_ROLES} page={<WorkflowNavigation label="Inventory / Purchasing" views={purchasingViews}>{page}</WorkflowNavigation>} />} />)}
        <Route path="/customer-display" element={<PageRoute page={<CustomerDisplay />} />} />
        <Route path="/house-accounts" element={<PreserveRedirect to="/customers/accounts/house-accounts" />} />
        <Route path="/developers" element={<PreserveRedirect to="/admin/integrations" />} />
        <Route path="/admin/integrations" element={<PageRoute layout="admin" page={<Developers />} roles={['SUPER_ADMIN']} />} />
        <Route path="/payroll" element={<PreserveRedirect to="/team-time/payroll" />} />
        <Route path="/admin/payroll" element={<Navigate to="/admin" replace />} />
        <Route path="/team" element={<PreserveRedirect to="/team-time/staff" />} />

        {/* Admin routes — SUPER_ADMIN only */}
        <Route path="/admin" element={<PageRoute page={<AdminDashboard />} layout="admin" roles={['SUPER_ADMIN']} />} />
        <Route path="/admin/stores" element={<PageRoute page={<StoreManagement />} layout="admin" roles={['SUPER_ADMIN']} />} />
        <Route path="/admin/users" element={<PageRoute page={<UserManagement />} layout="admin" roles={['SUPER_ADMIN']} />} />
        <Route path="/admin/reports" element={<Navigate to="/admin" replace />} />
        {/* Retired pages — redirect to their consolidated homes */}
        <Route path="/admin/settings" element={<Navigate to="/settings" replace />} />
        <Route path="/admin/employee-sales" element={<Navigate to="/admin" replace />} />

        <Route path="/" element={<SmartRedirect />} />
        <Route path="*" element={<PageRoute page={<NotFound />} />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
