import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface FilterSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  summary?: string; // Shows when collapsed
  className?: string;
}

export const FilterSection: React.FC<FilterSectionProps> = ({
  title,
  children,
  defaultOpen = true,
  summary,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`border-b border-border pb-2 ${className}`}>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        className="filter-section-toggle w-full flex items-center justify-between min-h-9 py-1 text-sm font-medium hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
      >
        <div className="flex flex-col items-start gap-1">
          <span>{title}</span>
          {!isOpen && summary && (
            <span className="text-xs text-muted-foreground font-normal">{summary}</span>
          )}
        </div>
        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {isOpen && <div className="mt-1 space-y-1.5">{children}</div>}
    </div>
  );
};
