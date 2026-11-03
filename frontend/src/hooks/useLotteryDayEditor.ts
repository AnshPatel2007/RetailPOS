import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useScopedQuery } from './useScopedQuery';
import { useSavedOperation } from './useSavedOperation';
import { LotteryDay, LotteryReport, lotteryDraftReportSchema, lotteryRead } from '@/services/lotteryWorkbench';
import { LotteryDraft, reconcileLotteryDraft } from '@/services/lotteryDraft';

export function useLotteryDayEditor(locationId: string, date: string, readOnly: boolean, paused: boolean, onSaved: () => void) {
  const user = useAuthStore(state => state.user), storageKey = `pos-lottery-draft:${user?.id}:${locationId}:${date}`;
  const [draft, setDraft] = useState<LotteryDraft | null>(null), draftRef = useRef<LotteryDraft | null>(null);
  const [day, setDay] = useState<LotteryDay | null>(null), [initialized, setInitialized] = useState(false), [storageError, setStorageError] = useState('');
  const writeDraft = useCallback((next: LotteryDraft | null) => {
    draftRef.current = next; setDraft(next);
    try { if (next) localStorage.setItem(storageKey, JSON.stringify(next)); else localStorage.removeItem(storageKey); setStorageError(''); }
    catch { setStorageError('Your changes could not be saved in this browser. Restore browser storage before leaving.'); }
  }, [storageKey]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw); if (!Number.isInteger(saved.version) || saved.version < 0) throw new Error();
        const restored = { version: saved.version, report: lotteryDraftReportSchema.parse(saved.report), ...(saved.base ? { base: lotteryDraftReportSchema.parse(saved.base) } : {}) };
        draftRef.current = restored; setDraft(restored);
      }
    } catch { setStorageError('The saved draft cannot be read. Restore browser storage before editing.'); }
    setInitialized(true);
  }, [storageKey]);
  const query = useScopedQuery<LotteryDay>(['lottery-day', locationId, date], signal => lotteryRead('/days/' + date, locationId, signal), initialized, 30000, { paused: !!draft || paused });
  const acceptDay = useCallback((saved: LotteryDay) => {
    setDay(previous => !previous || !previous.id || saved.version >= previous.version ? saved : previous);
    const current = draftRef.current;
    if (current && saved.id) {
      const next = reconcileLotteryDraft(current, saved);
      if (next !== current && (next?.version !== current.version || !current.base)) writeDraft(next);
    }
  }, [writeDraft]);
  useEffect(() => { if (query.data) acceptDay(query.data); }, [query.data, acceptDay]);
  const operation = useSavedOperation('lottery-day-' + date, '/lottery/v2/days/' + date + '/', (result, request) => {
    const saved = result.data as LotteryDay, current = draftRef.current;
    if (saved.id) {
      if (current) writeDraft(reconcileLotteryDraft(current, saved, request.path.endsWith('/report') ? request.payload.report as LotteryReport : undefined));
      acceptDay(saved);
    }
    onSaved(); void query.refresh();
  });
  useEffect(() => { if (operation.error && !operation.pending) void query.refresh(); }, [operation.error, operation.pending, query.refresh]);
  const closed = day?.status === 'CLOSED', blocked = readOnly || operation.blocked || !!storageError || !initialized || !day?.id || !!closed;
  const persist = (report: LotteryReport) => {
    if (!day || blocked) return;
    writeDraft({ version: draftRef.current?.version ?? day.version, base: draftRef.current?.base ?? day.report, report });
  };
  const mutate = (action: string, payload: Record<string, unknown> = {}) => {
    if (!day || readOnly || operation.blocked || storageError) return Promise.resolve(undefined);
    return operation.submit({ label: `Lottery ${date}: ${action}`, path: `/lottery/v2/days/${date}/${action}`, payload: { expectedVersion: day.version, ...payload } });
  };
  return { day, draft, report: draft?.report || day?.report, closed, blocked, storageError, operation, query, persist, mutate,
    saveReport: () => draftRef.current ? mutate('report', { expectedVersion: draftRef.current.version, report: draftRef.current.report }) : Promise.resolve(day ? { data: day } : undefined),
    discard: () => { writeDraft(null); void query.refresh(); },
    rebase: () => {
      if (!draftRef.current || !day) return;
      const report = { ...draftRef.current.report };
      if (day.report.rackCounts) report.rackCounts = day.report.rackCounts.map(saved => {
        const edited = draftRef.current!.report.rackCounts?.find(row => row.id === saved.id);
        return edited ? { ...saved, closingNumber: edited.closingNumber, finishedRolls: edited.finishedRolls } : saved;
      });
      writeDraft({ ...draftRef.current, report, version: day.version, base: day.report });
    },
  };
}
