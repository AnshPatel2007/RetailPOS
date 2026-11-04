import { SidebarUserFooter } from './common/SidebarUserFooter';
import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  Clock,
  BarChart3,
  Settings,
  Truck,
  TrendingUp,
  DollarSign,
  Shield,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  ArrowLeftRight,
  Ticket,
  ChevronDown,
  FileText,
  Wallet,
  Tag,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useThemeStore } from '@/store/themeStore';
import { useLayoutStore } from '@/store/layoutStore';
import { useStoreSettingsStore } from '@/store/storeSettingsStore';
import { cn } from '@/lib/utils';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import { useInventoryExceptionCount } from '@/hooks/useInventoryExceptionCount';
import { AdminViewBanner } from './AdminViewBanner';
import { OfflineIndicator } from './common/OfflineIndicator';
import { isTopFocusTrap, useFocusTrap } from '@/hooks/useFocusTrap';

interface LayoutProps {
  children: React.ReactNode;
}

interface NavItem {
  name: string;
  href: string;
  icon: React.ElementType;
  roles: string[];
}

interface NavGroup {
  name: string;
  icon: React.ElementType;
  roles: string[];
  children: NavItem[];
}

type NavEntry = NavItem | NavGroup;

const isGroup = (entry: NavEntry): entry is NavGroup => 'children' in entry;
const STOCK_CONTROL = '/inventory/stock-control';

const navigation: NavEntry[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER'] },
  { name: 'POS', href: '/pos', icon: ShoppingCart, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER'] },
  {
    name: 'Inventory',
    icon: Package,
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
    children: [
      { name: 'Products', href: '/inventory', icon: Package, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] },
      { name: 'Purchasing', href: '/inventory/purchasing', icon: Truck, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] },
      { name: 'Stock Control', href: '/inventory/stock-control', icon: ArrowLeftRight, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] },
    ],
  },
  { name: 'Promotions', href: '/promotions', icon: Tag, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] },
  { name: 'Lottery', href: '/lottery', icon: Ticket, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER'] },
  { name: 'Customers', icon: Users, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER'], children: [
    { name: 'Directory', href: '/customers', icon: Users, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER'] },
    { name: 'Accounts', href: '/customers/accounts', icon: Wallet, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] },
    { name: 'Customer Insights', href: '/customers/insights', icon: TrendingUp, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] },
  ] },
  { name: 'Team & Time', href: '/team-time', icon: Clock, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] },
  { name: 'My Shift', href: '/my-shift', icon: Clock, roles: ['CASHIER'] },
  {
    name: 'Insights',
    icon: BarChart3,
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
    children: [
      { name: 'Financial Management', href: '/financial', icon: DollarSign, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] },
      { name: 'Reports & Analysis', href: '/insights/reports', icon: BarChart3, roles: ['ADMIN', 'MANAGER'] },
      { name: 'Analytics', href: '/analytics', icon: TrendingUp, roles: ['SUPER_ADMIN'] },
      { name: 'Audit Log', href: '/audit-log', icon: FileText, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] },
    ],
  },
  { name: 'Settings', href: '/settings', icon: Settings, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER'] },
  { name: 'Admin Panel', href: '/admin', icon: Shield, roles: ['SUPER_ADMIN'] },
];

// All individual hrefs for exact matching
const allHrefs = navigation.flatMap(entry =>
  isGroup(entry) ? entry.children.map(c => c.href) : [entry.href]
);

function isPathActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  // Only allow startsWith for paths that don't collide
  // e.g. /admin/stores should match /admin, but /inventory-transfers should NOT match /inventory
  const hasCollision = allHrefs.some(other => other !== href && other.startsWith(href));
  if (hasCollision) return pathname === href;
  return pathname.startsWith(href);
}

