import { formatDateTime } from '@/lib/utils';
import { useState } from 'react';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { LotteryEvent, lotteryMoney, lotteryRead } from '@/services/lotteryWorkbench';
import { LotteryError } from './LotteryFields';

const actionNames: Record<string, string> = { REVIEW_DAY: 'Daily entry started', OPEN_DAY: 'Day opened', SAVE_REPORT: 'Report saved', CHECKPOINT: 'Book count updated', VERIFY_OPENING: 'Opening verified', REGISTER_BOOK: 'Book added', REPLACE_BOOK: 'Book replaced', CLOSE_DAY: 'Day closed', REOPEN_DAY: 'Day reopened', CORRECTION: 'Correction recorded' };
export function LotteryDayHistory({ locationId, date, version }: { locationId: string; date: string; version: number }) {
  const [open, setOpen] = useState(false);
  const query = useScopedQuery<{ events: LotteryEvent[]; earnings: { id: string; amount: string; reason: string }[] }>(['lottery-day-history', locationId, date, version], signal => lotteryRead('/days/' + date + '/history', locationId, signal), open);
  return <details open={open} onToggle={e => setOpen(e.currentTarget.open)} className="rounded-lg border bg-card p-4">
    <summary className="cursor-pointer text-sm font-medium">Corrections & activity history</summary>
    <div className="pt-4 space-y-3"><LotteryError error={query.error} retry={() => void query.refresh()} />
      {query.loading && !query.data && <p role="status" className="text-sm">Loading day history…</p>}
      {query.data?.events.map(event => <div key={event.id} className="border-b pb-3 last:border-0 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{actionNames[event.action] || event.action.toLowerCase().replace(/_/g, ' ')}</span><time className="text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</time></div>
        {event.action === 'CORRECTION' ? <><p>{String(event.details.reason)}</p><p className="text-xs text-muted-foreground">Reference {String(event.details.reference)} · Collections {lotteryMoney(String(event.details.netCollections))} · Earnings {lotteryMoney(String(event.details.earnings))}</p></>
          : typeof event.details.reason === 'string' && <p className="text-muted-foreground">{event.details.reason}</p>}
      </div>)}
      {!!query.data?.earnings.length && <div className="border-t pt-3 space-y-2"><h3 className="text-sm font-semibold">Recorded earnings</h3>{query.data.earnings.map(row => <p key={row.id} className="flex justify-between gap-3 text-sm"><span>{row.reason}</span><span className="tabular-nums">{lotteryMoney(row.amount)}</span></p>)}</div>}
      {query.data && <p className="text-xs text-muted-foreground">Most recent 100 entries for this day.</p>}
    </div>
  </details>;
}
