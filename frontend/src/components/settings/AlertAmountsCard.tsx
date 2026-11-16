import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { pulseService, apiErrorMessage } from '@/services/api';

type Amounts = { refundAlertOver: number | null; drawerAlertOver: number | null };

/** Settings > Notifications (owners): how large a refund, void or drawer difference sends a phone alert. Blank turns one off. */
export function AlertAmountsCard({ editable }: { editable: boolean }) {
  const query = useScopedQuery<{ amounts?: Amounts }>(['pulse-settings'], async signal => (await pulseService.getSettings(signal)).data.data);
  const saved = query.data?.amounts;
  const [refund, setRefund] = useState(''), [drawer, setDrawer] = useState(''), [saving, setSaving] = useState(false);
  useEffect(() => { if (saved) { setRefund(saved.refundAlertOver === null ? '' : String(saved.refundAlertOver)); setDrawer(saved.drawerAlertOver === null ? '' : String(saved.drawerAlertOver)); } }, [saved]);
  if (!saved) return null;
  const amount = (value: string) => value.trim() === '' ? null : Number(value);
  const valid = (value: string) => value.trim() === '' || (/^\d+(\.\d{1,2})?$/.test(value.trim()) && Number(value) > 0);
  const changed = amount(refund) !== saved.refundAlertOver || amount(drawer) !== saved.drawerAlertOver;
  const save = async () => {
    if (!valid(refund) || !valid(drawer)) { toast.error('Enter amounts above zero, to the cent, or leave one blank to turn it off.'); return; }
    setSaving(true);
    try { await pulseService.updateSettings({ refundAlertOver: amount(refund), drawerAlertOver: amount(drawer) }); toast.success('Alert amounts saved'); void query.refresh(); }
    catch (error) { toast.error(apiErrorMessage(error, 'The alert amounts could not be saved.')); }
    finally { setSaving(false); }
  };
  return <Card>
    <CardHeader><CardTitle>Phone Alert Amounts</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <Input label="Refund or void of at least ($)" type="number" inputMode="decimal" min="0.01" step="0.01" className="max-w-[10rem]" value={refund}
        disabled={!editable || saving} onChange={event => setRefund(event.target.value)} description="Blank: no alert for refunds and voids. The default is $50." />
      <Input label="Drawer that closes off by at least ($)" type="number" inputMode="decimal" min="0.01" step="0.01" className="max-w-[10rem]" value={drawer}
        disabled={!editable || saving} onChange={event => setDrawer(event.target.value)} description="Blank: no alert for drawers. The default is $5; $20 or more is sent as urgent." />
      <p className="text-sm text-muted-foreground">Alerts go to the phones where owners turned them on (Profile & Security). Only owners see these amounts.</p>
      <Button variant="primary" onClick={() => void save()} disabled={!editable || saving || !changed}>Save Changes</Button>
    </CardContent>
  </Card>;
}
