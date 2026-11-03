import { LogOut, Moon, Sun } from 'lucide-react';
import { Button } from 'react-aria-components';
import { Tooltip } from '@/components/ui/Tooltip';

const roles: Record<string, string> = { ADMIN: 'Owner', MANAGER: 'Manager', CASHIER: 'Cashier', SUPER_ADMIN: 'Platform administrator' };
const iconButton = 'app-button inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&>svg]:h-4 [&>svg]:w-4';

export function SidebarUserFooter({ name, role, theme, onToggleTheme, onLogout, collapsed = false, themeLabel = 'Toggle theme' }: {
  name: string; role: string; theme: string; onToggleTheme: () => void; onLogout: () => void; collapsed?: boolean; themeLabel?: string;
}) {
  return <div className="border-t p-3 shrink-0">
    <div className={collapsed ? 'flex flex-col items-center gap-2' : 'flex items-center justify-between gap-2'}>
      {!collapsed && <div className="min-w-0"><p className="truncate text-sm font-medium" title={name}>{name}</p><p className="text-xs text-muted-foreground">{roles[role] || role}</p></div>}
      <div className={collapsed ? 'flex flex-col gap-1' : 'flex shrink-0 gap-1'}>
        <Tooltip content={themeLabel}><Button type="button" className={iconButton} data-control-size="standard" data-icon-only onPress={onToggleTheme} aria-label={themeLabel}>{theme === 'light' ? <Moon /> : <Sun />}</Button></Tooltip>
        <Tooltip content="Logout"><Button type="button" className={iconButton} data-control-size="standard" data-icon-only onPress={onLogout} aria-label="Logout"><LogOut /></Button></Tooltip>
      </div>
    </div>
  </div>;
}
