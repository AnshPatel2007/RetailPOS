import { useState } from 'react';
import toast from 'react-hot-toast';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { useCalendarTimezone } from '@/hooks/useCalendarTimezone';
import { pulseService, apiErrorMessage } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { pulseLine, PulseStatus } from '@/lib/storePulse';

/**
 * Shifts page (owners and managers): how the store is running right now. When nobody is
 * clocked in it offers "The Store Is Closed Today", which stops the opening and
 * quiet-register alerts until tomorrow (holidays).
 */
export function StorePulseCard() {
  const role = useAuthStore(state => state.user?.role);
  const enabled = role === 'ADMIN' || role === 'MANAGER';
  const timezone = useCalendarTimezone();
  const query = useScopedQuery<PulseStatus>(['pulse-status'], async signal => (await pulseService.getStatus(signal)).data.data, enabled, 60000);
  const [busy, setBusy] = useState(false);
  if (!enabled || !query.data) return null;
  const status = query.data, line = pulseLine(status, timezone);
  const setClosed = async (closed: boolean) => {
    setBusy(true);
    try {
      await pulseService.setClosedToday(closed);
      toast.success(closed ? 'Marked closed today' : 'Marked open today');
      void query.refresh();
    } catch (error) { toast.error(apiErrorMessage(error, 'That could not be saved. Try again.')); }
    finally { setBusy(false); }
  };

  if (status.closedToday && !status.alerts.length) return <Alert tone="info" className="mb-4" title="Marked closed today."
    action={<Button variant="ghost" disabled={busy} onClick={() => void setClosed(false)}>Open After All</Button>}>
    No alerts about opening or a quiet register until tomorrow.
  </Alert>;
  if (!status.openDrawers || status.alerts.length) return <Alert tone={line.tone === 'warning' ? 'warning' : 'info'} className="mb-4" title={line.text}
    action={!status.openDrawers && !status.closedToday ? <Button variant="outline" disabled={busy} onClick={() => void setClosed(true)}>The Store Is Closed Today</Button> : undefined}>
    {status.alerts.length > 1 ? status.alerts.slice(1).map(alert => <p key={alert.createdAt + alert.kind}>{alert.sentence}</p>)
      : status.learning && !status.openDrawers ? 'Alerts about opening start once the store has three weeks of this weekday.' : null}
  </Alert>;
  return <p role="status" className="mb-4 text-sm text-success">{line.text}</p>;
}
