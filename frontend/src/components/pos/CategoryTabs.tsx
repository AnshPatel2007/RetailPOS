import React from 'react';

interface Category {
  id: string;
  name: string;
  color?: string | null;
}

interface CategoryTabsProps {
  categories: Category[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export const CategoryTabs: React.FC<CategoryTabsProps> = ({ categories, selectedId, onSelect }) => {
  if (categories.length === 0) return null;

  return (
    <div className="px-4 py-3 border-b border-border">
      <div className="relative">
        <div className="flex gap-2 overflow-x-auto no-scrollbar pr-6">
          <button
            onClick={() => onSelect(null)}
            className={`shrink-0 px-4 py-2.5 rounded-full text-sm font-medium transition-colors ${
              selectedId === null
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => onSelect(cat.id)}
              className={`shrink-0 px-4 py-2.5 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5 ${
                selectedId === cat.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              {cat.color && (
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: cat.color }}
                />
              )}
              {cat.name}
            </button>
          ))}
        </div>
        {/* Right-edge fade hints that more categories are scrollable */}
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent" />
      </div>
    </div>
  );
};
