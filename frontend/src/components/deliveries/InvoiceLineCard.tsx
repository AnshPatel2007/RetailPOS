import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, PenLine } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn, formatCurrency } from '@/lib/utils';
import type { InvoiceLine, InvoiceLinePatch } from '@/types/deliveryInvoices';
import { costChangeText, costLine, lineProblem, tierLabel, unitsLine } from './invoiceText';

const number = (text: string) => { const value = Number(text.trim()); return text.trim() && Number.isFinite(value) && value >= 0 ? value : null; };

/**
 * One line of a delivery invoice under review: the text as printed, the item
 * it goes to, and how many arrived at what cost. A line the app is sure of
 * needs nothing; a suggestion asks "Is this …?"; a line with no item offers to
 * add it as new. Every change is saved as it is made.
 */
export function InvoiceLineCard({ line, alertPercent, disabled, onSave, onPick, onAddNew, onShowPhoto, photoCount }: {
  line: InvoiceLine;
  alertPercent: number;
  disabled: boolean;
  onSave: (patch: Omit<InvoiceLinePatch, 'index'>) => Promise<boolean>;
  onPick: () => void;
  onAddNew: () => void;
  onShowPhoto: (page: number) => void;
  photoCount: number;
}) {
  const [editing, setEditing] = useState(false);
  const [quantity, setQuantity] = useState(''), [perCase, setPerCase] = useState(''), [caseCost, setCaseCost] = useState('');
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) first.current?.focus(); }, [editing]);
  const startEditing = () => {
    setQuantity(String(line.receivedQuantity)); setPerCase(String(line.unitsPerCase)); setCaseCost(line.caseCost === null ? '' : String(line.caseCost));
    setEditing(true);
  };
  const pack = !!line.product?.sellingUnitId;
  const values = { quantity: number(quantity), perCase: number(perCase), caseCost: caseCost.trim() ? number(caseCost) : null };
  const valid = values.quantity !== null && values.perCase !== null && values.perCase >= 1 && Number.isInteger(values.perCase) && (!caseCost.trim() || values.caseCost !== null);
  const saveAmounts = async () => {
    if (!valid) return;
    const saved = await onSave({ receivedQuantity: values.quantity!, ...(pack ? {} : { unitsPerCase: values.perCase! }), caseCost: values.caseCost });
    if (saved) setEditing(false);
  };

  const credit = line.tier === 'CREDIT';
  const deciding = !line.skip && !line.confirmed;
  const change = costChangeText(line.costChange, alertPercent);
  const problem = lineProblem(line);
  const title = line.newItem ? line.newItem.name : line.product ? line.product.name : credit ? 'A return or credit' : 'Not in your items yet';
  const tier = line.skip && !credit ? 'Skipped' : tierLabel[line.tier];
  const tone = line.skip ? 'secondary' : line.tier === 'SURE' || line.confirmed ? 'success' : line.tier === 'CHECK' ? 'warning' : 'default';

  return <li className={cn('invoice-line space-y-3 rounded-lg border bg-card p-3 sm:p-4', deciding && 'invoice-line-open', line.skip && 'opacity-70')}
    data-tier={line.tier} aria-label={`Line ${line.index + 1}: ${title}`}>
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={tone}>{line.confirmed && !line.skip && line.tier !== 'SURE' ? <><Check className="mr-1 h-3 w-3" aria-hidden="true" />Checked</> : tier}</Badge>
          <span className="text-xs text-muted-foreground">Line {line.index + 1}</span>
          {photoCount > 1 && <button type="button" className="text-xs text-primary underline-offset-2 hover:underline" onClick={() => onShowPhoto(line.page)}>Photo {line.page}</button>}
        </div>
        <p className="break-words font-mono text-xs text-muted-foreground" title="As printed on the invoice">{line.description}
          {line.itemCode && <span> · item {line.itemCode}</span>}{line.upc && <span> · UPC {line.upc}</span>}</p>
        {deciding && line.product && !line.newItem
          ? <p className="text-sm">Is this <strong className="font-semibold">{line.product.name}</strong>?</p>
          : <p className="font-medium leading-5">{title}</p>}
        <p className="text-xs text-muted-foreground">
          {line.newItem ? `New item · sells for ${line.newItem.price === null ? 'no price yet' : formatCurrency(line.newItem.price)}`
            : line.product ? `${line.product.sku} · ${line.reason}${line.current ? ` · ${line.current.stockQuantity} in stock` : ''}`
            : credit ? 'Nothing to receive.' : line.reason}
        </p>
      </div>
      {!credit && <div className="shrink-0 text-right">
        <p className="font-semibold tabular-nums">{line.units}</p>
        <p className="text-xs text-muted-foreground">{line.units === 1 ? 'unit' : 'units'}</p>
      </div>}
    </div>

    {!credit && !line.skip && !editing && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span>{unitsLine(line)}</span>
      <span className="text-muted-foreground">{costLine(line)}</span>
      {change && <span className={cn('text-xs', change.flagged ? 'font-medium text-warning' : 'text-muted-foreground')}>{change.text}</span>}
      <Button type="button" variant="ghost" disabled={disabled} onClick={startEditing} aria-label={`Change the amounts on line ${line.index + 1}`}>
        <PenLine aria-hidden="true" />Change amounts</Button>
    </div>}

    {editing && <form className="space-y-3 rounded-md border p-3" onSubmit={event => { event.preventDefault(); void saveAmounts(); }}
      aria-label={`Amounts on line ${line.index + 1}`}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input ref={first} label={line.unitsPerCase > 1 || pack ? (pack ? `Received (${line.product!.name})` : 'Cases received') : 'Units received'} inputMode="decimal"
          value={quantity} onChange={event => setQuantity(event.target.value)} error={quantity.trim() && values.quantity === null ? 'Enter a number' : undefined} />
        <Input label="Units in each" inputMode="numeric" value={perCase} disabled={pack} onChange={event => setPerCase(event.target.value)}
          description={pack ? 'Set by the pack.' : 'A single item is 1.'} error={perCase.trim() && (values.perCase === null || values.perCase < 1 || !Number.isInteger(values.perCase)) ? 'Whole number, 1 or more' : undefined} />
        <Input label={values.perCase && values.perCase > 1 ? 'Cost of each case' : 'Cost each'} inputMode="decimal" value={caseCost} onChange={event => setCaseCost(event.target.value)}
          error={caseCost.trim() && values.caseCost === null ? 'Enter an amount' : undefined} />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!valid || disabled}>Save amounts</Button>
      </div>
    </form>}

    {!line.skip && line.checkUnits && <p className="flex items-start gap-1.5 text-sm text-warning"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      Check how many come in a case: the invoice does not say.</p>}
    {!line.skip && line.changedByHand && <p className="flex items-start gap-1.5 text-sm text-warning"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      Changed by hand on the invoice: check the quantity.</p>}
    {line.current && !line.current.available && <p className="text-sm text-destructive">This item no longer keeps stock or was archived. Choose another item.</p>}
    {problem && !deciding && <p className="text-sm text-destructive">{problem}</p>}

    {!editing && <div className="flex flex-wrap gap-2">
      {line.skip
        ? <Button type="button" variant="ghost" disabled={disabled} onClick={() => void onSave({ skip: false, confirmed: line.tier === 'SURE' })}>{credit ? 'Receive it anyway' : 'Undo skip'}</Button>
        : deciding && line.product && !line.newItem ? <>
            <Button type="button" variant="primary" disabled={disabled} onClick={() => void onSave({ confirmed: true })}>Yes, that's it</Button>
            <Button type="button" variant="outline" disabled={disabled} onClick={onPick}>No, pick another</Button>
            <Button type="button" variant="ghost" disabled={disabled} onClick={() => void onSave({ skip: true })}>Skip</Button>
          </>
        : deciding ? <>
            <Button type="button" variant="primary" disabled={disabled} onClick={onAddNew}>{line.newItem ? 'Finish the new item' : 'Add as new item'}</Button>
            <Button type="button" variant="outline" disabled={disabled} onClick={onPick}>It's an item I have</Button>
            <Button type="button" variant="ghost" disabled={disabled} onClick={() => void onSave({ skip: true })}>Skip</Button>
          </>
        : <>
            <Button type="button" variant="ghost" disabled={disabled} onClick={line.newItem ? onAddNew : onPick}>{line.newItem ? 'Edit the new item' : 'Change item'}</Button>
            <Button type="button" variant="ghost" disabled={disabled} onClick={() => void onSave({ skip: true })}>Skip</Button>
          </>}
    </div>}
  </li>;
}
