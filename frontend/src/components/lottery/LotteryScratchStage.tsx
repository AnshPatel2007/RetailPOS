import { RefObject, useMemo, useState } from 'react';
import { ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { LotteryCheckpoint, LotteryDay, LotteryReport, lotteryBookStatus, lotteryMoney, manualLottery } from '@/services/lotteryWorkbench';
import { LotteryError, LotteryMoneyFields, LotterySection } from './LotteryFields';
import { LotteryDisclosure } from './LotteryReportStages';

export type BookDialogSelection = { kind: 'new' | 'replace' | 'checkpoint' | 'adjust' | 'soldout'; checkpoint?: LotteryCheckpoint; intent?: 'move' | 'pause' | 'return' | 'loss' | 'resume' };
type Props = { day: LotteryDay; report: LotteryReport; blocked: boolean; countsBlocked: boolean; manager: boolean; readOnly: boolean;
  persist: (report: LotteryReport) => void; openBook: (dialog: BookDialogSelection) => void; scanner: RefObject<HTMLInputElement>;
  scan: string; setScan: (value: string) => void; scanError: string; scanStatus: string; lastBook: string; submitScan: () => Promise<void> };

export function LotteryScratchStage({ day, report, blocked, countsBlocked, manager, readOnly, persist, openBook, scanner, scan, setScan, scanError, scanStatus, lastBook, submitScan }: Props) {
  const [needsCounting, setNeedsCounting] = useState(false);
  const rows = useMemo(() => [...day.checkpoints].sort((a, b) => a.slot.localeCompare(b.slot, undefined, { numeric: true }) || a.id.localeCompare(b.id)), [day.checkpoints]);
  const counted = rows.filter(row => row.openingVerified && row.closingPosition !== null).length, closed = day.status === 'CLOSED';
  return <div className="space-y-4">
    {manualLottery(day.configuration) && <LotterySection title="Scratch-ticket rack" actions={<div className="flex flex-wrap items-center gap-4 text-sm"><span role="status">{counted} of {rows.length} books counted</span><label className="inline-flex items-center gap-2 min-h-9 max-sm:min-h-11"><input type="checkbox" checked={needsCounting} onChange={e => setNeedsCounting(e.target.checked)} />Needs counting</label></div>}>
      {!closed && <form onSubmit={e => { e.preventDefault(); void submitScan(); }} className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-48"><Input ref={scanner} label="Inventory barcode" value={scan} onChange={e => setScan(e.target.value)} maxLength={100} autoComplete="off" disabled={countsBlocked || !day.configuration.barcodeProfile} placeholder="Scan the next unsold ticket" /></div>
        <Button type="submit" variant="outline" disabled={countsBlocked || !scan || !day.configuration.barcodeProfile}><ScanLine />Save scan</Button>
      </form>}
      {!closed && !day.configuration.barcodeProfile && <p className="text-xs text-muted-foreground">Scanner setup has not been verified. Enter the closing number beside each book.</p>}
      <LotteryError error={scanError} />
      <p role="status" aria-live="polite" className="min-h-5 text-xs text-muted-foreground">{scanStatus || (closed ? 'Confirmed counts for this day.' : 'Scan each bin, or enter its closing number below.')}</p>
      <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow>
        <TableHead>Bin</TableHead><TableHead>Game / book</TableHead><TableHead>Opening</TableHead><TableHead>Closing</TableHead><TableHead className="text-right">Sold</TableHead><TableHead className="text-right">Sales</TableHead><TableHead>Actions</TableHead>
      </TableRow></TableHeader><TableBody>{rows.filter(row => !needsCounting || !row.openingVerified || row.closingPosition === null || row.bookId === lastBook).map(row => {
        const sold = row.closingPosition === null || !row.openingVerified ? null : row.closingPosition - row.openingPosition - row.lossQuantity;
        const available = row.openingVerified && ['ACTIVE', 'DEPLETED'].includes(row.disposition);
        return <TableRow id={'lottery-book-' + row.bookId} key={row.id} className={row.bookId === lastBook ? 'bg-primary/5' : ''}>
          <TableCell className="font-semibold whitespace-nowrap">{row.slot}</TableCell>
          <TableCell><p className="font-medium min-w-36">{row.book.name}</p><p className="text-xs text-muted-foreground">Game {row.book.gameNumber} · Book {row.book.bookNumber}</p>
            <p className="text-xs text-muted-foreground">{lotteryMoney(row.book.price)} each{row.disposition !== 'ACTIVE' ? ' · ' + lotteryBookStatus(row.disposition) : ''}{row.lossQuantity ? ` · ${row.lossQuantity} removed, not sold` : ''}</p></TableCell>
          <TableCell className="tabular-nums">{row.openingTicket ?? 'Sold out'}{!row.openingVerified && <p className="text-xs text-muted-foreground">Verify opening</p>}</TableCell>
          <TableCell className="font-medium tabular-nums">{row.closingPosition === null ? 'Not counted' : row.closingTicket ?? 'Sold out'}</TableCell>
          <TableCell className="text-right tabular-nums">{sold ?? '—'}</TableCell><TableCell className="text-right tabular-nums">{sold === null ? '—' : lotteryMoney(sold * Number(row.book.price))}</TableCell>
          <TableCell>{!readOnly && !closed && <div className="flex items-center gap-1">
            <Button variant="outline" disabled={countsBlocked} onClick={() => openBook({ kind: 'checkpoint', checkpoint: row })}>{row.openingVerified ? 'Enter number' : 'Verify opening'}</Button>
            {manager && <ActionMenu iconOnly label={`Actions for Bin ${row.slot}, book ${row.book.bookNumber}`} items={[
              { id: 'soldout', label: 'Sold out', disabled: countsBlocked || !available || row.disposition === 'DEPLETED', onAction: () => openBook({ kind: 'soldout', checkpoint: row }) },
              { id: 'replace', label: 'Sold out & replace', disabled: countsBlocked || !available, onAction: () => openBook({ kind: 'replace', checkpoint: row }) },
              ...([{ id: 'move', label: 'Move to another bin' }, { id: row.disposition === 'PAUSED' ? 'resume' : 'pause', label: row.disposition === 'PAUSED' ? 'Return to rack' : 'Pause book' }, { id: 'return', label: 'Return to lottery' }, { id: 'loss', label: 'Record missing or damaged tickets' }] as const).map(item => ({ ...item, disabled: countsBlocked || !row.openingVerified, onAction: () => openBook({ kind: 'adjust', checkpoint: row, intent: item.id }) })),
            ]} />}
          </div>}</TableCell>
        </TableRow>;
      })}
      {!rows.length && <TableRow><TableCell colSpan={7}>No books on the rack for this day. Add a book or explain the empty rack below.</TableCell></TableRow>}
      {rows.length > 0 && needsCounting && counted === rows.length && !lastBook && <TableRow><TableCell colSpan={7}>Every book has been counted.</TableCell></TableRow>}
      </TableBody></Table></div>
      {!rows.length && <Input id="lottery-noBooksReason" label="Reason for an empty rack" value={report.noBooksReason} disabled={blocked} onChange={e => persist({ ...report, noBooksReason: e.target.value })} />}
    </LotterySection>}
    {report.dispensers.map((source, index) => {
      const update = (change: Partial<typeof source>) => persist({ ...report, dispensers: report.dispensers.map((row, i) => i === index ? { ...row, ...change } : row) });
      const net = [source.grossSales, source.cancellations].every(value => value !== null && /^\d+(\.\d{1,2})?$/.test(value)) ? Number(source.grossSales) - Number(source.cancellations) : null;
      return <LotterySection key={source.sourceId} title={day.configuration.dispensers.find(item => item.id === source.sourceId)?.name || 'Dispenser report'} description="Enter this machine's daily scratch sales. Record store-wide prize payouts once in the terminal report.">
        <fieldset disabled={blocked} className="space-y-4"><div className="max-w-md"><Input id={`lottery-dispenser-${source.sourceId}-reference`} label="Dispenser report reference" value={source.reference} maxLength={150} onChange={e => update({ reference: e.target.value })} /></div>
          <LotteryMoneyFields idPrefix={`lottery-dispenser-${source.sourceId}-`} fields={[[ 'grossSales', 'Gross scratch sales' ], [ 'cancellations', 'Scratch cancellations' ]]} values={source} onChange={(key, value) => update({ [key]: value })} />
          <div className="flex justify-between gap-3 rounded-md bg-muted/40 p-3 text-sm"><span>Net scratch sales</span><strong className="tabular-nums">{lotteryMoney(net)}</strong></div>
          <LotteryDisclosure title="Per-game details" detail="Optional" initiallyOpen={source.games.length > 0}>
            {source.games.map((game, gameIndex) => <div className="grid gap-3 sm:grid-cols-4" key={gameIndex}>
              <Input label="Game number" value={game.gameNumber} inputMode="numeric" onChange={e => update({ games: source.games.map((item, j) => j === gameIndex ? { ...item, gameNumber: e.target.value } : item) })} />
              <Input label="Tickets sold (optional)" value={game.quantity ?? ''} type="number" min="0" step="1" onChange={e => update({ games: source.games.map((item, j) => j === gameIndex ? { ...item, quantity: e.target.value === '' ? null : Number(e.target.value) } : item) })} />
              <Input label="Net game sales" inputMode="decimal" value={game.amount} onChange={e => update({ games: source.games.map((item, j) => j === gameIndex ? { ...item, amount: e.target.value } : item) })} />
              <Button variant="outline" className="self-end" onClick={() => update({ games: source.games.filter((_, j) => j !== gameIndex) })}>Remove game</Button>
            </div>)}
            <Button variant="outline" onClick={() => update({ games: [...source.games, { gameNumber: '', quantity: null, amount: '' }] })}>Add game detail</Button>
            <p className="text-xs text-muted-foreground">Ticket quantities remain unknown unless supplied by this report.</p>
          </LotteryDisclosure>
        </fieldset>
      </LotterySection>;
    })}
  </div>;
}
