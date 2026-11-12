import { SidebarUserFooter } from './common/SidebarUserFooter';
import React, { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen, Menu, X, Search, ChevronDown } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useRegisterStore, canLockRegister } from '@/store/registerStore';
import { useThemeStore } from '@/store/themeStore';
import { useLayoutStore } from '@/store/layoutStore';
import { useStoreSettingsStore } from '@/store/storeSettingsStore';
import { useQuickFindStore } from '@/store/quickFindStore';
import { cn } from '@/lib/utils';
import { sidebarSections, STOCK_CONTROL, type NavLink } from '@/lib/navigation';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import { useInventoryExceptionCount } from '@/hooks/useInventoryExceptionCount';
import { AdminViewBanner } from './AdminViewBanner';
import { OfflineIndicator } from './common/OfflineIndicator';
import { QuickFind, quickFindShortcut, useQuickFindShortcut } from './common/QuickFind';
import { StoreSwitcher } from './common/StoreSwitcher';
import { Kbd } from './ui/Kbd';
import { isTopFocusTrap, useFocusTrap } from '@/hooks/useFocusTrap';

interface LayoutProps {
  children: React.ReactNode;
}

// All menu hrefs, so a parent path is only "active" when no deeper menu item matches better.
const allHrefs = sidebarSections.flatMap(section => section.items.map(item => item.href));

function isPathActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  // /inventory must not light up for /inventory/purchasing, which has its own menu item.
  const hasCollision = allHrefs.some(other => other !== href && other.startsWith(href + '/'));
  if (hasCollision) return false;
  return pathname.startsWith(href + '/');
}

