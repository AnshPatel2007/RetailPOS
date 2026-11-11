import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '@/components/ui/Button';
import { useCartStore } from '@/store/cartStore';
import { db } from '@/services/offlineDb';

const HOUR = 60 * 60 * 1000;

/**
 * Registers the service worker that lets the installed app start without a
 * connection, and says when a new version has been downloaded. A register is
 * never reloaded on its own: the update is applied when someone presses the
 * button, and only while no sale or payment is in progress.
 */
export function AppUpdateNotice() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // A register can stay open for days; look for a new version every hour.
      if (registration) setInterval(() => { if (navigator.onLine) void registration.update().catch(() => undefined); }, HOUR);
    },
  });
  const cartItems = useCartStore(state => state.items.length);
  const openPayments = useLiveQuery(() => db.paymentSessions.where('status').anyOf('OPEN', 'SUBMITTED').count().catch(() => 0), [], 0);
  const [updating, setUpdating] = useState(false);
  if (!needRefresh) return null;
  const saleInProgress = cartItems > 0 || openPayments > 0;
  return (
    <div role="status" aria-label="App update" className="fixed bottom-3 left-3 z-[60] flex max-w-sm items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm shadow-lg">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">An update is ready</p>
        <p className="text-muted-foreground">{saleInProgress ? 'Finish the current sale, then update.' : 'It takes a few seconds and keeps you signed in.'}</p>
      </div>
      <Button size="sm" disabled={saleInProgress || updating} onClick={() => { setUpdating(true); void updateServiceWorker(true); }}>
        {updating ? 'Updating…' : 'Update now'}
      </Button>
    </div>
  );
}
