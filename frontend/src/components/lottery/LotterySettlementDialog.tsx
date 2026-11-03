import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { LotteryBook, LotterySettlement, LotterySettlementInput, lotteryRead, lotteryBookStatus } from '@/services/lotteryWorkbench';
import { LotteryError, LotteryMoneyFields } from './LotteryFields';

export function LotterySettlementDialog({ locationId, start, end, existing, blocked, error, onClose, onSubmit }: {
  locationId: string; start: string; end: string; existing?: LotterySettlement; blocked: boolean; error: string; onClose: () => void;
  onSubmit: (settlement: LotterySettlementInput, version: number) => Promise<unknown>;
}) {
  const [form, setForm] = useState<LotterySettlementInput>(existing?.details || { periodStart: start, periodEnd: end, reference: '', onlineCommission: '', scratchCommission: '', cashingBonus: '', sellingBonus: '', fees: '',
    earningsAdjustment: '', settledBookValue: '', returnedBookValue: '', lotteryAdjustments: '', netDue: '', bankSweep: null, reason: '', settledBookIds: [] });
  const [page, setPage] = useState(1), [verified, setVerified] = useState(false);
  const books = useScopedQuery<{ records: LotteryBook[]; pagination: { page: number; totalPages: number } }>(['lottery-books', locationId, page], signal => lotteryRead('/books', locationId, signal, { page }));
  const update = (key: string, value: unknown) => { setForm(previous => ({ ...previous, [key]: value })); setVerified(false); };
  return <Modal isOpen title={existing ? 'Correct settlement' : 'Reconcile lottery settlement'} size="xl" onClose={() => { if (!blocked) onClose(); }} footer={<div className="flex justify-end gap-2"><Button variant="outline" disabled={blocked} onClick={onClose}>Cancel</Button><Button disabled={blocked || !verified} onClick={() => void onSubmit(form, existing?.version || 0)}>Confirm settlement</Button></div>}>
    <div className="space-y-4"><LotteryError error={error} /><p className="text-sm text-muted-foreground">Enter the period’s actual earnings. Only the difference from earnings already posted is recognized. Settled book value and bank sweeps are retained separately from sales and income.</p>
      <fieldset disabled={blocked} className="space-y-4"><div className="grid gap-4 sm:grid-cols-3"><Input type="date" label="Settlement period start" disabled={!!existing} value={form.periodStart} onChange={e => update('periodStart', e.target.value)} /><Input type="date" label="Settlement period end" disabled={!!existing} value={form.periodEnd} onChange={e => update('periodEnd', e.target.value)} /><Input label="Settlement reference" value={form.reference} maxLength={150} onChange={e => update('reference', e.target.value)} /></div>
        <section className="space-y-3 border-t pt-4"><h3 className="text-lg font-semibold">Lottery earnings</h3>
          <LotteryMoneyFields fields={[[ 'onlineCommission', 'Online commission' ], [ 'scratchCommission', 'Scratch commission' ], [ 'cashingBonus', 'Cashing bonus' ], [ 'sellingBonus', 'Selling bonus' ], [ 'fees', 'Fees' ], [ 'earningsAdjustment', 'Earnings adjustment (+ / −)' ]]} values={form} onChange={(key, value) => update(key, value ?? '')} />
        </section>
        <section className="space-y-3 border-t pt-4"><h3 className="text-lg font-semibold">Book values and adjustments</h3>
          <LotteryMoneyFields fields={[[ 'settledBookValue', 'Settled book face value' ], [ 'returnedBookValue', 'Returned book face value' ], [ 'lotteryAdjustments', 'Other settlement adjustments (+ / −)' ]]} values={form} onChange={(key, value) => update(key, value ?? '')} />
        </section>
        <details className="rounded-md border p-3 space-y-3"><summary className="cursor-pointer font-medium text-sm">Link settled books ({form.settledBookIds.length} selected)</summary><LotteryError error={books.error} retry={() => void books.refresh()} />
          {books.data?.records.map(book => <label key={book.id} className="flex gap-2 min-h-11 items-center text-sm"><input type="checkbox" checked={form.settledBookIds.includes(book.id)} onChange={e => update('settledBookIds', e.target.checked ? [...form.settledBookIds, book.id] : form.settledBookIds.filter(id => id !== book.id))} />{book.name} · Game {book.gameNumber} · Book {book.bookNumber} · {lotteryBookStatus(book.status)}</label>)}
          {(books.data?.pagination.totalPages || 0) > 1 && <div className="flex gap-2"><Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous books</Button><Button variant="outline" disabled={page >= (books.data?.pagination.totalPages || 0)} onClick={() => setPage(page + 1)}>Next books</Button></div>}
          <p className="text-xs text-muted-foreground">Linking a settled book does not mark it physically sold out.</p></details>
        <section className="space-y-3 border-t pt-4"><h3 className="text-lg font-semibold">Balance and bank movement</h3>
          <LotteryMoneyFields fields={[[ 'netDue', 'Printed net due (+ / −)' ], [ 'bankSweep', 'Bank sweep (+ / −, optional)' ]]} values={form} onChange={(key, value) => update(key, value ?? (key === 'bankSweep' ? null : ''))} />
        </section>
        <Input label="Reconciliation evidence / correction reason" value={form.reason} maxLength={2000} onChange={e => update('reason', e.target.value)} />
        <label className="flex gap-2 items-center min-h-11 text-sm"><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} />I compared these totals with the settlement statement and confirmed the reporting period.</label>
      </fieldset>
    </div>
  </Modal>;
}
