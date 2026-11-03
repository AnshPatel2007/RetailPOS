import React, { useLayoutEffect, useRef, useState } from 'react';
import { Dialog } from 'react-aria-components';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ControlPopover, useSmallScreen } from '@/components/ui/Overlay';

type FilterValues = Record<string, string | string[] | boolean | null>;
interface FilterContent { filters: FilterValues; onFilterChange: (value: FilterValues) => void; onClear: () => void }
interface FilterDropdownProps { isOpen: boolean; onClose: () => void; children: React.ReactNode; title?: string }

export function FilterDropdown({ isOpen, onClose, children, title = 'Filters' }: FilterDropdownProps) {
  const marker = useRef<HTMLSpanElement>(null);
  const anchor = useRef<HTMLElement>(null);
  const small = useSmallScreen();
  const child = React.isValidElement<FilterContent>(children) ? children : null;
  const [draft, setDraft] = useState<FilterValues>({});
  useLayoutEffect(() => {
    (anchor as React.MutableRefObject<HTMLElement | null>).current = marker.current?.parentElement?.querySelector('button') || null;
    if (isOpen && child) setDraft(child.props.filters);
  }, [isOpen]);
  const clear = () => setDraft(previous => Object.fromEntries(Object.entries(previous).map(([key, value]) => [key,
    ['startDate', 'endDate', 'showCharts'].includes(key) ? value : Array.isArray(value) ? [] : typeof value === 'boolean' || value === null ? null : '',
  ])));
  const body = child ? React.cloneElement(child, { filters: { ...child.props.filters, ...draft }, onFilterChange: setDraft, onClear: clear }) : children;
  const apply = () => { child?.props.onFilterChange(draft); onClose(); };
  const footer = <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="button" onClick={apply}>Apply filters</Button></div>;
  return <><span ref={marker} hidden />{small ? <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm" footer={footer}>{body}</Modal> :
    <ControlPopover triggerRef={anchor} isOpen={isOpen} onOpenChange={open => { if (!open) onClose(); }} placement="bottom end" className="filter-popover">
      <Dialog aria-label={title} className="filter-dialog outline-none"><div className="filter-body p-4">{body}</div><div className="border-t p-3">{footer}</div></Dialog>
    </ControlPopover>}</>;
}
