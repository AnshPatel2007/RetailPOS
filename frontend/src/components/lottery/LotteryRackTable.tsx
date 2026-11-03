import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { Table, TableHead, TableHeader, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { LotteryRack, BarcodeProfile, lotteryMoney } from '@/services/lotteryWorkbench';
import { parseRackInput, rackSold, ticketLabel, ticketWidth } from '@/services/lotteryRackInput';
import '@/styles/lottery-rack.css';

function ClosingCell({ row, disabled, profile, update, advance, register }: {
  row: LotteryRack; disabled: boolean; profile: BarcodeProfile | null; update: (changes: Partial<LotteryRack>) => void;
  advance: () => void; register: (input: HTMLInputElement | null) => void;
}) {
  const [error, setError] = useState(''), timer = useRef<ReturnType<typeof setTimeout>>();
  const latest = useRef({ row, update, advance }); latest.current = { row, update, advance };
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = (raw: string, move: boolean) => {
    clearTimeout(timer.current);
    if (!raw) return;
    try { const number = parseRackInput(raw, latest.current.row, profile); latest.current.update({ closingNumber: number }); setError(''); if (move) latest.current.advance(); }
    catch (cause) { setError((cause as Error).message); }
  };
  return <div className="lottery-closing-control">
    <div className="lottery-closing-input">
    <Input ref={register} id={'lottery-rack-' + row.id} aria-label={'Closing number for Bin ' + row.bin} inputMode="numeric" autoComplete="off"
      className="font-medium tabular-nums" disabled={disabled} value={row.closingNumber ?? ''} placeholder="Scan or type" maxLength={100}
      onFocus={e => e.target.select()} onBlur={() => { clearTimeout(timer.current); if (row.closingNumber) commit(row.closingNumber, false); }}
      onChange={e => {
        clearTimeout(timer.current); const raw = e.target.value; update({ closingNumber: raw || null }); setError('');
        // Wait for the whole scanner burst; never advance after its first three digits.
        if (raw.length >= ticketWidth(row)) timer.current = setTimeout(() => commit(raw, true), 220);
      }}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget.value, true); } }}
      error={error} />
    </div>
    {!disabled && <div className="lottery-closing-actions">
      <Button variant="ghost" className="text-xs" onClick={() => { clearTimeout(timer.current); update({ finishedRolls: row.finishedRolls + 1, closingNumber: null }); setError(''); }} disabled={row.finishedRolls >= 100}>New roll{row.finishedRolls ? ' (' + row.finishedRolls + ')' : ''}</Button>
      <ActionMenu iconOnly label={'More count options for Bin ' + row.bin} items={[
        { id: 'soldout', label: 'Last roll sold out', onAction: () => { clearTimeout(timer.current); update({ closingNumber: String(row.direction === 'ASC' ? row.lastTicket + 1 : row.firstTicket - 1) }); setError(''); } },
        ...(row.finishedRolls ? [{ id: 'undo', label: 'Undo new roll', onAction: () => { clearTimeout(timer.current); update({ finishedRolls: row.finishedRolls - 1, closingNumber: null }); setError(''); } }] : []),
      ]} />
    </div>}
  </div>;
}
export function LotteryRackTable({ rows, disabled, profile, onChange }: { rows: LotteryRack[]; disabled: boolean; profile: BarcodeProfile | null; onChange: (rows: LotteryRack[]) => void }) {
  const inputs = useRef(new Map<string, HTMLInputElement>()), [status, setStatus] = useState('');
  const ordered = [...rows].sort((a, b) => a.bin.localeCompare(b.bin, undefined, { numeric: true }) || a.id.localeCompare(b.id));
  const counted = rows.filter(row => rackSold(row) !== null).length;
  return <section className="space-y-3">
    <div className="lottery-rack-instructions"><p>{disabled ? 'Saved counts' : 'Scan or type the next unsold ticket. Moves to the next row automatically.'}</p><span className="lottery-count-progress">{counted} of {rows.length} counted</span></div>
    <div className="lottery-rack-table"><Table aria-label="Scratch ticket counts"><TableHeader><TableRow>
      <TableHead>Bin</TableHead><TableHead>Lottery</TableHead><TableHead>Opening number</TableHead><TableHead>Closing number</TableHead><TableHead className="text-right">Tickets sold</TableHead><TableHead className="text-right">Ticket price</TableHead><TableHead className="text-right">Total sales</TableHead>
    </TableRow></TableHeader><TableBody>{ordered.map((row, index) => {
      const sold = rackSold(row);
      return <TableRow key={row.id} className="lottery-rack-row"><TableCell className="lottery-bin-cell"><span className="lottery-mobile-label" aria-hidden="true">Bin</span><span className="font-semibold">{row.bin}</span></TableCell><TableCell className="lottery-game-cell"><p className="font-medium">{row.name}</p><p className="text-xs text-muted-foreground">Game {row.gameNumber}</p></TableCell>
        <TableCell className="lottery-opening-cell tabular-nums"><span className="lottery-mobile-label" aria-hidden="true">Opening number</span>{ticketLabel(row.openingNumber, row)}</TableCell>
        <TableCell className="lottery-closing-cell"><span className="lottery-mobile-label" aria-hidden="true">Closing number</span>{disabled ? <span className="tabular-nums">{ticketLabel(row.closingNumber, row) || 'Not entered'}</span> : <ClosingCell row={row} disabled={disabled} profile={profile}
          register={input => { if (input) inputs.current.set(row.id, input); else inputs.current.delete(row.id); }}
          update={changes => onChange(rows.map(item => item.id === row.id ? { ...item, ...changes } : item))}
          advance={() => { const next = ordered[index + 1]; if (next) { inputs.current.get(next.id)?.focus(); inputs.current.get(next.id)?.select(); } else setStatus('Last row entered. Save the daily entry when ready.'); }} />}</TableCell>
        <TableCell className="lottery-sold-cell text-right tabular-nums"><span className="lottery-mobile-label" aria-hidden="true">Tickets sold</span>{sold ?? '—'}</TableCell><TableCell className="lottery-price-cell text-right tabular-nums"><span className="lottery-mobile-label" aria-hidden="true">Ticket price</span>{lotteryMoney(row.price)}</TableCell><TableCell className="lottery-total-cell text-right font-medium tabular-nums"><span className="lottery-mobile-label" aria-hidden="true">Total sales</span>{sold === null ? '—' : lotteryMoney(Math.round(Number(row.price) * 100) * sold / 100)}</TableCell>
      </TableRow>;
    })}{!rows.length && <TableRow><TableCell colSpan={7}>Add your games and bin numbers in Ticket Setup.</TableCell></TableRow>}</TableBody></Table></div>
    <p className="text-xs text-muted-foreground">Opening numbers carry forward from the previous entry. Use New roll when ticket numbers restart.</p>
    <p role="status" className="text-xs text-muted-foreground">{status}</p>
  </section>;
}
