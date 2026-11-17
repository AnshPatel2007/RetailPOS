import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Checkbox } from '@/components/ui/Checkbox';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { pulseService, apiErrorMessage } from '@/services/api';

type Amounts = { refundAlertOver: number | null; drawerAlertOver: number | null };
type Switches = { notOpen: boolean; quiet: boolean; register: boolean; leftOpen: boolean };
const SWITCHES: { key: keyof Switches; label: string }[] = [
  { key: 'notOpen', label: 'Nobody on the register in the usual hours' },
  { key: 'quiet', label: 'No sale for much longer than usual' },
  { key: 'register', label: 'A register not heard from while its drawer is open' },
  { key: 'leftOpen', label: 'A drawer still open an hour after the usual closing' },
];

/**
 * Settings > Notifications (owners): what sends an alert. The refund, void and drawer
 * amounts reach owners; how the store is running (Store Pulse) reaches owners and
 * managers. Blank amount: that alert is off.
 */
export function AlertAmountsCard({ editable }: { editable: boolean }) {
  const query = useScopedQuery<{ amounts?: Amounts; pulse?: Switches }>(['pulse-settings'], async signal => (await pulseService.getSettings(signal)).data.data);
  const saved = query.data?.amounts, savedSwitches = query.data?.pulse;
  const [refund, setRefund] = useState(''), [drawer, setDrawer] = useState(''), [switches, setSwitches] = useState<Switches | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (saved) { setRefund(saved.refundAlertOver === null ? '' : String(saved.refundAlertOver)); setDrawer(saved.drawerAlertOver === null ? '' : String(saved.drawerAlertOver)); } }, [saved]);
  useEffect(() => { if (savedSwitches) setSwitches(savedSwitches); }, [savedSwitches]);
  if (!saved || !savedSwitches || !switches) return null;
  const amount = (value: string) => value.trim() === '' ? null : Number(value);
  const valid = (value: string) => value.trim() === '' || (/^\d+(\.\d{1,2})?$/.test(value.trim()) && Number(value) > 0);
  const changed = amount(refund) !== saved.refundAlertOver || amount(drawer) !== saved.drawerAlertOver
    || SWITCHES.some(({ key }) => switches[key] !== savedSwitches[key]);
  const save = async () => {
    if (!valid(refund) || !valid(drawer)) { toast.error('Enter amounts above zero, to the cent, or leave one blank to turn it off.'); return; }
    setSaving(true);
    try { await pulseService.updateSettings({ refundAlertOver: amount(refund), drawerAlertOver: amount(drawer), pulse: switches }); toast.success('Store alerts saved'); void query.refresh(); }
    catch (error) { toast.error(apiErrorMessage(error, 'The store alerts could not be saved.')); }
    finally { setSaving(false); }
  };
  return <Card>
    <CardHeader><CardTitle>Store Alerts</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Sent to the phones where people turned alerts on (Profile &amp; Security). Only owners see these settings.</p>
      <fieldset className="space-y-4" disabled={!editable || saving}>
        <legend className="field-label">Owners</legend>
        <Input label="Refund or void of at least ($)" type="number" inputMode="decimal" min="0.01" step="0.01" className="max-w-[10rem]" value={refund}
          onChange={event => setRefund(event.target.value)} description="Blank: no alert for refunds and voids. The default is $50." />
        <Input label="Drawer that closes off by at least ($)" type="number" inputMode="decimal" min="0.01" step="0.01" className="max-w-[10rem]" value={drawer}
          onChange={event => setDrawer(event.target.value)} description="Blank: no alert for drawers. The default is $5; $20 or more is sent as urgent." />
      </fieldset>
      <fieldset className="space-y-3" disabled={!editable || saving}>
        <legend className="field-label">Owners and managers: when the store is not running as usual</legend>
        {SWITCHES.map(({ key, label }) => <Checkbox key={key} label={label} checked={switches[key]} onChange={event => setSwitches({ ...switches, [key]: event.target.checked })} />)}
        <p className="text-sm text-muted-foreground">Learned from the last six weeks of drawers and sales. A weekday with fewer than three open days stays silent, and
          &quot;The Store Is Closed Today&quot; on the Shifts page stops the first two until tomorrow. These also show under Alerts.</p>
      </fieldset>
      <Button variant="primary" onClick={() => void save()} disabled={!editable || saving || !changed}>Save Changes</Button>
    </CardContent>
  </Card>;
}
