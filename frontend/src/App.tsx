import React, { Suspense, useEffect, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from './store/authStore';
import { useThemeStore } from './store/themeStore';
import { useStoreSettingsStore } from './store/storeSettingsStore';
import { Layout } from './components/Layout';

// Eager-load Login (needed immediately) and AdminLayout (small)
import { Login } from './pages/Login';
import { AdminLayout } from './components/AdminLayout';

// Lazy-load all page components
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const POS = lazy(() => import('./pages/POS').then(m => ({ default: m.POS })));
const Inventory = lazy(() => import('./pages/Inventory').then(m => ({ default: m.Inventory })));
const Customers = lazy(() => import('./pages/Customers').then(m => ({ default: m.Customers })));
const Shifts = lazy(() => import('./pages/Shifts').then(m => ({ default: m.Shifts })));
const Reports = lazy(() => import('./pages/Reports').then(m => ({ default: m.Reports })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const Suppliers = lazy(() => import('./pages/Suppliers').then(m => ({ default: m.Suppliers })));
const Analytics = lazy(() => import('./pages/Analytics').then(m => ({ default: m.Analytics })));
const Financial = lazy(() => import('./pages/Financial').then(m => ({ default: m.Financial })));
const GiftCards = lazy(() => import('./pages/GiftCards').then(m => ({ default: m.GiftCards })));
const InventoryTransfers = lazy(() => import('./pages/InventoryTransfers').then(m => ({ default: m.InventoryTransfers })));
const CycleCount = lazy(() => import('./pages/CycleCount').then(m => ({ default: m.CycleCount })));
const Lottery = lazy(() => import('./pages/Lottery').then(m => ({ default: m.Lottery })));
const AuditLog = lazy(() => import('./pages/AuditLog').then(m => ({ default: m.AuditLog })));
const StoreCredits = lazy(() => import('./pages/StoreCredits').then(m => ({ default: m.StoreCredits })));
const Promotions = lazy(() => import('./pages/Promotions').then(m => ({ default: m.Promotions })));
const SuggestedOrders = lazy(() => import('./pages/SuggestedOrders').then(m => ({ default: m.SuggestedOrders })));
const CustomerDisplay = lazy(() => import('./pages/CustomerDisplay').then(m => ({ default: m.CustomerDisplay })));
const HouseAccounts = lazy(() => import('./pages/HouseAccounts').then(m => ({ default: m.HouseAccounts })));
const Developers = lazy(() => import('./pages/Developers').then(m => ({ default: m.Developers })));
const Team = lazy(() => import('./pages/Team').then(m => ({ default: m.Team })));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const StoreManagement = lazy(() => import('./pages/admin/StoreManagement').then(m => ({ default: m.StoreManagement })));
const UserManagement = lazy(() => import('./pages/admin/UserManagement').then(m => ({ default: m.UserManagement })));
const AdminReports = lazy(() => import('./pages/admin/AdminReports').then(m => ({ default: m.AdminReports })));
const ResetPassword = lazy(() => import('./pages/ResetPassword').then(m => ({ default: m.ResetPassword })));

const MANAGER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'];

const LoadingSpinner: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="animate-spin h-12 w-12 border-4 border-primary border-t-transparent rounded-full" />
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
  if (!user || !allowedRoles.includes(user.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-6xl font-bold text-destructive mb-4">403</h1>
          <p className="text-xl text-muted-foreground mb-4">Access Denied</p>
          <p className="text-muted-foreground">You don't have permission to access this page.</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
};

// Helper to reduce route boilerplate
const PageRoute: React.FC<{
  page: React.ReactNode;
  roles?: string[];
  layout?: 'main' | 'admin';
}> = ({ page, roles, layout = 'main' }) => {
  const LayoutComponent = layout === 'admin' ? AdminLayout : Layout;
  const content = (
    <ProtectedRoute>
      <LayoutComponent>
        <Suspense fallback={<LoadingSpinner />}>
          {page}
        </Suspense>
      </LayoutComponent>
    </ProtectedRoute>
  );
  if (roles) {
    return (
      <ProtectedRoute>
        <RoleRoute allowedRoles={roles}>
          <LayoutComponent>
            <Suspense fallback={<LoadingSpinner />}>
              {page}
            </Suspense>
          </LayoutComponent>
        </RoleRoute>
      </ProtectedRoute>
    );
  }
  return content;
};

function App() {
  const { loadUser, isAuthenticated, user } = useAuthStore();
  const { theme, setTheme } = useThemeStore();
  const { fetchSettings, isLoaded: settingsLoaded } = useStoreSettingsStore();

  useEffect(() => {
    loadUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch shared store settings once user is authenticated
  useEffect(() => {
    if (isAuthenticated && user && !settingsLoaded) {
      fetchSettings();
    }
  }, [isAuthenticated, user, settingsLoaded, fetchSettings]);

  useEffect(() => {
    setTheme(theme);
  }, [setTheme, theme]);

  return (
    <BrowserRouter>
      <Toaster
        position="top-right"
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
        <Route path="/pos" element={<PageRoute page={<POS />} />} />
        <Route path="/inventory" element={<PageRoute page={<Inventory />} roles={MANAGER_ROLES} />} />
        <Route path="/customers" element={<PageRoute page={<Customers />} />} />
        <Route path="/shifts" element={<PageRoute page={<Shifts />} />} />
        <Route path="/reports" element={<PageRoute page={<Reports />} roles={MANAGER_ROLES} />} />
        <Route path="/settings" element={<PageRoute page={<Settings />} />} />
        <Route path="/suppliers" element={<PageRoute page={<Suppliers />} roles={MANAGER_ROLES} />} />
        <Route path="/analytics" element={<PageRoute page={<Analytics />} roles={MANAGER_ROLES} />} />
        <Route path="/financial" element={<PageRoute page={<Financial />} roles={MANAGER_ROLES} />} />
        <Route path="/gift-cards" element={<PageRoute page={<GiftCards />} roles={MANAGER_ROLES} />} />
        <Route path="/inventory-transfers" element={<PageRoute page={<InventoryTransfers />} roles={MANAGER_ROLES} />} />
        <Route path="/cycle-counts" element={<PageRoute page={<CycleCount />} roles={MANAGER_ROLES} />} />
        <Route path="/lottery" element={<PageRoute page={<Lottery />} />} />
        <Route path="/audit-log" element={<PageRoute page={<AuditLog />} roles={MANAGER_ROLES} />} />
        <Route path="/store-credits" element={<PageRoute page={<StoreCredits />} roles={MANAGER_ROLES} />} />
        <Route path="/promotions" element={<PageRoute page={<Promotions />} roles={MANAGER_ROLES} />} />
        <Route path="/suggested-orders" element={<PageRoute page={<SuggestedOrders />} roles={MANAGER_ROLES} />} />
        <Route path="/customer-display" element={<PageRoute page={<CustomerDisplay />} />} />
        <Route path="/house-accounts" element={<PageRoute page={<HouseAccounts />} roles={MANAGER_ROLES} />} />
        <Route path="/developers" element={<PageRoute page={<Developers />} roles={['SUPER_ADMIN', 'ADMIN']} />} />
        <Route path="/team" element={<PageRoute page={<Team />} roles={['ADMIN']} />} />

        {/* Admin routes — SUPER_ADMIN only */}
        <Route path="/admin" element={<PageRoute page={<AdminDashboard />} layout="admin" roles={['SUPER_ADMIN']} />} />
        <Route path="/admin/stores" element={<PageRoute page={<StoreManagement />} layout="admin" roles={['SUPER_ADMIN']} />} />
        <Route path="/admin/users" element={<PageRoute page={<UserManagement />} layout="admin" roles={['SUPER_ADMIN']} />} />
        <Route path="/admin/reports" element={<PageRoute page={<AdminReports />} layout="admin" roles={['SUPER_ADMIN']} />} />
        {/* Retired pages — redirect to their consolidated homes */}
        <Route path="/admin/settings" element={<Navigate to="/settings" replace />} />
        <Route path="/admin/employee-sales" element={<Navigate to="/reports" replace />} />

        <Route path="/" element={<SmartRedirect />} />
        <Route
          path="*"
          element={
            <div className="min-h-screen flex items-center justify-center">
              <div className="text-center">
                <h1 className="text-6xl font-bold text-muted-foreground mb-4">404</h1>
                <p className="text-xl text-muted-foreground">Page not found</p>
              </div>
            </div>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
