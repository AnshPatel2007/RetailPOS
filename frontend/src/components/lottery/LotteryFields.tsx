import { ReactNode } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export function LotterySection({ title, children, description, actions }: { title: string; children: ReactNode; description?: string; actions?: ReactNode }) {
  return <section className="rounded-lg border bg-card p-4 space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-lg font-semibold">{title}</h2>{description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}</div>{actions}</div>{children}</section>;
}
export function LotteryMoneyFields({ fields, values, onChange, disabled, idPrefix = 'lottery-' }: { fields: readonly (readonly [string, string])[]; values: object; onChange: (key: string, value: string | null) => void; disabled?: boolean; idPrefix?: string }) {
  const record = values as Record<string, unknown>;
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{fields.map(([key, label]) => <Input key={key} id={idPrefix + key} label={label} inputMode="decimal" disabled={disabled}
    value={record[key] == null ? '' : String(record[key])} placeholder="Not reported" maxLength={14} onChange={e => onChange(key, e.target.value === '' ? null : e.target.value)} />)}</div>;
}
export function LotteryError({ error, retry }: { error: string; retry?: () => void }) {
  return error ? <div role="alert" className="rounded-md border border-destructive/40 p-3 space-y-2 text-sm"><p>{error}</p>{retry && <Button variant="outline" type="button" onClick={retry}>Retry</Button>}</div> : null;
}
export function LotteryRecovery({ operation }: { operation: { error: string; pending: unknown; busy: boolean; retry: () => Promise<unknown> } }) {
  return <>{operation.error && <LotteryError error={operation.error} />}{!!operation.pending && <div className="rounded-md border p-3 flex flex-wrap items-center gap-3 text-sm" role="status">
    <span>Confirm the saved request before making another change.</span><Button variant="outline" type="button" disabled={operation.busy} onClick={() => void operation.retry()}>Retry saved request</Button>
  </div>}</>;
}
