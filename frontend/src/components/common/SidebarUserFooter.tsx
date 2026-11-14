import { Lock, LogOut, Moon, Sun } from 'lucide-react';
import { Button } from 'react-aria-components';
import { Tooltip } from '@/components/ui/Tooltip';
import { ROLE_NAMES as roles } from '@/lib/navigation';

const iconButton = 'app-button inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&>svg]:h-4 [&>svg]:w-4';

/** The bottom of the phone menu drawer: who is signed in, the theme, lock and sign-out. */
export function SidebarUserFooter({ name, role, theme, onToggleTheme, onLogout, onLock, themeLabel = 'Toggle theme' }: {
  name: string; role: string; theme: string; onToggleTheme: () => void; onLogout: () => void; themeLabel?: string;
  /** Lock this register (only offered where a PIN can unlock it). */
  onLock?: () => void;
}) {
  return <div className="border-t p-3 shrink-0">
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0"><p className="truncate text-sm font-medium" title={name}>{name}</p><p className="text-xs text-muted-foreground">{roles[role] || role}</p></div>
      <div className="flex shrink-0 gap-1">
        <Tooltip content={themeLabel}><Button type="button" className={iconButton} data-control-size="standard" data-icon-only onPress={onToggleTheme} aria-label={themeLabel}>{theme === 'light' ? <Moon /> : <Sun />}</Button></Tooltip>
        {onLock && <Tooltip content="Lock register"><Button type="button" className={iconButton} data-control-size="standard" data-icon-only onPress={onLock} aria-label="Lock register"><Lock /></Button></Tooltip>}
        <Tooltip content="Logout"><Button type="button" className={iconButton} data-control-size="standard" data-icon-only onPress={onLogout} aria-label="Logout"><LogOut /></Button></Tooltip>
      </div>
    </div>
  </div>;
}
