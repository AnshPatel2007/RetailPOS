import { useState } from 'react';
import toast from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useStoreSettingsStore } from '@/store/storeSettingsStore';

/**
 * How big a cost rise on a delivery must be to be flagged: in the delivery
 * review (with the margin and a suggested price) and on the attention list.
 */
export function CostAlertCard({ editable }: { editable: boolean }) {
  const saved = useStoreSettingsStore(state => state.purchasing.costChangeAlertPercent);
  const savePurchasing = useStoreSettingsStore(state => state.savePurchasing);
  const [typed, setTyped] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const shown = typed ?? String(saved);
  const save = async () => {
    const percent = Number(shown);
    if (!shown.trim() || !Number.isFinite(percent) || percent < 0.1 || percent > 100) { toast.error('Enter a percent from 0.1 to 100.'); return; }
    setSaving(true);
    try {
      await savePurchasing({ costChangeAlertPercent: Math.round(percent * 10) / 10 });
      setTyped(null); toast.success('Settings saved');
    } catch (error: unknown) {
      const failure = error as { response?: { data?: { error?: string } }; message?: string };
      toast.error(failure.response?.data?.error || failure.message || 'Failed to save settings');
    } finally { setSaving(false); }
  };
  return <Card>
    <CardHeader><CardTitle>Cost Increase Alerts</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <Input label="Flag a delivery when an item's cost rises by at least (%)" type="number" inputMode="decimal" min="0.1" max="100" step="0.1"
        className="max-w-[8rem]" value={shown} disabled={!editable || saving} onChange={event => setTyped(event.target.value)}
        description="Flagged items show in the delivery review with their margin and a suggested price, and on the Dashboard for a week. The default is 3%." />
      <Button variant="primary" onClick={() => void save()} disabled={!editable || saving || typed === null}>Save Changes</Button>
    </CardContent>
  </Card>;
}
