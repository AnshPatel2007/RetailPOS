import { ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LotteryDay, LotteryReport, lotteryMoney } from '@/services/lotteryWorkbench';
import { LotteryMoneyFields, LotterySection } from './LotteryFields';

export const onlineFields = [['onlineGross', 'Gross online sales'], ['onlineCancels', 'Cancellations']] as const;
export const payoutFields = [['drawPayouts', 'Draw-game payouts'], ['fastPlayPayouts', 'FastPlay payouts'], ['scratchPayouts', 'Scratch-ticket payouts']] as const;
export const supportFields = [['onlinePromotions', 'Online promotions'], ['scratchPromotions', 'Scratch promotions'], ['onlineNoncash', 'Online noncash sales'], ['scratchNoncash', 'Scratch noncash sales'], ['collectionAdjustment', 'Cash adjustment (+ / −)']] as const;
export const earningsFields = [['onlineCommission', 'Online sales commission'], ['scratchCommission', 'Scratch sales commission'], ['cashingBonus', 'Cashing bonus'], ['sellingBonus', 'Selling bonus'], ['fees', 'Lottery fees'], ['earningsAdjustment', 'Earnings adjustment (+ / −)']] as const;
const movementFields = [['cashAdded', 'Cash added'], ['cashRemoved', 'Cash removed / deposited']] as const;
export const lotteryFieldLabel = (key: string) => [...onlineFields, ...payoutFields, ...supportFields, ...earningsFields, ...movementFields].find(([field]) => field === key)?.[1] || key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
type Fields = readonly (readonly [string, string])[];
type EditorProps = { report: LotteryReport; disabled: boolean; persist: (report: LotteryReport) => void };
function MoneySummary({ values }: { values: (readonly [string, string | null | undefined])[] }) {
  return <dl className="grid grid-cols-2 gap-4 lg:grid-cols-3 text-sm">{values.map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums mt-1">{lotteryMoney(value)}</dd></div>)}</dl>;
}

export function ZeroRemaining({ fields, report, persist }: { fields: Fields; report: LotteryReport; persist: EditorProps['persist'] }) {
  const blank = fields.map(([key]) => key as keyof LotteryReport).filter(key => report[key] === null || report[key] === '');
  return blank.length ? <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
    <span>{blank.length} {blank.length === 1 ? 'amount' : 'amounts'} to confirm</span>
    <Button variant="outline" onClick={() => persist({ ...report, ...Object.fromEntries(blank.map(key => [key, '0'])) })}>Confirm remaining amounts are zero</Button>
  </div> : null;
}

export function LotteryDisclosure({ title, detail, children, initiallyOpen = false }: { title: string; detail?: string; children: ReactNode; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return <details open={open} onToggle={e => setOpen(e.currentTarget.open)} className="rounded-lg border bg-card p-4">
    <summary className="cursor-pointer text-sm font-medium"><span>{title}</span>{detail && <span className="ml-2 text-xs font-normal text-muted-foreground">{detail}</span>}</summary>
    <div className="space-y-4 pt-4">{children}</div>
  </details>;
}

export function LotteryTerminalStage({ report, disabled, persist }: EditorProps) {
  const field = (key: string, value: string | null) => persist({ ...report, [key]: value });
  const otherRemaining = supportFields.filter(([key]) => report[key] === null).length;
  return <fieldset disabled={disabled} className="min-w-0 space-y-4">
    <LotterySection title="Lottery terminal report" description="Use the report for this business date. Record prizes paid here once, including scratch-ticket payouts.">
      <div className="max-w-md"><Input id="lottery-reference" label="Terminal report reference" value={report.reference} maxLength={150} onChange={e => field('reference', e.target.value)} /></div>
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="space-y-4"><h3 className="text-sm font-semibold">Online sales</h3><LotteryMoneyFields fields={onlineFields} values={report} onChange={field} /><ZeroRemaining fields={onlineFields} report={report} persist={persist} /></section>
        <section className="space-y-4"><h3 className="text-sm font-semibold">Prizes paid</h3><LotteryMoneyFields fields={payoutFields} values={report} onChange={field} /><ZeroRemaining fields={payoutFields} report={report} persist={persist} /></section>
      </div>
    </LotterySection>
    <LotteryDisclosure title="Other report amounts" detail={otherRemaining ? `${otherRemaining} amounts to review` : 'Amounts confirmed'} initiallyOpen={supportFields.some(([key]) => report[key] !== null && Number(report[key]) !== 0) || report.printedOnlineBalance !== null || report.printedInstantBalance !== null || !!report.adjustmentReason}>
      <LotteryMoneyFields fields={supportFields} values={report} onChange={field} /><ZeroRemaining fields={supportFields} report={report} persist={persist} />
      <Input id="lottery-adjustmentReason" label="Adjustment explanation" value={report.adjustmentReason} maxLength={2000} onChange={e => field('adjustmentReason', e.target.value)} />
      <LotteryMoneyFields fields={[[ 'printedOnlineBalance', 'Printed online balance (optional)' ]]} values={report} onChange={field} />
    </LotteryDisclosure>
    <LotteryDisclosure title="Online per-game sales" detail="Optional" initiallyOpen={report.onlineGames.length > 0}>
      {report.onlineGames.map((game, index) => <div className="grid gap-3 sm:grid-cols-3" key={index}>
        <Input label="Draw / FastPlay game" value={game.name} onChange={e => persist({ ...report, onlineGames: report.onlineGames.map((row, i) => i === index ? { ...row, name: e.target.value } : row) })} />
        <Input label="Gross game sales" inputMode="decimal" value={game.amount} onChange={e => persist({ ...report, onlineGames: report.onlineGames.map((row, i) => i === index ? { ...row, amount: e.target.value } : row) })} />
        <Button variant="outline" className="self-end" onClick={() => persist({ ...report, onlineGames: report.onlineGames.filter((_, i) => i !== index) })}>Remove game</Button>
      </div>)}
      <Button variant="outline" onClick={() => persist({ ...report, onlineGames: [...report.onlineGames, { name: '', amount: '' }] })}>Add online game</Button>
    </LotteryDisclosure>
  </fieldset>;
}

export function LotteryReviewStage({ day, report, disabled, persist, dirty }: EditorProps & { day: LotteryDay; dirty: boolean }) {
  const field = (key: string, value: string | null) => persist({ ...report, [key]: value }), totals = day.totals;
  return <div className="space-y-4">
    <LotterySection title={day.status === 'CLOSED' ? 'Closed day summary' : 'Review the day'}>
      <dl className="grid grid-cols-2 gap-5 lg:grid-cols-4">{[['Scratch sales', totals?.scratchSales], ['Online sales', totals?.onlineSales], ['Prizes paid', totals?.payouts], ['Net collections', totals?.netCollections]].map(([label, amount]) =>
        <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="text-xl sm:text-2xl font-semibold tabular-nums mt-1">{lotteryMoney(amount)}</dd></div>)}</dl>
      <p className="text-xs text-muted-foreground">{dirty ? 'Saved totals shown. Save your draft to update this review.' : 'Net collections are sales less promotions and prizes paid. Lottery earnings are shown separately below.'}</p>
    </LotterySection>
    <LotterySection title="Cash reconciliation" description={day.configuration.cashMode === 'SHARED' ? 'Store-day cash for the shared checkout drawer.' : 'Opening and closing cash in the separate lottery fund.'}>
      {day.status === 'CLOSED' ? <><MoneySummary values={[
        ['Opening cash', report.openingCash], ['Lottery net cash', totals?.netCash], ['Counted closing cash', report.countedCash],
        ...(day.configuration.cashMode === 'SHARED' ? [['Non-lottery net cash', report.nonLotteryNetCash] as const] : []),
        ['Cash added', report.cashAdded], ['Cash removed / deposited', report.cashRemoved], ['Expected closing cash', totals?.expectedCash], ['Cash difference', totals?.cashVariance],
      ]} />{report.exceptionReason && <p className="text-sm text-muted-foreground">{report.exceptionReason}</p>}</> : <fieldset disabled={disabled} className="space-y-4">
        <LotteryMoneyFields fields={[[ 'openingCash', 'Opening cash' ], [ 'countedCash', 'Counted closing cash' ], ...(day.configuration.cashMode === 'SHARED' ? [[ 'nonLotteryNetCash', 'Non-lottery net cash (+ / −)' ] as const] : [])]} values={report} onChange={field} />
        <LotteryDisclosure title="Cash added or removed" detail={movementFields.some(([key]) => report[key] === null) ? 'Review amounts' : 'Amounts confirmed'} initiallyOpen={movementFields.some(([key]) => report[key] !== null && Number(report[key]) !== 0)}>
          <LotteryMoneyFields fields={movementFields} values={report} onChange={field} /><ZeroRemaining fields={movementFields} report={report} persist={persist} />
        </LotteryDisclosure>
        <dl className="grid gap-4 sm:grid-cols-3 rounded-md bg-muted/40 p-3 text-sm">{[['Lottery net cash', totals?.netCash], ['Expected closing cash', totals?.expectedCash], ['Cash difference', totals?.cashVariance]].map(([label, amount]) =>
          <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums mt-1">{lotteryMoney(amount)}</dd></div>)}</dl>
        <Input id="lottery-exceptionReason" label="Cash difference explanation" description="Required for a difference or missing cash figures." value={report.exceptionReason} maxLength={2000} onChange={e => field('exceptionReason', e.target.value)} />
      </fieldset>}
    </LotterySection>
    <LotterySection title="Lottery earnings" description="Commissions and bonuses less fees. Missing information stays pending until confirmed by a daily report or settlement.">
      {!totals?.earningsComplete && day.earningsSettlement ? <div className="space-y-1 text-sm"><p className="font-medium">Earnings resolved by settlement</p><Link className="text-primary underline underline-offset-4" to={'/lottery?tab=reports&lotteryReport=settlements&lotteryFrom=' + day.earningsSettlement.periodStart + '&lotteryTo=' + day.earningsSettlement.periodEnd}>View statement {day.earningsSettlement.reference}</Link><p className="text-xs text-muted-foreground">Earnings are confirmed for the statement period; no daily amount is inferred.</p></div>
        : <div className="flex justify-between gap-3 text-sm"><span className="text-muted-foreground">{totals?.earningsComplete ? 'Reported earnings' : 'Earnings pending'}</span><strong className="tabular-nums">{lotteryMoney(totals?.earnings)}</strong></div>}
      {day.status === 'CLOSED' ? <><MoneySummary values={earningsFields.map(([key, label]) => [label, report[key]])} />
        {report.adjustmentReason && <p className="text-sm text-muted-foreground">{report.adjustmentReason}</p>}{report.notes && <p className="text-sm">{report.notes}</p>}
      </> : <fieldset disabled={disabled} className="space-y-4"><LotteryMoneyFields fields={earningsFields} values={report} onChange={field} /><ZeroRemaining fields={earningsFields} report={report} persist={persist} />
        {report.earningsAdjustment !== null && Number(report.earningsAdjustment) !== 0 && <Input id="lottery-adjustmentReason" label="Adjustment explanation" value={report.adjustmentReason} onChange={e => field('adjustmentReason', e.target.value)} />}
        <Input id="lottery-notes" label="Daily notes (optional)" value={report.notes} maxLength={2000} onChange={e => field('notes', e.target.value)} />
      </fieldset>}
    </LotterySection>
  </div>;
}