function isGroupActive(pathname: string, group: NavGroup): boolean {
  return group.children.some(child => isPathActive(pathname, child.href));
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();
  const { isSidebarCollapsed, isMobileMenuOpen, toggleSidebar, setMobileMenuOpen } = useLayoutStore();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  // Show which store you're operating — mirrors the POS top bar
  const settingsStoreName = useStoreSettingsStore((s) => s.storeInfo.storeName);
  const { isAdminViewing, storeName: previewStoreName, locationId: effectiveLocationId } = useEffectiveLocation();
  const canReviewStock = !!user?.role && ['ADMIN', 'MANAGER'].includes(user.role) || (user?.role === 'SUPER_ADMIN' && isAdminViewing);
  const exceptionCount = useInventoryExceptionCount(canReviewStock, user?.role === 'SUPER_ADMIN' ? effectiveLocationId : null);
  const storeName = isAdminViewing ? previewStoreName || '' : settingsStoreName || user?.location?.name || '';

  // Full-screen routes with no sidebar/chrome (register + second screen)
  const isPOSPage = location.pathname === '/pos' || location.pathname === '/customer-display';
  const mobileMenuRef = useFocusTrap(isMobileMenuOpen && !isPOSPage);
  useEffect(() => {
    if (!isMobileMenuOpen || isPOSPage) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTopFocusTrap(mobileMenuRef.current)) {
        event.preventDefault(); event.stopImmediatePropagation(); setMobileMenuOpen(false);
      }
    };
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => { if (desktop.matches) setMobileMenuOpen(false); };
    closeOnDesktop();
    document.addEventListener('keydown', escape); desktop.addEventListener('change', closeOnDesktop);
    return () => { document.removeEventListener('keydown', escape); desktop.removeEventListener('change', closeOnDesktop); };
  }, [isMobileMenuOpen, isPOSPage, setMobileMenuOpen]);

  // Auto-expand groups that contain the active route
  useEffect(() => {
    const activeGroups = new Set<string>();
    navigation.forEach(entry => {
      if (isGroup(entry) && isGroupActive(location.pathname, entry)) {
        activeGroups.add(entry.name);
      }
    });
    setExpandedGroups(prev => {
      const merged = new Set(prev);
      activeGroups.forEach(g => merged.add(g));
      return merged;
    });
  }, [location.pathname]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname, setMobileMenuOpen]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const toggleGroup = (name: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const hasRole = (roles: string[]) => user?.role ? roles.includes(user.role) : false;

  // POS page: no sidebar, full screen
  if (isPOSPage) {
    return (
      <div className="h-screen bg-background">
        {children}
      </div>
    );
  }

  const exceptionLabel = `${exceptionCount} inventory exception${exceptionCount === 1 ? ' needs' : 's need'} review`;
  // The badge is visual; its meaning is the description of the link or button it sits in,
  // so their names stay "Inventory" / "Stock Control" for screen readers and keyboard search.
  const exceptionBadge = (className: string) => exceptionCount > 0 ? (
    <span className={cn('rounded-full bg-destructive px-1.5 text-[11px] font-semibold leading-5 text-destructive-foreground tabular-nums', className)}
      title={exceptionLabel} aria-hidden="true">{exceptionCount}</span>
  ) : null;
  const exceptionDescription = exceptionCount > 0 ? exceptionLabel : undefined;

  const renderNavItem = (item: NavItem, nested = false) => {
    if (!hasRole(item.roles)) return null;
    const isActive = isPathActive(location.pathname, item.href);
    const Icon = item.icon;

    return (
      <Link
        key={item.href}
        to={item.href}
        title={item.name}
        aria-label={item.name}
        aria-description={item.href === STOCK_CONTROL ? exceptionDescription : undefined}
        className={cn(
          'flex items-center rounded-md text-sm font-medium transition-colors',
          isSidebarCollapsed ? 'justify-center px-2 py-2.5' : nested ? 'px-3 py-2 pl-10' : 'px-3 py-2.5',
          isActive
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
        )}
      >
        <span className="relative shrink-0">
          <Icon className={cn('h-5 w-5', !isSidebarCollapsed && 'mr-3', nested && !isSidebarCollapsed && 'h-4 w-4')} />
          {/* Collapsed sidebar: a dot on the icon stands in for the count. */}
          {isSidebarCollapsed && item.href === STOCK_CONTROL && exceptionCount > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-card" aria-hidden="true" />}
        </span>
        {!isSidebarCollapsed && <span className="truncate">{item.name}</span>}
        {item.href === STOCK_CONTROL && !isSidebarCollapsed && exceptionBadge('ml-auto')}
      </Link>
    );
  };

  const renderNavGroup = (group: NavGroup) => {
    if (!hasRole(group.roles)) return null;
    const visibleChildren = group.children.filter(c => hasRole(c.roles));
    if (visibleChildren.length === 0) return null;

    const isExpanded = expandedGroups.has(group.name);
    const groupActive = isGroupActive(location.pathname, group);
    const Icon = group.icon;

    if (isSidebarCollapsed) {
      // When collapsed, show the first child's link with group icon
      return visibleChildren.map(child => renderNavItem(child));
    }

    return (
      <div key={group.name}>
        <button
          onClick={() => toggleGroup(group.name)}
          aria-label={group.name}
          aria-description={!isExpanded && group.children.some(child => child.href === STOCK_CONTROL) ? exceptionDescription : undefined}
          className={cn(
            'w-full flex items-center rounded-md text-sm font-medium transition-colors px-3 py-2.5',
            groupActive
              ? 'text-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          )}
        >
          <Icon className="h-5 w-5 shrink-0 mr-3" />
          <span className="truncate flex-1 text-left">{group.name}</span>
          {/* While the group is closed its exception count shows here; open, it moves to Stock Control. */}
          {!isExpanded && group.children.some(child => child.href === STOCK_CONTROL) && exceptionBadge('mr-2')}
          <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', isExpanded && 'rotate-180')} />
        </button>
        {isExpanded && (
          <div className="mt-0.5 space-y-0.5">
            {visibleChildren.map(child => renderNavItem(child, true))}
          </div>
        )}
      </div>
    );
  };

  const sidebarContent = (
    <>
      {/* Logo + collapse toggle */}
      <div className={cn(
        'min-h-16 py-2 flex flex-wrap items-center border-b border-border shrink-0',
        isSidebarCollapsed ? 'justify-center px-2' : 'justify-between gap-x-1 gap-y-0.5 px-3'
      )}>
        {isSidebarCollapsed ? (
          <span className="text-lg font-bold text-primary">P</span>
        ) : (
          <>
            <div className="min-w-0">
              <p className="text-base font-semibold text-primary whitespace-nowrap">POS System</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <OfflineIndicator variant="badge" compact showDetails tooltipAlign="left" />
              <button
                onClick={toggleSidebar}
                className="hidden lg:flex p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground"
                title="Collapse sidebar"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
            {storeName && <p className="basis-full text-xs leading-5 text-muted-foreground break-words" data-sidebar-store-name>{storeName}</p>}
          </>
        )}
      </div>

      {/* Expand button when collapsed (in header area) */}
      {isSidebarCollapsed && (
        <div className="hidden lg:flex justify-center py-2 border-b border-border">
          <button
            onClick={toggleSidebar}
            className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground"
            title="Expand sidebar"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {navigation.map(entry =>
          isGroup(entry) ? renderNavGroup(entry) : (hasRole(entry.roles) ? renderNavItem(entry) : null)
        )}
      </nav>

      <SidebarUserFooter name={[user?.firstName, user?.lastName].filter(Boolean).join(' ')} role={user?.role || ''} theme={theme} onToggleTheme={toggleTheme} onLogout={handleLogout} collapsed={isSidebarCollapsed} />
    </>
  );

  return (
    <div className="flex h-screen bg-background">
      {/* Mobile menu button */}
      <button
        onClick={() => setMobileMenuOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-50 p-2 rounded-md bg-card border border-border shadow-sm hover:bg-accent transition-colors"
        title="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile overlay */}
      {isMobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar — mobile drawer */}
      <aside
        ref={mobileMenuRef}
        role={isMobileMenuOpen ? 'dialog' : undefined}
        aria-label={isMobileMenuOpen ? 'Main menu' : undefined}
        aria-modal={isMobileMenuOpen ? true : undefined}
        aria-hidden={!isMobileMenuOpen}
        className={cn(
          'lg:hidden fixed inset-y-0 left-0 z-50 w-72 bg-background border-r border-border flex flex-col transition-transform duration-300 shadow-2xl',
          isMobileMenuOpen ? 'visible translate-x-0' : 'invisible pointer-events-none -translate-x-full'
        )}
      >
        <button
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Close menu"
          className="absolute top-4 right-4 p-1.5 rounded-md hover:bg-accent bg-muted"
        >
          <X className="h-5 w-5" />
        </button>
        {sidebarContent}
      </aside>

      {/* Sidebar — desktop */}
      <aside
        className={cn(
          'hidden lg:flex flex-col bg-card border-r border-border transition-all duration-300',
          isSidebarCollapsed ? 'w-16' : 'w-60'
        )}
      >
        {sidebarContent}
      </aside>

      {/* Main content */}
      <main className="management-content flex-1 min-w-0 overflow-auto lg:ml-0">
        <div className="lg:hidden h-12" /> {/* Spacer for mobile menu button */}
        {isAdminViewing && <AdminViewBanner storeName={previewStoreName || 'Selected store'} />}
        {children}
      </main>
    </div>
  );
};
