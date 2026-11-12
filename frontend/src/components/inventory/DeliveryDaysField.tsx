import { Button } from '@/components/ui/Button';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { supplierService } from '@/services/api';
import { cn } from '@/lib/utils';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const list = (days: number[]) => days.map(day => DAYS[day]).join(', ');

/**
 * The weekdays a supplier delivers. Reorder suggestions then cover until the
 * delivery after next. For a saved supplier, the weekdays its deliveries
 * usually arrived are offered, never applied without a tap.
 */
export function DeliveryDaysField({ value, onChange, supplierId, className }: { value: number[]; onChange: (days: number[]) => void; supplierId?: string; className?: string }) {
  const suggestion = useScopedQuery(['delivery-days-suggestion', supplierId], async signal => (await supplierService.deliveryDaysSuggestion(supplierId!, signal)).data.data,
    !!supplierId, 0, { autoRefresh: false });
  const suggested = suggestion.data?.weekdays || [];
  const differs = suggested.length > 0 && suggested.join() !== [...value].sort((a, b) => a - b).join();
  const toggle = (day: number) => onChange(value.includes(day) ? value.filter(chosen => chosen !== day) : [...value, day].sort((a, b) => a - b));
  return <fieldset className={cn('space-y-2', className)}>
    <legend className="mb-1 block text-sm font-medium">Delivery days</legend>
    <div className="flex flex-wrap gap-2">
      {DAYS.map((label, day) => <button key={label} type="button" aria-pressed={value.includes(day)} aria-label={FULL[day]} onClick={() => toggle(day)}
        className="min-h-9 min-w-12 rounded-md border px-3 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground">
        {label}
      </button>)}
    </div>
    <p className="field-description">Reorder suggestions then cover until the delivery after next. Leave all off to plan two weeks ahead.</p>
    {differs && <div role="status" className="flex flex-wrap items-center gap-2 text-sm">
      <span>Deliveries usually arrived on {list(suggested)} over the last {suggestion.data!.weeks} weeks.</span>
      <Button type="button" size="sm" variant="outline" onClick={() => onChange(suggested)}>Use these days</Button>
    </div>}
  </fieldset>;
}
