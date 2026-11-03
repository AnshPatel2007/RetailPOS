import { useScopedQuery } from '@/hooks/useScopedQuery';
import { LotteryBook, LotteryCheckpoint, lotteryRead, lotteryMoney, lotteryBookStatus } from '@/services/lotteryWorkbench';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { Button } from '@/components/ui/Button';
import { LotteryError } from './LotteryFields';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { useNavigate } from 'react-router-dom';
import { useUrlFilter, useUrlPage, useUrlFilterPatch } from '@/hooks/useUrlFilter';

function BookDetails({ locationId, id, onClose }: { locationId: string; id: string; onClose: () => void }) {
  const navigate = useNavigate();
  const query = useScopedQuery<{ book: LotteryBook; counts: (LotteryCheckpoint & { businessDate: string; dayStatus: string })[]; settlements: { id: string; reference: string; periodStart: string; periodEnd: string }[] }>(['lottery-book-detail', locationId, id], signal => lotteryRead('/books/' + id, locationId, signal));
  const book = query.data?.book;
  return <Modal isOpen title={book ? book.name + ' · Book ' + book.bookNumber : 'Book details'} size="lg" onClose={onClose} footer={<Button variant="outline" onClick={onClose}>Close</Button>}>
    <div className="space-y-5"><LotteryError error={query.error} retry={() => void query.refresh()} />
      {book && <dl className="grid grid-cols-2 gap-4 text-sm">{[['Game', book.gameNumber], ['Bin', book.slot], ['Status', lotteryBookStatus(book.status)], ['Tickets remaining', book.ticketCount - book.position], ['Full book value', lotteryMoney(book.ticketCount * Number(book.price))], ['Started tracking', book.registeredDate]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-medium mt-1">{value}</dd></div>)}</dl>}
      <section className="space-y-3"><h3 className="text-lg font-semibold">Daily counts</h3>{query.loading && !query.data && <p role="status">Loading book history…</p>}
        <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Opening</TableHead><TableHead>Closing</TableHead><TableHead className="text-right">Sold</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{query.data?.counts.map(row =>
          <TableRow key={row.id}><TableCell><Button variant="ghost" onClick={() => navigate('/lottery?tab=daily&date=' + row.businessDate + '&lotteryView=scratch')}>{row.businessDate}</Button></TableCell><TableCell>{row.openingTicket ?? 'Sold out'}</TableCell><TableCell>{row.closingPosition === null ? 'Pending' : row.closingTicket ?? 'Sold out'}</TableCell><TableCell className="text-right tabular-nums">{row.closingPosition === null || !row.openingVerified ? '—' : row.closingPosition - row.openingPosition - row.lossQuantity}</TableCell><TableCell>{row.dayStatus === 'CLOSED' ? 'Closed' : 'Draft'}</TableCell></TableRow>)}
          {query.data && !query.data.counts.length && <TableRow><TableCell colSpan={5}>No daily counts recorded.</TableCell></TableRow>}
        </TableBody></Table></div><p className="text-xs text-muted-foreground">Latest 100 daily entries. Draft counts are not confirmed inventory balances.</p>
      </section>
      <section className="space-y-3"><h3 className="text-lg font-semibold">Settlement references</h3>{query.data?.settlements.map(item => <div key={item.id} className="text-sm"><Button variant="ghost" onClick={() => navigate('/lottery?tab=reports&lotteryReport=settlements&lotteryFrom=' + item.periodStart + '&lotteryTo=' + item.periodEnd)}>{item.reference}</Button><p className="text-xs text-muted-foreground">{item.periodStart} – {item.periodEnd}</p></div>)}{query.data && !query.data.settlements.length && <p className="text-sm text-muted-foreground">No settlement linked to this book.</p>}</section>
    </div>
  </Modal>;
}

export function LotteryBookRegister({ locationId }: { locationId: string }) {
  const [page, setPage] = useUrlPage(), [search] = useUrlFilter('bookSearch'), [status] = useUrlFilter('bookStatus'), patch = useUrlFilterPatch();
  const [selected, setSelected] = useUrlFilter('record', '', false);
  const query = useScopedQuery<{ records: LotteryBook[]; pagination: { total: number; totalPages: number } }>(['lottery-book-register', locationId, page, search, status], signal => lotteryRead('/books', locationId, signal, { page, search, ...(status ? { status } : {}) }), true, 30000, { paused: !!selected });
  return <div className="space-y-3"><LotteryError error={query.error} retry={() => void query.refresh()} />
    <div className="flex flex-wrap gap-3 items-end"><div className="flex-1 min-w-48"><Input label="Find a book" placeholder="Game, book number or bin" value={search} onChange={e => patch({ bookSearch: e.target.value })} /></div><div className="w-48"><Select label="Book status" value={status} onChange={e => patch({ bookStatus: e.target.value })}><option value="">All books</option>{['ACTIVE', 'PAUSED', 'DEPLETED', 'RETURNED', 'LOST'].map(value => <option key={value} value={value}>{lotteryBookStatus(value)}</option>)}</Select></div><span className="pb-2 text-sm text-muted-foreground">{query.data?.pagination.total ?? '…'} books</span></div>
    <p className="text-xs text-muted-foreground">Remaining tickets reflect confirmed closes. Add or replace books in Daily Entry.</p>
    <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Bin</TableHead><TableHead>Game / book</TableHead><TableHead>Next unsold</TableHead><TableHead className="text-right">Remaining</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Full book value</TableHead></TableRow></TableHeader><TableBody>
      {query.data?.records.map(book => <TableRow key={book.id}><TableCell className="font-medium">{book.slot}</TableCell><TableCell><Button variant="ghost" onClick={() => setSelected(book.id)}>{book.name}</Button><p className="text-xs text-muted-foreground">Game {book.gameNumber} · Book {book.bookNumber}</p></TableCell><TableCell className="tabular-nums">{book.position === book.ticketCount ? 'Sold out' : String(book.direction === 'ASC' ? book.firstTicket + book.position : book.lastTicket - book.position).padStart(Math.max(3, String(book.lastTicket).length), '0')}</TableCell><TableCell className="text-right tabular-nums">{book.ticketCount - book.position}</TableCell><TableCell>{lotteryBookStatus(book.status)}</TableCell><TableCell className="text-right tabular-nums">{lotteryMoney(book.ticketCount * Number(book.price))}</TableCell></TableRow>)}
      {!query.data?.records.length && <TableRow><TableCell colSpan={6}>{query.loading ? 'Loading books…' : search || status ? 'No books match these filters.' : 'No books registered.'}</TableCell></TableRow>}
    </TableBody></Table></div>
    {(query.data?.pagination.totalPages || 0) > 1 && <div className="flex justify-end gap-3 items-center text-sm"><span>{query.data?.pagination.total} books · Page {page}</span><Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="outline" disabled={page >= (query.data?.pagination.totalPages || 0)} onClick={() => setPage(page + 1)}>Next</Button></div>}
    {selected && <BookDetails locationId={locationId} id={selected} onClose={() => setSelected('')} />}
  </div>;
}
