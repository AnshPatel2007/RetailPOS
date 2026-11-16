import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { useScopedQuery, invalidateScopedQueries } from '@/hooks/useScopedQuery';
import { pulseService, apiErrorMessage } from '@/services/api';
import { appWorkerReady, browserPushSupport, deviceSubscription, turnOffAlerts, turnOnAlerts } from '@/services/pushAlerts';
import { useRegisterStore } from '@/store/registerStore';
import { useAuthStore } from '@/store/authStore';

interface PulseSettings { publicKey: string | null; devices: { id: string; endpoint: string; deviceLabel: string | null }[] }

/**
 * Settings > Profile & Security (owners and managers): alerts on this phone. Owners hear
 * about large refunds and voids and drawers that close off; owners and managers hear
 * when the store is not running as usual. Never offered on a computer set up as a register.
 */
export function PhoneAlertsCard() {
  const role = useAuthStore(state => state.user?.role);
  const register = useRegisterStore(state => state.device);
  const enabled = (role === 'ADMIN' || role === 'MANAGER') && !register;
  const query = useScopedQuery<PulseSettings>(['pulse-settings'], async signal => (await pulseService.getSettings(signal)).data.data, enabled);
  const [endpoint, setEndpoint] = useState<string | null>(null), [worker, setWorker] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState('');
  const support = browserPushSupport();
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void Promise.all([appWorkerReady(), deviceSubscription().catch(() => null)]).then(([ready, subscription]) => {
      if (active) { setWorker(ready); setEndpoint(subscription?.endpoint ?? null); }
    });
    return () => { active = false; };
  }, [enabled, query.data]);
  if (!enabled) return null;

  const devices = query.data?.devices ?? [];
  const onHere = !!endpoint && devices.some(device => device.endpoint === endpoint);
  const elsewhere = devices.filter(device => device.endpoint !== endpoint).length;
  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true); setProblem('');
    try { await work(); toast.success(done); invalidateScopedQueries(); void query.refresh(); }
    catch (error) { setProblem(apiErrorMessage(error, (error as Error).message || 'That did not work. Try again.')); }
    finally { setBusy(false); }
  };
  const blocked = typeof Notification !== 'undefined' && Notification.permission === 'denied';

  return <Card>
    <CardHeader><CardTitle>Alerts On This Phone</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {role === 'ADMIN' ? 'A notification the moment a large refund or void is made, a drawer closes off, or the store is not running as usual.'
          : 'A notification when the store is not running as usual: nobody on the register at opening time, a quiet register, a register that lost its connection.'}
      </p>
      {problem && <Alert tone="error">{problem}</Alert>}
      {query.error && !query.data ? <Alert tone="error" title="Alerts could not be loaded." action={<Button variant="outline" onClick={() => void query.refresh()}>Retry</Button>} />
        : !query.data ? <p className="text-sm text-muted-foreground">Checking this device…</p>
        : !query.data.publicKey ? <Alert tone="info">{role === 'ADMIN' ? 'Phone alerts are not set up on this server yet. They need the VAPID keys described in SETUP.md.' : 'Phone alerts are not set up on this server yet. Ask the store owner.'}</Alert>
        : support === 'install-first' ? <Alert tone="info" title="Add the POS to your Home Screen first.">On an iPhone or iPad, tap Share, then Add to Home Screen. Open the POS from there and come back here.</Alert>
        : support === 'unsupported' ? <Alert tone="info">This browser cannot show alerts. Use Chrome, Edge or Firefox, or the installed app on a phone.</Alert>
        : worker === false ? <Alert tone="info">Alerts work in the installed app, not in this development preview.</Alert>
        : onHere ? <>
          <p className="font-medium text-success">Alerts are on for this device.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={() => void act(async () => {
              const result = (await pulseService.test()).data.data as { sent: number };
              if (!result.sent) throw new Error('The test alert could not be delivered. Turn alerts off and on again.');
            }, 'Test alert sent')}>Send A Test Alert</Button>
            <Button variant="ghost" disabled={busy} onClick={() => void act(turnOffAlerts, 'Alerts turned off on this device')}>Turn Off</Button>
          </div>
        </>
        : <>
          {blocked && <Alert tone="warning">Notifications are blocked for this site. Allow them in the browser&apos;s site settings, then turn alerts on.</Alert>}
          <Button variant="primary" disabled={busy || blocked || worker === null} onClick={() => void act(() => turnOnAlerts(query.data!.publicKey!), 'Alerts are on for this device')}>
            Turn On Alerts On This Phone</Button>
        </>}
      {elsewhere > 0 && <p className="text-sm text-muted-foreground">Alerts are also on for {elsewhere} other {elsewhere === 1 ? 'device' : 'devices'} of yours. Signing out of a device turns them off there.</p>}
    </CardContent>
  </Card>;
}
