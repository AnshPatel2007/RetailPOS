import React, { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useSmallScreen } from './Overlay';

interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  children: React.ReactNode;
  scrollLabel?: string;
  /**
   * On a phone each row becomes a card: the first column is its title and every
   * other cell is labelled with its column heading, so nothing scrolls sideways.
   */
  stackOnPhone?: boolean;
}

interface TableSectionProps extends React.HTMLAttributes<HTMLTableSectionElement> {
  children: React.ReactNode;
}

interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  children: React.ReactNode;
}

interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  children?: React.ReactNode;
  numeric?: boolean;
}

interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  children?: React.ReactNode;
  numeric?: boolean;
}

/** A stacking table is no longer laid out as a table, so its parts name their roles for screen readers. */
const StackContext = createContext(false);

const setAttribute = (element: Element, name: string, value: string | null) => {
  if (value === null) { if (element.hasAttribute(name)) element.removeAttribute(name); }
  else if (element.getAttribute(name) !== value) element.setAttribute(name, value);
};

/** Give every body cell its column heading (`data-label`) and its part in the card (`data-stack`). */
function labelCells(table: HTMLTableElement) {
  const labels: string[] = [];
  const headingRow = table.tHead?.rows[table.tHead.rows.length - 1];
  for (const heading of Array.from(headingRow?.cells ?? [])) {
    for (let span = 0; span < heading.colSpan; span++) labels.push((heading.textContent ?? '').trim());
  }
  for (const body of Array.from(table.tBodies)) for (const row of Array.from(body.rows)) {
    const cells = Array.from(row.cells);
    let column = 0, titled = false;
    for (const cell of cells) {
      const label = labels[column] ?? '';
      column += cell.colSpan;
      let part: string;
      if (cells.length === 1 && cell.colSpan > 1) part = 'full';
      else if (!label && cell.querySelector('input[type="checkbox"], [role="checkbox"]')) part = 'select';
      else if (!label || /^actions?$/i.test(label)) part = 'actions';
      else if (!titled) { part = 'title'; titled = true; }
      else part = 'field';
      setAttribute(cell, 'data-stack', part);
      setAttribute(cell, 'data-label', part === 'field' ? label : null);
    }
  }
}

export const Table: React.FC<TableProps> = ({ children, className, scrollLabel, stackOnPhone = true, ...props }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const hintId = useId();
  const [overflows, setOverflows] = useState(false);
  const stacked = useSmallScreen() && stackOnPhone;

  useEffect(() => {
    const region = scrollRef.current;
    const table = tableRef.current;
    if (!region || !table) return;
    const measure = () => setOverflows(region.scrollWidth > region.clientWidth + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(region);
    observer.observe(table);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const table = tableRef.current;
    if (!stacked || !table) return;
    labelCells(table);
    // Labels are attributes, so writing them never re-triggers this observer.
    const observer = new MutationObserver(() => labelCells(table));
    observer.observe(table, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [stacked]);

  return (
    <div className="min-w-0">
      {overflows && <p id={hintId} className="px-3 py-2 text-xs text-muted-foreground">Scroll horizontally to see more columns.</p>}
      <div ref={scrollRef} className="table-scroll w-full overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        tabIndex={overflows ? 0 : undefined} role={overflows ? 'region' : undefined}
        aria-label={overflows ? scrollLabel || props['aria-label'] || 'Scrollable table' : undefined} aria-describedby={overflows ? hintId : undefined}>
        <StackContext.Provider value={stackOnPhone}>
          <table ref={tableRef} role={stackOnPhone ? 'table' : undefined} className={cn('w-full caption-bottom text-sm', stackOnPhone && 'table-stack', className)} {...props}>
            {children}
          </table>
        </StackContext.Provider>
      </div>
    </div>
  );
};

export const TableHeader: React.FC<TableSectionProps> = ({ children, className, ...props }) => {
  const stack = useContext(StackContext);
  return <thead role={stack ? 'rowgroup' : undefined} className={cn('[&_tr]:border-b', className)} {...props}>{children}</thead>;
};

export const TableBody: React.FC<TableSectionProps> = ({ children, className, ...props }) => {
  const stack = useContext(StackContext);
  return (
    <tbody role={stack ? 'rowgroup' : undefined} className={cn('[&_tr:last-child]:border-0', className)} {...props}>
      {children}
    </tbody>
  );
};

export const TableRow: React.FC<TableRowProps> = ({ children, className, ...props }) => {
  const stack = useContext(StackContext);
  return (
    <tr
      role={stack ? 'row' : undefined}
      className={cn(
        'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
        className
      )}
      {...props}
    >
      {children}
    </tr>
  );
};

export const TableHead: React.FC<TableHeadProps> = ({ children, className, numeric, align, ...props }) => {
  const stack = useContext(StackContext);
  const isNumeric = numeric ?? (typeof children === 'string' && /^(amount|price|cost|unit cost|total|subtotal|tax|discount|revenue|net sales|gross sales|budgeted|spent|remaining|balance|quantity|stock|on hand)$/i.test(children));
  return (
    <th
      role={stack ? 'columnheader' : undefined}
      className={cn(
        'h-10 px-3 xl:px-4 text-left align-middle text-xs font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0',
        (isNumeric || align === 'right') && 'text-right tabular-nums',
        align === 'left' && 'text-left',
        align === 'center' && 'text-center',
        className
      )}
      {...props}
    >
      {children}
    </th>
  );
};

export const TableCell: React.FC<TableCellProps> = ({ children, className, numeric: numericProp, align, ...props }) => {
  const stack = useContext(StackContext);
  const numeric = numericProp ?? (typeof children === 'number' || (typeof children === 'string' && /^\(?-?\$[\d,.]+\)?$/.test(children)));
  return (
    <td role={stack ? 'cell' : undefined} className={cn('px-3 xl:px-4 py-3 align-middle [&:has([role=checkbox])]:pr-0', numeric && 'text-right tabular-nums whitespace-nowrap', align === 'right' && 'text-right', align === 'left' && 'text-left', align === 'center' && 'text-center', className)} {...props}>
      {children}
    </td>
  );
};
