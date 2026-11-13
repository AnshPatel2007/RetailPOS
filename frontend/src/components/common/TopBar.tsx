import React, { useId } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button as AriaButton, Menu, MenuItem, MenuTrigger } from 'react-aria-components';
import { ChevronDown, Lock, LogOut, Menu as MenuIcon, Moon, Search, Sun, type LucideIcon } from 'lucide-react';
import { ControlPopover } from '@/components/ui/Overlay';
import { Tooltip } from '@/components/ui/Tooltip';
import { Kbd } from '@/components/ui/Kbd';
import { LookSwitch } from './LookSwitch';
import { ROLE_NAMES } from '@/lib/navigation';

export interface TopBarLink {
  name: string;
  href: string;
  icon: LucideIcon;
  active: boolean;
  /** A count on the item (open stock exceptions), with the sentence screen readers hear. */
  badge?: number;
  badgeLabel?: string;
}
export interface TopBarGroup { title: string; items: TopBarLink[] }
export type TopBarEntry = TopBarLink | TopBarGroup;

interface TopBarProps {
  /** Names the navigation for screen readers ("Main"). */
  label: string;
  /** The store's name, or the store picker. */
  brand: React.ReactNode;
  entries: TopBarEntry[];
  /** Status shown before the standard tools (connection badge, store picker). */
  tools?: React.ReactNode;
  user: { name: string; role: string };
  theme: string;
  onToggleTheme: () => void;
  themeLabel?: string;
  onLogout: () => void;
  onLock?: () => void;
  onFind?: () => void;
  findShortcut?: string;
  /** Phone and tablet: the bar shows a menu button that opens the drawer. */
  onOpenMenu: () => void;
  menuLabel: string;
}

const isGroup = (entry: TopBarEntry): entry is TopBarGroup => 'items' in entry;

/** A menu section: its pages drop down; the section lights up when one of them is open. */
function NavMenu({ group }: { group: TopBarGroup }) {
  const navigate = useNavigate();
  const describedBy = useId();
  const active = group.items.some(item => item.active);
  const counted = group.items.filter(item => item.badge);
  const badge = counted.reduce((sum, item) => sum + (item.badge || 0), 0);
  return <MenuTrigger>
    <AriaButton className="app-topbar-link" data-current={active || undefined} aria-describedby={badge ? describedBy : undefined}>
      {group.title}
      {badge > 0 && <span className="app-topbar-badge" aria-hidden="true">{badge}</span>}
      <ChevronDown aria-hidden="true" size={14} />
      {badge > 0 && <span id={describedBy} hidden>{counted.map(item => item.badgeLabel).filter(Boolean).join('. ')}</span>}
    </AriaButton>
    {/* Navigation, not a transaction: an open assistant panel stays open across it. */}
    <ControlPopover placement="bottom start" data-assistant-ignore="true">
      <Menu aria-label={group.title} className="control-list app-topbar-menu" onAction={key => navigate(String(key))}>
        {group.items.map(item => {
          const Icon = item.icon;
          return <MenuItem key={item.href} id={item.href} textValue={item.name} className="control-option" data-current={item.active || undefined}>
            <span className="flex min-w-0 items-center gap-3"><Icon size={18} aria-hidden="true" className="shrink-0" />{item.name}</span>
            {item.badge ? <span className="app-topbar-badge" title={item.badgeLabel}>{item.badge}</span> : null}
          </MenuItem>;
        })}
      </Menu>
    </ControlPopover>
  </MenuTrigger>;
}

/**
 * The New look's menu: a bar across the top, so pages use the full width.
 * Sections drop down. Theme, lock and sign-out are plain buttons, one click away.
 * On a phone the bar keeps a menu button for the drawer, which holds the rest.
 */
export function TopBar({ label, brand, entries, tools, user, theme, onToggleTheme, themeLabel = 'Toggle theme', onLogout, onLock, onFind, findShortcut, onOpenMenu, menuLabel }: TopBarProps) {
  const initials = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || '?';
  const role = ROLE_NAMES[user.role] || user.role;
  return <header className="app-topbar">
    <button type="button" className="app-topbar-icon inline-flex lg:hidden" onClick={onOpenMenu} aria-label={menuLabel} title={menuLabel}><MenuIcon size={20} aria-hidden="true" /></button>
    <div className="app-topbar-brand">
      <span className="app-topbar-mark" aria-hidden="true">P</span>
      <div className="min-w-0">{brand}</div>
    </div>
    <nav aria-label={label} className="app-topbar-nav">
      {entries.map(entry => {
        if (isGroup(entry)) return <NavMenu key={entry.title} group={entry} />;
        const Icon = entry.icon;
        return <Link key={entry.href} to={entry.href} className="app-topbar-link" aria-current={entry.active ? 'page' : undefined}>
          <Icon size={16} aria-hidden="true" className="app-topbar-link-icon" />{entry.name}
          {entry.badge ? <span className="app-topbar-badge" title={entry.badgeLabel}>{entry.badge}</span> : null}
        </Link>;
      })}
    </nav>
    <div className="app-topbar-tools">
      {tools}
      {onFind && <Tooltip content={'Find a page' + (findShortcut ? ` (${findShortcut})` : '')}>
        <AriaButton className="app-topbar-find" onPress={onFind} aria-label="Find a page">
          <Search size={16} aria-hidden="true" /><span className="hidden 2xl:inline">Find</span>{findShortcut && <Kbd className="hidden 2xl:inline-flex">{findShortcut}</Kbd>}
        </AriaButton>
      </Tooltip>}
      {/* On a phone the look switch, theme, lock and sign-out sit in the drawer instead. */}
      <div className="hidden lg:block"><LookSwitch className="look-switch-bar" /></div>
      <div className="app-topbar-user hidden xl:flex" title={`${user.name}, ${role}`}>
        <span className="app-topbar-avatar" aria-hidden="true">{initials}</span>
        <span className="hidden min-w-0 leading-tight 2xl:block">
          <span className="block max-w-32 truncate text-xs font-semibold">{user.name}</span>
          <span className="block text-[11px] opacity-70">{role}</span>
        </span>
      </div>
      <Tooltip content={themeLabel}><AriaButton className="app-topbar-icon hidden lg:inline-flex" onPress={onToggleTheme} aria-label={themeLabel}>{theme === 'light' ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}</AriaButton></Tooltip>
      {onLock && <Tooltip content="Lock register"><AriaButton className="app-topbar-icon hidden lg:inline-flex" onPress={onLock} aria-label="Lock register"><Lock size={18} aria-hidden="true" /></AriaButton></Tooltip>}
      <Tooltip content="Logout"><AriaButton className="app-topbar-icon hidden lg:inline-flex" onPress={onLogout} aria-label="Logout"><LogOut size={18} aria-hidden="true" /></AriaButton></Tooltip>
    </div>
  </header>;
}
