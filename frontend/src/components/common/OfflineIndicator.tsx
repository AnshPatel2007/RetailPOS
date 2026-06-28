import React, { useState } from 'react';
import { WifiOff, RefreshCw, Cloud, CloudOff, AlertCircle } from 'lucide-react';
import { useSyncService } from '../../hooks/useSyncService';

interface OfflineIndicatorProps {
  variant?: 'badge' | 'banner' | 'floating';
  showDetails?: boolean;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({
  variant = 'badge',
  showDetails = false,
}) => {
  const {
    isOnline,
    isOffline,
    isSyncing,
    pendingSalesCount,
    lastSyncTime,
    lastError,
    sync,
  } = useSyncService();

  const [showTooltip, setShowTooltip] = useState(false);

  const formatLastSync = (timestamp?: number) => {
    if (!timestamp) return 'Never';
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  const handleSync = async () => {
    if (isOnline && !isSyncing) {
      try {
        await sync();
      } catch (error) {
        console.error('Manual sync failed:', error);
      }
    }
  };

  // Badge variant - compact status indicator
  if (variant === 'badge') {
    return (
      <div
        className="relative inline-flex items-center"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer
            ${isOffline
              ? 'bg-red-500/10 text-red-500'
              : pendingSalesCount > 0
                ? 'bg-yellow-500/10 text-yellow-500'
                : 'bg-green-500/10 text-green-500'
            }`}
          onClick={handleSync}
        >
          {isOffline ? (
            <>
              <WifiOff className="w-3 h-3" />
              <span>Offline</span>
            </>
          ) : isSyncing ? (
            <>
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span>Syncing</span>
            </>
          ) : pendingSalesCount > 0 ? (
            <>
              <CloudOff className="w-3 h-3" />
              <span>{pendingSalesCount} pending</span>
            </>
          ) : (
            <>
              <Cloud className="w-3 h-3" />
              <span>Synced</span>
            </>
          )}
        </div>

        {/* Tooltip */}
        {showTooltip && showDetails && (
          <div className="absolute top-full right-0 mt-2 w-64 p-3 bg-card rounded-lg shadow-lg border border-border z-50">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status:</span>
                <span className={isOnline ? 'text-green-500' : 'text-red-500'}>
                  {isOnline ? 'Online' : 'Offline'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pending sales:</span>
                <span>{pendingSalesCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last sync:</span>
                <span>{formatLastSync(lastSyncTime)}</span>
              </div>
              {lastError && (
                <div className="mt-2 p-2 bg-red-500/10 rounded text-red-500 text-xs">
                  {lastError}
                </div>
              )}
              {isOnline && !isSyncing && (
                <button
                  onClick={handleSync}
                  className="w-full mt-2 px-3 py-1.5 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700"
                >
                  Sync Now
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Banner variant - full-width notification
  if (variant === 'banner') {
    if (isOnline && pendingSalesCount === 0) return null;

    return (
      <div
        className={`w-full px-4 py-2 flex items-center justify-between
          ${isOffline
            ? 'bg-red-600 text-white'
            : 'bg-yellow-500 text-yellow-900'
          }`}
      >
        <div className="flex items-center gap-2">
          {isOffline ? (
            <>
              <WifiOff className="w-4 h-4" />
              <span className="text-sm font-medium">
                You're offline. Sales will be saved locally and synced when you're back online.
              </span>
            </>
          ) : (
            <>
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm font-medium">
                {pendingSalesCount} sale{pendingSalesCount !== 1 ? 's' : ''} pending sync
              </span>
            </>
          )}
        </div>
        {isOnline && !isSyncing && (
          <button
            onClick={handleSync}
            className="flex items-center gap-1 px-3 py-1 bg-white/20 hover:bg-white/30 rounded text-sm"
          >
            <RefreshCw className="w-3 h-3" />
            Sync Now
          </button>
        )}
        {isSyncing && (
          <div className="flex items-center gap-1 text-sm">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Syncing...
          </div>
        )}
      </div>
    );
  }

  // Floating variant - fixed position indicator
  if (variant === 'floating') {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <div
          className={`flex items-center gap-2 px-4 py-2 rounded-lg shadow-lg cursor-pointer
            ${isOffline
              ? 'bg-red-600 text-white'
              : pendingSalesCount > 0
                ? 'bg-yellow-500 text-yellow-900'
                : 'bg-green-500 text-white'
            }`}
          onClick={handleSync}
        >
          {isOffline ? (
            <>
              <WifiOff className="w-5 h-5" />
              <div>
                <div className="font-medium text-sm">Offline Mode</div>
                <div className="text-xs opacity-80">
                  {pendingSalesCount} sale{pendingSalesCount !== 1 ? 's' : ''} pending
                </div>
              </div>
            </>
          ) : isSyncing ? (
            <>
              <RefreshCw className="w-5 h-5 animate-spin" />
              <span className="text-sm font-medium">Syncing...</span>
            </>
          ) : pendingSalesCount > 0 ? (
            <>
              <CloudOff className="w-5 h-5" />
              <div>
                <div className="font-medium text-sm">{pendingSalesCount} Pending</div>
                <div className="text-xs opacity-80">Click to sync</div>
              </div>
            </>
          ) : (
            <>
              <Cloud className="w-5 h-5" />
              <span className="text-sm font-medium">Synced</span>
            </>
          )}
        </div>
      </div>
    );
  }

  return null;
};

export default OfflineIndicator;