/** Menus this short read better as one plain list than as labelled sections. */
const SECTION_TITLES_FROM = 8;

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const registerDevice = useRegisterStore(state => state.device);
  const lockRegister = useRegisterStore(state => state.lock);
  const { theme, toggleTheme } = useThemeStore();
  const { isSidebarCollapsed, isMobileMenuOpen, toggleSidebar, setMobileMenuOpen, openSection, setOpenSection } = useLayoutStore();
  const quickFind = useQuickFindStore();
  // Show which store you're operating — mirrors the POS top bar
  const settingsStoreName = useStoreSettingsStore((s) => s.storeInfo.storeName);
  const { isAdminViewing, storeName: previewStoreName, locationId: effectiveLocationId } = useEffectiveLocation();
  const canReviewStock = !!user?.role && ['ADMIN', 'MANAGER'].includes(user.role) || (user?.role === 'SUPER_ADMIN' && isAdminViewing);
  const exceptionCount = useInventoryExceptionCount(canReviewStock, user?.role === 'SUPER_ADMIN' ? effectiveLocationId : null);
  const storeName = isAdminViewing ? previewStoreName || '' : settingsStoreName || user?.location?.name || '';

  // Full-screen routes with no sidebar/chrome (register + second screen)
  const isPOSPage = location.pathname === '/pos' || location.pathname === '/customer-display';
  useQuickFindShortcut(!isPOSPage, quickFind.open);
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

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname, setMobileMenuOpen]);

  // The menu section holding the current page opens by itself (one section open at a time).
  const activeSection = sidebarSections.find(section => section.title && section.items.some(item => isPathActive(location.pathname, item.href)))?.title || null;
  useEffect(() => {
    if (activeSection) setOpenSection(activeSection);
  }, [activeSection, location.pathname, setOpenSection]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
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

  const sections = sidebarSections.map(section => ({ ...section, items: section.items.filter(item => hasRole(item.roles)) })).filter(section => section.items.length > 0);
  const showTitles = sections.reduce((total, section) => total + section.items.length, 0) >= SECTION_TITLES_FROM;

  const exceptionLabel = `${exceptionCount} inventory exception${exceptionCount === 1 ? ' needs' : 's need'} review`;
  const exceptionDescription = exceptionCount > 0 ? exceptionLabel : undefined;

  const renderNavItem = (item: NavLink) => {
    const isActive = isPathActive(location.pathname, item.href);
    const Icon = item.icon;
    const stock = item.href === STOCK_CONTROL;
    return (
      <Link
        key={item.href}
        to={item.href}
        title={isSidebarCollapsed ? item.name : undefined}
        aria-label={item.name}
        aria-current={isActive ? 'page' : undefined}
        // The badge is visual; its meaning is the description, so the link's name stays "Stock Control".
        aria-description={stock ? exceptionDescription : undefined}
        className={cn(
          'sidebar-link flex items-center rounded-md text-sm font-medium transition-colors',
          isSidebarCollapsed ? 'justify-center px-2 py-2' : 'gap-3 px-3 py-2',
          isActive
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
        )}
      >
        <span className="relative shrink-0">
          <Icon className="h-[18px] w-[18px]" />
          {/* Collapsed sidebar: a dot on the icon stands in for the count. */}
          {isSidebarCollapsed && stock && exceptionCount > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-card" aria-hidden="true" />}
        </span>
        {!isSidebarCollapsed && <span className="truncate">{item.name}</span>}
        {stock && !isSidebarCollapsed && exceptionCount > 0 && (
          <span className="ml-auto rounded-full bg-destructive px-1.5 text-[11px] font-semibold leading-5 text-destructive-foreground tabular-nums" title={exceptionLabel} aria-hidden="true">{exceptionCount}</span>
        )}
      </Link>
    );
  };

  const sidebarContent = (place: 'mobile' | 'desktop') => (
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
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
            {(user?.role === 'SUPER_ADMIN' ? isAdminViewing : (user?.stores?.length ?? 0) > 1)
              ? <StoreSwitcher className="basis-full pt-1" />
              : storeName && <p className="basis-full text-xs leading-5 text-muted-foreground break-words" data-sidebar-store-name>{storeName}</p>}
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
            aria-label="Expand sidebar"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Quick find: one box that reaches every page, tab and setting */}
      <div className={cn('shrink-0 pt-3', isSidebarCollapsed ? 'px-2' : 'px-3')}>
        <button type="button" onClick={quickFind.open} title={isSidebarCollapsed ? 'Find a page (' + quickFindShortcut + ')' : undefined}
          aria-label="Find a page" aria-keyshortcuts={quickFindShortcut === '⌘K' ? 'Meta+K' : 'Control+K'}
          className={cn('flex h-9 w-full items-center rounded-md border border-input bg-background text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
            isSidebarCollapsed ? 'justify-center' : 'gap-2 px-3')}>
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          {!isSidebarCollapsed && <><span className="flex-1 text-left">Find…</span><Kbd>{quickFindShortcut}</Kbd></>}
        </button>
      </div>

      {/* Navigation */}
      <nav aria-label="Main" className="flex-1 px-2 pb-4 pt-2 overflow-y-auto">
        {sections.map((section, index) => {
          // Titled sections fold: a heading opens its pages, and opening one closes the others.
          // The icon-only sidebar and short menus (cashiers) keep every page in view.
          const folding = showTitles && !!section.title && !isSidebarCollapsed;
          const open = !folding || openSection === section.title;
          const id = `sidebar-${place}-${(section.title || 'start').toLowerCase().replace(/[^a-z]+/g, '-')}`;
          const hiddenAlert = folding && !open && exceptionCount > 0 && section.items.some(item => item.href === STOCK_CONTROL);
          return (
            <div key={section.title || 'start'} className={cn(index > 0 && (isSidebarCollapsed || !showTitles ? 'mt-2 border-t border-border pt-2' : 'mt-1'))}>
              {folding && (
                <button type="button" aria-expanded={open} aria-controls={id} aria-description={hiddenAlert ? exceptionLabel : undefined}
                  onClick={() => setOpenSection(open ? null : section.title || null)}
                  className="sidebar-section-toggle flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                  <span className="flex-1 text-left">{section.title}</span>
                  {hiddenAlert && <span className="rounded-full bg-destructive px-1.5 text-[11px] font-semibold leading-5 text-destructive-foreground tabular-nums" aria-hidden="true">{exceptionCount}</span>}
                  <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden="true" />
                </button>
              )}
              <div id={id} hidden={!open} className="space-y-0.5">{section.items.map(renderNavItem)}</div>
            </div>
          );
        })}
      </nav>

      <SidebarUserFooter name={[user?.firstName, user?.lastName].filter(Boolean).join(' ')} role={user?.role || ''} theme={theme} onToggleTheme={toggleTheme} onLogout={handleLogout} collapsed={isSidebarCollapsed}
        onLock={user && canLockRegister(user, registerDevice) ? () => lockRegister(user.id) : undefined} />
    </>
  );

  return (
    <div className="flex h-screen bg-background">
      {/* Mobile menu button */}
      <button
        onClick={() => setMobileMenuOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-50 p-2 rounded-md bg-card border border-border shadow-sm hover:bg-accent transition-colors"
        title="Open menu"
        aria-label="Open menu"
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
        {sidebarContent('mobile')}
      </aside>

      {/* Sidebar — desktop */}
      <aside
        className={cn(
          'hidden lg:flex flex-col bg-card border-r border-border transition-all duration-300',
          isSidebarCollapsed ? 'w-16' : 'w-60'
        )}
      >
        {sidebarContent('desktop')}
      </aside>

      {/* Main content */}
      <main className="management-content flex-1 min-w-0 overflow-auto lg:ml-0">
        <div className="lg:hidden h-12" /> {/* Spacer for mobile menu button */}
        {isAdminViewing && <AdminViewBanner storeName={previewStoreName || 'Selected store'} />}
        {children}
      </main>
      <QuickFind isOpen={quickFind.isOpen} onClose={quickFind.close} />
    </div>
  );
};
