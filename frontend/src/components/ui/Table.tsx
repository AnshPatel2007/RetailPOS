import React, { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  children: React.ReactNode;
  scrollLabel?: string;
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

export const Table: React.FC<TableProps> = ({ children, className, scrollLabel, ...props }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const hintId = useId();
  const [overflows, setOverflows] = useState(false);

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

  return (
    <div className="min-w-0">
      {overflows && <p id={hintId} className="px-3 py-2 text-xs text-muted-foreground">Scroll horizontally to see more columns.</p>}
      <div ref={scrollRef} className="table-scroll w-full overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        tabIndex={overflows ? 0 : undefined} role={overflows ? 'region' : undefined}
        aria-label={overflows ? scrollLabel || props['aria-label'] || 'Scrollable table' : undefined} aria-describedby={overflows ? hintId : undefined}>
        <table ref={tableRef} className={cn('w-full caption-bottom text-sm', className)} {...props}>
          {children}
        </table>
      </div>
    </div>
  );
};

export const TableHeader: React.FC<TableSectionProps> = ({ children, className, ...props }) => {
  return <thead className={cn('[&_tr]:border-b', className)} {...props}>{children}</thead>;
};

export const TableBody: React.FC<TableSectionProps> = ({ children, className, ...props }) => {
  return (
    <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props}>
      {children}
    </tbody>
  );
};

export const TableRow: React.FC<TableRowProps> = ({ children, className, ...props }) => {
  return (
    <tr
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
  const isNumeric = numeric ?? (typeof children === 'string' && /^(amount|price|cost|unit cost|total|subtotal|tax|discount|revenue|net sales|gross sales|budgeted|spent|remaining|balance|quantity|stock|on hand)$/i.test(children));
  return (
    <th
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
  const numeric = numericProp ?? (typeof children === 'number' || (typeof children === 'string' && /^\(?-?\$[\d,.]+\)?$/.test(children)));
  return (
    <td className={cn('px-3 xl:px-4 py-3 align-middle [&:has([role=checkbox])]:pr-0', numeric && 'text-right tabular-nums whitespace-nowrap', align === 'right' && 'text-right', align === 'left' && 'text-left', align === 'center' && 'text-center', className)} {...props}>
      {children}
    </td>
  );
};
