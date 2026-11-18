import { X } from 'lucide-react';
import { formatEnumLabel } from '@/lib/utils';

type FilterValue = string | string[] | boolean | null;
export function FilterChips<T extends Record<string, FilterValue>>({ filters, onChange, labels = {}, lookup = {}, count, itemName = 'results' }: {
  filters: T; onChange: (value: T) => void; labels?: Record<string, string>; lookup?: Record<string, string>; count?: number; itemName?: string;
}) {
  const excluded = new Set(['startDate', 'endDate', 'showCharts']);
  const chips = Object.entries(filters).flatMap(([key, value]) => excluded.has(key) || value === null || value === '' ? [] :
    (Array.isArray(value) ? value : [value]).map(item => ({ key, value: item, label: `${labels[key] || formatEnumLabel(key.replace(/([a-z])([A-Z])/g, '$1 $2'))}: ${typeof item === 'boolean' ? item ? 'Yes' : 'No' : lookup[item] || formatEnumLabel(item)}` })));
  return <div className="filter-chips flex flex-wrap items-center gap-2 mb-4" aria-label="Active filters">
    {count !== undefined && <span className="text-xs text-muted-foreground mr-1" role="status" aria-label="Result count">{count.toLocaleString()} {count === 1 ? itemName.endsWith('ies') ? itemName.slice(0, -3) + 'y' : itemName.replace(/s$/, '') : itemName}</span>}
    {chips.map(chip => <button key={chip.key + String(chip.value)} type="button" className="filter-chip" aria-label={'Remove ' + chip.label} onClick={() => onChange({ ...filters, [chip.key]: Array.isArray(filters[chip.key]) ? (filters[chip.key] as string[]).filter(value => value !== chip.value) : typeof filters[chip.key] === 'boolean' ? null : '' })}>
      {chip.label}<X size={12} aria-hidden="true" />
    </button>)}
  </div>;
}
