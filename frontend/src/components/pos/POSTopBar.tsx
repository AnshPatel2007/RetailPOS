import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, Sun, Moon, MonitorSmartphone } from 'lucide-react';
import { shiftService } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { useThemeStore } from '@/store/themeStore';
import { useStoreSettingsStore } from '@/store/storeSettingsStore';
import { OfflineIndicator } from '@/components/common/OfflineIndicator';

interface CurrentShift {
  clockInAt: string;
}

/**
 * Slim status bar across the top of the fullscreen POS view.
 * Left: navigation, store identity, shift status. Center: clock.
 * Right: connectivity, cashier, theme.
 */
export const POSTopBar: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();
  const storeName = useStoreSettingsStore((s) => s.storeInfo.storeName);

  // undefined = loading/unknown, null = not clocked in
  const [currentShift, setCurrentShift] = useState<CurrentShift | null | undefined>(undefined);
  const [now, setNow] = useState(new Date());

  // The backend rejects sales without an open shift, so surface it up front
  useEffect(() => {
    const checkShift = () => {
      shiftService.getCurrent()
        .then((res) => setCurrentShift(res.data?.data ?? null))
        .catch(() => setCurrentShift(undefined));
    };
    checkShift();
    window.addEventListener('focus', checkShift);
    return () => window.removeEventListener('focus', checkShift);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (d: Date | string) =>
    new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <header className="relative h-12 shrink-0 flex items-center px-2 sm:px-3 border-b border-border bg-card">
      {/* Left: navigation + store identity + shift status */}
      <div className="flex items-center gap-1.5 min-w-0">
        <button
          onClick={() => navigate('/dashboard')}
          className="h-9 w-9 shrink-0 flex items-center justify-center rounded-md hover:bg-accent transition-colors text-muted-foreground"
          title="Back to Dashboard (Esc)"
        >
          <ArrowLeft className="h-[18px] w-[18px]" />
        </button>

        <span className="font-semibold text-sm truncate">{storeName || 'POS System'}</span>

        <div className="hidden sm:block h-5 w-px bg-border mx-1" />

        {currentShift !== undefined && (
          <button
            onClick={() => navigate('/shifts')}
            className={`h-7 shrink-0 flex items-center gap-1.5 px-2 rounded-md text-[11px] font-medium transition-colors ${
              currentShift
                ? 'text-success hover:bg-success/10'
                : 'text-warning bg-warning/10 hover:bg-warning/20'
            }`}
            title={currentShift ? 'View shift' : 'Sales can’t be completed until you clock in'}
          >
            {currentShift ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                <span>In since {formatTime(currentShift.clockInAt)}</span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-3 w-3" />
                Not clocked in
              </>
            )}
          </button>
        )}
      </div>

      {/* Center: clock */}
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 hidden md:inline text-sm font-medium tabular-nums text-muted-foreground">
        {formatTime(now)}
      </span>

      {/* Right: connectivity + cashier + theme */}
      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <OfflineIndicator variant="badge" showDetails />

        {user && (
          <>
            <div className="hidden md:block h-5 w-px bg-border" />
            <div className="hidden md:flex flex-col items-end leading-tight">
              <span className="text-xs font-medium">{user.firstName} {user.lastName}</span>
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                {user.role.replace(/_/g, ' ')}
              </span>
            </div>
          </>
        )}

        <button
          onClick={() => window.open('/customer-display', 'customerDisplay', 'width=1024,height=768')}
          className="h-9 w-9 flex items-center justify-center rounded-md hover:bg-accent transition-colors text-muted-foreground"
          aria-label="Open customer display"
          title="Open customer display (drag to the second monitor)"
        >
          <MonitorSmartphone className="h-4 w-4" />
        </button>

        <button
          onClick={toggleTheme}
          className="h-9 w-9 flex items-center justify-center rounded-md hover:bg-accent transition-colors text-muted-foreground"
          aria-label="Toggle theme"
          title="Toggle theme"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
};
