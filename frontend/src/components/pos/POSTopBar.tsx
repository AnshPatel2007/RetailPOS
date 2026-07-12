import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock3, AlertTriangle, Sun, Moon } from 'lucide-react';
import { shiftService } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { useThemeStore } from '@/store/themeStore';
import { useStoreSettingsStore } from '@/store/storeSettingsStore';
import { OfflineIndicator } from '@/components/common/OfflineIndicator';

interface CurrentShift {
  clockInAt: string;
}

/**
 * Status bar across the top of the fullscreen POS view.
 * Carries navigation, store identity, and live status (shift, connectivity,
 * clock, cashier, theme) so cashiers see everything at a glance.
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
    <header className="h-14 shrink-0 flex items-center gap-2 px-2 sm:px-3 border-b border-border bg-card">
      {/* Left: back + store name */}
      <button
        onClick={() => navigate('/dashboard')}
        className="h-10 w-10 shrink-0 flex items-center justify-center rounded-md hover:bg-accent transition-colors text-muted-foreground"
        title="Back to Dashboard (Esc)"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
      <div className="min-w-0">
        <span className="font-semibold truncate block">{storeName || 'POS System'}</span>
      </div>

      {/* Right: status cluster */}
      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        {currentShift !== undefined && (
          <button
            onClick={() => navigate('/shifts')}
            className={`h-9 flex items-center gap-1.5 px-2.5 rounded-full text-xs font-medium transition-colors hover:opacity-80 ${
              currentShift
                ? 'bg-success/10 text-success'
                : 'bg-warning/15 text-warning border border-warning/30'
            }`}
            title={currentShift ? 'View shift' : 'Sales can’t be completed until you clock in'}
          >
            {currentShift ? (
              <>
                <Clock3 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">In since {formatTime(currentShift.clockInAt)}</span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Not clocked in</span>
              </>
            )}
          </button>
        )}

        <OfflineIndicator variant="badge" showDetails />

        <span className="hidden lg:inline text-sm tabular-nums text-muted-foreground">
          {formatTime(now)}
        </span>

        {user && (
          <div className="hidden md:flex flex-col items-end leading-tight">
            <span className="text-sm font-medium">{user.firstName} {user.lastName}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {user.role.replace(/_/g, ' ')}
            </span>
          </div>
        )}

        <button
          onClick={toggleTheme}
          className="h-10 w-10 flex items-center justify-center rounded-md hover:bg-accent transition-colors text-muted-foreground"
          aria-label="Toggle theme"
          title="Toggle theme"
        >
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>
      </div>
    </header>
  );
};
