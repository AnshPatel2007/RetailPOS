import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { useSavedOperation } from '@/hooks/useSavedOperation';
import { LotteryConfiguration as Configuration, lotteryRead } from '@/services/lotteryWorkbench';
import { LotteryError, LotteryRecovery } from './LotteryFields';
import toast from 'react-hot-toast';

export function LotteryConfiguration({ store, onClose }: { store: { id: string; name: string; timezone: string }; onClose: () => void }) {
  const query = useScopedQuery<Configuration>(['lottery-configuration', store.id], signal => lotteryRead('/configuration', store.id, signal), true, 0, { autoRefresh: false });
  const [mode, setMode] = useState<'MANUAL' | 'DISPENSER'>('MANUAL'), [loaded, setLoaded] = useState(false);
  const operation = useSavedOperation('lottery-equipment-' + store.id, '/lottery/v2/equipment/', result => { toast.success('Lottery equipment saved. Starts ' + result.data.effectiveDate + '.'); onClose(); });
  useEffect(() => { if (query.data && !loaded) { setMode(query.data.versions[0]?.settings.mode === 'DISPENSER' ? 'DISPENSER' : 'MANUAL'); setLoaded(true); } }, [query.data, loaded]);
  return <Modal isOpen title={'Lottery · ' + store.name} size="md" onClose={() => { if (!operation.busy) onClose(); }} footer={<div className="flex justify-end gap-2"><Button variant="outline" disabled={operation.busy} onClick={onClose}>Cancel</Button>
    <Button disabled={!loaded || operation.blocked} onClick={() => void operation.submit({ label: 'Set lottery equipment', path: '/lottery/v2/equipment/' + store.id, payload: { mode, previousId: query.data?.latestId || null } })}>Save equipment</Button></div>}>
    <div className="space-y-4"><LotteryError error={query.error} retry={() => void query.refresh()} /><LotteryRecovery operation={operation} />
      <div role="group" aria-label="Lottery equipment" className="grid gap-3">{([['MANUAL', 'Lottery rack', 'Enter or scan closing ticket numbers.'], ['DISPENSER', 'Lottery machine', 'Enter the machine’s daily sales total.']] as const).map(([value, label, description]) =>
        <button key={value} type="button" aria-pressed={mode === value} disabled={!loaded || operation.blocked} className={'rounded-lg border p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ' + (mode === value ? 'border-primary bg-primary/5' : 'border-border')} onClick={() => setMode(value)}><span className="block font-medium text-sm">{label}</span><span className="block mt-1 text-xs text-muted-foreground">{description}</span></button>)}</div>
      <p className="text-xs text-muted-foreground">Both include online lottery entry. Equipment changes apply to the next unopened day.</p>
    </div>
  </Modal>;
}
