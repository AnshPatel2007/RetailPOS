import { SidebarUserFooter } from './common/SidebarUserFooter';
import React, { useState, useEffect } from 'react';
import { useFocusTrap, isTopFocusTrap } from '@/hooks/useFocusTrap';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useThemeStore } from '@/store/themeStore';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Store,
  Users,
  Code2,
  Menu,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { StoreSwitcher } from './common/StoreSwitcher';
import { TopBar } from './common/TopBar';

interface AdminLayoutProps {
  children: React.ReactNode;
}

const adminNavItems = [
  {
    label: 'Dashboard',
    href: '/admin',
    icon: LayoutDashboard,
  },
  {
    label: 'Stores',
    href: '/admin/stores',
    icon: Store,
  },
  {
    label: 'Users',
    href: '/admin/users',
    icon: Users,
  },
  { label: 'Integrations', href: '/admin/integrations', icon: Code2 },
];

export const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { theme, toggleTheme, look } = useThemeStore();
  const topBar = look === 'new';
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useFocusTrap(menuOpen);
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && isTopFocusTrap(menuRef.current)) { event.preventDefault(); setMenuOpen(false); } };
    const desktop = matchMedia('(min-width: 1024px)');
    const changed = () => { if (desktop.matches) setMenuOpen(false); };
    document.addEventListener('keydown', escape); desktop.addEventListener('change', changed);
    return () => { document.removeEventListener('keydown', escape); desktop.removeEventListener('change', changed); };
  }, [menuOpen]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Check if user is super admin
  if (user?.role !== 'SUPER_ADMIN') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Access Denied</h1>
          <p className="text-muted-foreground mb-4">
            You don't have permission to access the admin panel.
          </p>
          <Button variant="primary" onClick={() => navigate('/')}>Go to Dashboard</Button>
        </div>
      </div>
    );
  }

  const isActive = (href: string) => location.pathname === href || (href !== '/admin' && location.pathname.startsWith(href));
  const themeLabel = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <div className={cn('h-screen bg-background flex overflow-hidden', topBar && 'app-shell-top flex-col')}>
      {/* New look: the menu is a bar across the top; the side menu below is then only the phone drawer. */}
      {topBar
        ? <TopBar label="Admin" entries={adminNavItems.map(item => ({ name: item.label, href: item.href, icon: item.icon, active: isActive(item.href) }))}
          brand={<p className="app-topbar-store">Administration</p>} tools={<StoreSwitcher className="hidden w-48 lg:block" />}
          user={{ name: [user?.firstName, user?.lastName].filter(Boolean).join(' '), role: user?.role || '' }}
          theme={theme} onToggleTheme={toggleTheme} themeLabel={themeLabel} onLogout={handleLogout}
          onOpenMenu={() => setMenuOpen(true)} menuLabel="Open admin menu" />
        : <button aria-label="Open admin menu" onClick={() => setMenuOpen(true)} className="lg:hidden fixed top-3 left-3 z-40 p-2 rounded-md bg-card border border-border"><Menu className="h-5 w-5" /></button>}
      {menuOpen && <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" aria-hidden="true" onClick={() => setMenuOpen(false)} />}
      {/* Sidebar */}
      <aside ref={menuRef} role={menuOpen ? 'dialog' : undefined} aria-label={menuOpen ? 'Admin menu' : undefined} aria-modal={menuOpen || undefined} className={cn('app-sidebar w-60 bg-card border-r flex-col h-full shrink-0 fixed inset-y-0 left-0 z-50', !topBar && 'lg:static', menuOpen ? 'flex' : topBar ? 'hidden' : 'hidden lg:flex')}>
        {/* Header */}
        <div className="h-16 flex flex-col justify-center px-4 border-b shrink-0 relative">
          <button aria-label="Close admin menu" onClick={() => setMenuOpen(false)} className="lg:hidden absolute right-3 top-3 p-1 rounded hover:bg-accent"><X className="h-5 w-5" /></button>
          <p className="text-base font-semibold text-primary">POS System</p>
          <p className="text-xs text-muted-foreground">Administration</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          {adminNavItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);

            return (
              <Link
                key={item.href}
                to={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'sidebar-link flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mx-3 mb-3 border-t pt-3"><p className="mb-1.5 text-xs font-semibold text-muted-foreground">Open a store (read-only)</p><StoreSwitcher /></div>
        <SidebarUserFooter name={[user?.firstName, user?.lastName].filter(Boolean).join(' ')} role={user?.role || ''} theme={theme} onToggleTheme={toggleTheme} onLogout={handleLogout} themeLabel={themeLabel} />
      </aside>

      {/* Main content */}
      <main className="management-content flex-1 min-w-0 overflow-auto">
        {!topBar && <div className="lg:hidden h-12" />}
        {children}
      </main>
    </div>
  );
};
