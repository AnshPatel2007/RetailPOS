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
  LogOut,
  Moon,
  Sun,
  Truck,
  TrendingUp,
  DollarSign,
  Shield,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  Gift,
  ArrowLeftRight,
  ClipboardCheck,
  Ticket,
  ChevronDown,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useThemeStore } from '@/store/themeStore';
import { useLayoutStore } from '@/store/layoutStore';
import { cn } from '@/lib/utils';
import { OfflineIndicator } from './common/OfflineIndicator';

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

const navigation: NavEntry[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER'] },
  { name: 'POS', href: '/pos', icon: ShoppingCart, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER'] },
  {
    name: 'Inventory',
    icon: Package,
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
    children: [
      { name: 'Products', href: '/inventory', icon: Package, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] },
      { name: 'Suppliers', href: '/suppliers', icon: Truck, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] },
      { name: 'Transfers', href: '/inventory-transfers', icon: ArrowLeftRight, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] },
      { name: 'Cycle Count', href: '/cycle-counts', icon: ClipboardCheck, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] },
    ],
  },
  {
    name: 'Sales',
    icon: Gift,
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER'],
    children: [
      { name: 'Gift Cards', href: '/gift-cards', icon: Gift, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] },
      { name: 'Lottery', href: '/lottery', icon: Ticket, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER'] },
    ],
  },
  { name: 'Customers', href: '/customers', icon: Users, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER'] },
  { name: 'Shifts', href: '/shifts', icon: Clock, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER'] },
  {
    name: 'Insights',
    icon: BarChart3,
    roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'],
    children: [
      { name: 'Financial', href: '/financial', icon: DollarSign, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] },
      { name: 'Reports', href: '/reports', icon: BarChart3, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] },
      { name: 'Analytics', href: '/analytics', icon: TrendingUp, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] },
    ],
  },
  { name: 'Settings', href: '/settings', icon: Settings, roles: ['SUPER_ADMIN', 'ADMIN'] },
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

  const isPOSPage = location.pathname === '/pos';

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

  const renderNavItem = (item: NavItem, nested = false) => {
    if (!hasRole(item.roles)) return null;
    const isActive = isPathActive(location.pathname, item.href);
    const Icon = item.icon;

    return (
      <Link
        key={item.href}
        to={item.href}
        title={isSidebarCollapsed ? item.name : undefined}
        className={cn(
          'flex items-center rounded-md text-sm font-medium transition-colors',
          isSidebarCollapsed ? 'justify-center px-2 py-2.5' : nested ? 'px-3 py-2 pl-10' : 'px-3 py-2.5',
          isActive
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
        )}
      >
        <Icon className={cn('h-5 w-5 shrink-0', !isSidebarCollapsed && 'mr-3', nested && !isSidebarCollapsed && 'h-4 w-4')} />
        {!isSidebarCollapsed && <span className="truncate">{item.name}</span>}
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
          className={cn(
            'w-full flex items-center rounded-md text-sm font-medium transition-colors px-3 py-2.5',
            groupActive
              ? 'text-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          )}
        >
          <Icon className="h-5 w-5 shrink-0 mr-3" />
          <span className="truncate flex-1 text-left">{group.name}</span>
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
        'h-16 flex items-center border-b border-border shrink-0',
        isSidebarCollapsed ? 'justify-center px-2' : 'justify-between px-6'
      )}>
        {isSidebarCollapsed ? (
          <span className="text-lg font-bold text-primary">P</span>
        ) : (
          <>
            <h1 className="text-base font-bold text-primary whitespace-nowrap">POS System</h1>
            <div className="flex items-center gap-1 shrink-0">
              <OfflineIndicator variant="badge" showDetails />
              <button
                onClick={toggleSidebar}
                className="hidden lg:flex p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground"
                title="Collapse sidebar"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
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

      {/* User info */}
      <div className="p-3 border-t border-border shrink-0">
        {isSidebarCollapsed ? (
          <div className="flex flex-col items-center gap-2">
            <button onClick={toggleTheme} className="p-2 rounded-md hover:bg-accent transition-colors" title="Toggle theme">
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>
            <button onClick={handleLogout} className="p-2 rounded-md hover:bg-accent transition-colors" title="Logout">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{user?.firstName} {user?.lastName}</p>
              <p className="text-xs text-muted-foreground">{user?.role}</p>
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={toggleTheme} className="p-2 rounded-md hover:bg-accent transition-colors" title="Toggle theme">
                {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </button>
              <button onClick={handleLogout} className="p-2 rounded-md hover:bg-accent transition-colors" title="Logout">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
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
        className={cn(
          'lg:hidden fixed inset-y-0 left-0 z-50 w-72 bg-background border-r border-border flex flex-col transition-transform duration-300 shadow-2xl',
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <button
          onClick={() => setMobileMenuOpen(false)}
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
          isSidebarCollapsed ? 'w-16' : 'w-64'
        )}
      >
        {sidebarContent}
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto lg:ml-0">
        <div className="lg:hidden h-12" /> {/* Spacer for mobile menu button */}
        {children}
      </main>
    </div>
  );
};
