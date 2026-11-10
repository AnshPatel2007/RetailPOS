import { Checkbox } from '@/components/ui/Checkbox';
import { ReactNode, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { useSavedOperation } from '@/hooks/useSavedOperation';
import { LotteryGame, lotteryRead, lotteryMoney } from '@/services/lotteryWorkbench';
import { LotteryError, LotteryRecovery } from './LotteryFields';

const blank = { binNumber: '', ticketName: '', ticketCode: '', gameNumber: '', pricePerTicket: '', firstTicket: '0', lastTicket: '', startingNumber: '', countDirection: 'ASC', isActive: true };
export function LotteryGameSetup({ locationId, readOnly, onActionsChange }: { locationId: string; readOnly: boolean; onActionsChange: (node: ReactNode) => void }) {
  const [edit, setEdit] = useState<LotteryGame | 'new' | null>(null), [form, setForm] = useState(blank);
  const query = useScopedQuery<LotteryGame[]>(['lottery-games', locationId], signal => lotteryRead('/games', locationId, signal), true, 30000, { paused: !!edit });
  const operation = useSavedOperation('lottery-games', '/lottery/v2/games', () => { setEdit(null); void query.refresh(); });
  const open = (game?: LotteryGame) => { setEdit(game || 'new'); setForm(game ? { binNumber: game.binNumber || '', ticketName: game.ticketName, ticketCode: game.ticketCode, gameNumber: game.gameNumber || '',
    pricePerTicket: String(game.pricePerTicket), firstTicket: String(game.firstTicket ?? 0), lastTicket: String(game.lastTicket ?? 59), startingNumber: String(game.startingNumber ?? (game.countDirection === 'DESC' ? game.lastTicket ?? 59 : game.firstTicket ?? 0)), countDirection: game.countDirection || 'ASC', isActive: game.isActive } : blank); };
  useEffect(() => { onActionsChange(!readOnly ? <Button onClick={() => open()} disabled={operation.blocked}><Plus />Add game</Button> : null); return () => onActionsChange(null); }, [onActionsChange, readOnly, operation.blocked]);
  const valid = form.binNumber.trim() && form.ticketName.trim() && /^\d+$/.test(form.gameNumber) && /^\d+(\.\d{1,2})?$/.test(form.pricePerTicket) && Number(form.pricePerTicket) > 0 &&
    [form.firstTicket, form.lastTicket, form.startingNumber].every(value => /^\d{1,6}$/.test(value)) && Number(form.lastTicket) >= Number(form.firstTicket) && Number(form.lastTicket) - Number(form.firstTicket) < 10000 && Number(form.startingNumber) >= Number(form.firstTicket) && Number(form.startingNumber) <= Number(form.lastTicket);
  const save = () => operation.submit({ label: 'Save lottery game', path: '/lottery/v2/games', payload: { ...(edit && edit !== 'new' ? { id: edit.id, expectedUpdatedAt: edit.updatedAt } : {}),
    game: { ...form, ticketCode: form.ticketCode || form.gameNumber, firstTicket: Number(form.firstTicket), lastTicket: Number(form.lastTicket), startingNumber: Number(form.startingNumber) } } });
  return <div className="space-y-4"><LotteryError error={query.error} retry={() => void query.refresh()} /><LotteryRecovery operation={operation} />
    {query.loading && !query.data ? <p role="status">Loading games…</p> : <div className="rounded-lg border overflow-x-auto"><Table><TableHeader><TableRow>
      <TableHead>Bin</TableHead><TableHead>Lottery</TableHead><TableHead>Ticket numbers</TableHead><TableHead className="text-right">Ticket price</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead>
    </TableRow></TableHeader><TableBody>{[...(query.data || [])].sort((a, b) => (a.binNumber || '').localeCompare(b.binNumber || '', undefined, { numeric: true })).map(game => <TableRow key={game.id}>
      <TableCell className="font-semibold">{game.binNumber || 'Not set'}</TableCell><TableCell><p className="font-medium">{game.ticketName}</p><p className="text-xs text-muted-foreground">Game {game.gameNumber || 'not set'}</p></TableCell>
      <TableCell className="tabular-nums">{game.firstTicket == null || game.lastTicket == null ? 'Not set' : String(game.firstTicket).padStart(3, '0') + '–' + String(game.lastTicket).padStart(3, '0')}</TableCell><TableCell className="text-right tabular-nums">{lotteryMoney(game.pricePerTicket)}</TableCell>
      <TableCell>{game.isActive ? 'Active' : 'Inactive'}</TableCell><TableCell>{!readOnly && <Button variant="outline" disabled={operation.blocked} onClick={() => open(game)}>Edit</Button>}</TableCell></TableRow>)}
      {query.data?.length === 0 && <TableRow><TableCell colSpan={6}>Add a game with its bin, ticket price and starting number.</TableCell></TableRow>}
    </TableBody></Table></div>}
    {edit && <Modal isOpen title={edit === 'new' ? 'Add lottery game' : 'Edit lottery game'} size="lg" onClose={() => { if (!operation.busy) setEdit(null); }} footer={<div className="flex justify-end gap-2">
      <Button variant="outline" disabled={operation.busy} onClick={() => setEdit(null)}>Cancel</Button><Button disabled={operation.blocked || !valid} onClick={() => void save()}>Save game</Button></div>}>
      <div className="space-y-4"><LotteryRecovery operation={operation} /><fieldset disabled={operation.blocked} className="grid gap-4 sm:grid-cols-2">
        {([['binNumber', 'Bin number'], ['ticketName', 'Lottery name'], ['gameNumber', 'Game number'], ['pricePerTicket', 'Ticket price'], ['firstTicket', 'Lowest ticket number'], ['lastTicket', 'Highest ticket number'], ['startingNumber', 'Starting number']] as const).map(([key, label]) =>
          <Input key={key} label={label} value={form[key]} inputMode={['ticketName', 'binNumber'].includes(key) ? 'text' : 'decimal'} onChange={e => setForm({ ...form, [key]: e.target.value })} />)}
        <Select label="Numbering direction" value={form.countDirection} onChange={e => setForm({ ...form, countDirection: e.target.value })}><option value="ASC">Numbers go up</option><option value="DESC">Numbers go down</option></Select>
        <Checkbox label="Show in daily entry" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} />
      </fieldset><p className="text-xs text-muted-foreground">Starting number is used for the first entry only. Later opening numbers carry forward automatically. Game changes apply to new daily entries.</p></div>
    </Modal>}
  </div>;
}
