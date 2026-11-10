import { Checkbox } from '@/components/ui/Checkbox';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { LotteryGame, lotteryRead, lotteryMoney, lotteryError } from '@/services/lotteryWorkbench';
import { LotteryError } from './LotteryFields';
import type { BookDialogSelection } from './LotteryScratchStage';

type Props = BookDialogSelection & { locationId: string; date: string; barcodeEnabled: boolean; owner: boolean; blocked: boolean; error: string;
  onClose: () => void; onSubmit: (action: string, payload: Record<string, unknown>) => Promise<unknown> };

export function LotteryBookDialog({ locationId, date, barcodeEnabled, checkpoint, kind, intent, owner, blocked, error, onClose, onSubmit }: Props) {
  const adding = kind === 'new' || kind === 'replace', opening = kind === 'checkpoint' && !checkpoint?.openingVerified;
  const query = useScopedQuery<LotteryGame[]>(['lottery-games', locationId], signal => lotteryRead('/games', locationId, signal), adding);
  const [ticketTypeId, setGame] = useState(checkpoint?.book.ticketTypeId || ''), [bookNumber, setBook] = useState(''), [slot, setSlot] = useState(checkpoint?.slot || '');
  const [direction, setDirection] = useState(checkpoint?.book.direction || 'ASC');
  const [nextTicket, setTicket] = useState(adding ? '' : checkpoint?.closingTicket ?? checkpoint?.openingTicket ?? '');
  const [reason, setReason] = useState(''), [resetOpening, setResetOpening] = useState(false), [loss, setLoss] = useState(String(checkpoint?.lossQuantity || 0));
  const [barcode, setBarcode] = useState(''), [scanError, setScanError] = useState(''), [scanning, setScanning] = useState(false);
  const scanFlight = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const selected = query.data?.find(game => game.id === ticketTypeId);
  const scanBook = async () => {
    if (scanFlight.current || !barcode || blocked) return;
    scanFlight.current = true; setScanning(true); setScanError('');
    try {
      const parsed = (await api.post('/lottery/v2/days/' + date + '/scan-preview', { raw: barcode })).data.data as { game: string; book: string; ticket: string; bookId: string | null };
      if (!alive.current) return;
      const game = query.data?.find(item => item.gameNumber === parsed.game && item.isActive);
      if (!game) { setScanError('Add the scanned game in Ticket Setup first.'); return; }
      if (parsed.bookId) { setScanError('This book is already registered. Select its row in Daily Entry.'); return; }
      setGame(game.id); setBook(parsed.book); setTicket(parsed.ticket); setBarcode('');
    } catch (cause) { if (alive.current) setScanError(lotteryError(cause)); }
    finally { scanFlight.current = false; if (alive.current) setScanning(false); }
  };
  const title = kind === 'replace' ? 'Sold out & start next book' : kind === 'new' ? 'Add a book to the rack' : kind === 'soldout' ? 'Confirm book sold out' : kind === 'adjust'
    ? ({ move: 'Move book', pause: 'Pause book', return: 'Return book to lottery', loss: 'Missing or damaged tickets', resume: 'Return book to rack' }[intent!] || 'Update book')
    : opening ? 'Verify opening number' : 'Enter closing number';
  const submit = () => onSubmit(adding ? 'books' : 'checkpoint', adding
    ? { book: { ticketTypeId, bookNumber, slot, direction, nextTicket: Number(nextTicket), evidence: reason }, ...(kind === 'replace' ? { depletedBookId: checkpoint!.bookId } : {}) }
    : { bookId: checkpoint!.bookId, ...(kind === 'soldout' ? { soldOut: true } : { nextTicket: Number(nextTicket) }), opening,
      ...(resetOpening ? { resetOpening: true } : {}), ...(reason.trim() ? { reason } : {}),
      ...(kind === 'adjust' ? { slot, lossQuantity: Number(loss), disposition: intent === 'pause' ? 'PAUSED' : intent === 'return' ? 'RETURNED' : intent === 'resume' ? 'ACTIVE' : checkpoint!.disposition === 'DEPLETED' ? 'ACTIVE' : checkpoint!.disposition } : {}) });
  const invalid = blocked || scanning || (kind !== 'soldout' && !/^\d+$/.test(nextTicket)) || (adding && (!ticketTypeId || !bookNumber || !slot || reason.trim().length < 3)) || ((kind === 'adjust' || resetOpening) && reason.trim().length < 3);
  const remaining = checkpoint ? checkpoint.book.ticketCount - (checkpoint.closingPosition ?? checkpoint.openingPosition) : 0;
  return <Modal isOpen title={title} size={adding ? 'lg' : 'md'} onClose={() => { if (!blocked) onClose(); }} footer={<div className="flex justify-end gap-2">
    <Button variant="outline" disabled={blocked} onClick={onClose}>Cancel</Button><Button disabled={invalid} onClick={() => void submit()}>{kind === 'replace' ? 'Confirm replacement' : kind === 'soldout' ? 'Confirm sold out' : adding ? 'Add book' : kind === 'adjust' ? 'Save change' : 'Save number'}</Button>
  </div>}>
    <div className="space-y-4"><LotteryError error={error || query.error || scanError} />
      {checkpoint && <div className="rounded-md bg-muted/40 p-3 text-sm"><p className="font-medium">Bin {checkpoint.slot} · {checkpoint.book.name}</p><p className="text-xs text-muted-foreground mt-1">Game {checkpoint.book.gameNumber} · Book {checkpoint.book.bookNumber} · Opening {checkpoint.openingTicket ?? 'Sold out'}</p></div>}
      {(kind === 'replace' || kind === 'soldout') && <div className="rounded-md border p-3 text-sm space-y-2"><p><strong>{remaining} remaining tickets</strong> will be marked sold ({lotteryMoney(remaining * Number(checkpoint?.book.price))}).</p><p className="text-xs text-muted-foreground">Previously recorded missing or damaged tickets remain excluded. Confirm that this book is physically empty.</p></div>}
      {adding && barcodeEnabled && <div className="flex flex-wrap items-end gap-2"><div className="flex-1 min-w-40"><Input label="Scan new book inventory code" value={barcode} disabled={blocked || scanning || !query.data} maxLength={100} onChange={e => setBarcode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void scanBook(); } }} /></div><Button variant="outline" disabled={blocked || scanning || !query.data || !barcode} onClick={() => void scanBook()}>Read book code</Button></div>}
      {kind !== 'soldout' && <fieldset disabled={blocked || scanning} className={adding ? 'grid gap-4 sm:grid-cols-2' : 'space-y-4'}>
        {adding && <><Select label="Game" value={ticketTypeId} onChange={e => setGame(e.target.value)}><option value="">Select game</option>{query.data?.filter(game => game.isActive && game.gameNumber && game.firstTicket !== null).map(game => <option key={game.id} value={game.id}>{game.ticketName} · {game.gameNumber}</option>)}</Select>
          <Input label="Printed book number" inputMode="numeric" value={bookNumber} maxLength={20} onChange={e => setBook(e.target.value)} />
          <Select label="Counting direction" value={direction} onChange={e => setDirection(e.target.value as 'ASC' | 'DESC')}><option value="ASC">Ascending (000, 001, 002…)</option><option value="DESC">Descending (059, 058, 057…)</option></Select></>}
        {(adding || intent === 'move' || intent === 'resume') && <Input label="Rack / bin" value={slot} maxLength={80} onChange={e => setSlot(e.target.value)} />}
        <Input label={kind === 'replace' ? 'New book next unsold ticket' : opening ? 'Opening number' : adding ? 'Next unsold ticket' : 'Closing number'} description="The next ticket available to sell." inputMode="numeric" value={nextTicket} maxLength={6} onChange={e => setTicket(e.target.value)} />
        {intent === 'loss' && <Input label="Tickets removed but not sold" description="Missing, damaged or stolen tickets within today's counted movement." value={loss} type="number" min="0" step="1" onChange={e => setLoss(e.target.value)} />}
        {opening && owner && <Checkbox label="Confirm a different starting number after the tracking gap" checked={resetOpening} onChange={e => setResetOpening(e.target.checked)} />}
        {(adding || kind === 'adjust' || resetOpening) && <div className={adding ? 'sm:col-span-2' : ''}><Input label={adding ? 'Opening verification notes' : 'Reason for this change'} value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} /></div>}
      </fieldset>}
      {selected && adding && <p className="text-xs text-muted-foreground">Tickets {selected.firstTicket}–{selected.lastTicket} · {lotteryMoney(selected.pricePerTicket)} each. This opening does not record earlier sales.</p>}
      {kind === 'adjust' && <p className="text-xs text-muted-foreground">Unsold tickets are not counted as sales when a book is paused or returned. Record actual returns on the Illinois terminal.</p>}
    </div>
  </Modal>;
}
