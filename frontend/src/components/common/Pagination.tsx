import React from 'react';
import { Button } from '@/components/ui/Button';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** When provided, shown as "(N items)" after the page indicator */
  totalItems?: number;
  /** Plural noun for totalItems, e.g. "customers" */
  itemName?: string;
}

/**
 * One pagination style for the whole app: Previous / "Page X of Y (N items)" / Next.
 * Renders nothing when there is a single page.
 */
export const Pagination: React.FC<PaginationProps> = ({
  page,
  totalPages,
  onPageChange,
  totalItems,
  itemName = 'items',
}) => {
  if (totalPages <= 1) return null;

  return (
    <nav aria-label="Pagination" className="flex flex-wrap justify-center items-center gap-2 mt-4">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page === 1}
      >
        Previous
      </Button>
      <span className="px-3 py-1 text-center text-sm tabular-nums text-muted-foreground">
        Page {page} of {totalPages}
        {totalItems !== undefined && ` (${totalItems} ${itemName})`}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
      >
        Next
      </Button>
    </nav>
  );
};
