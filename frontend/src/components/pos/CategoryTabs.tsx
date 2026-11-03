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
    <div className="pos-category-bar">
      <div className="relative">
        <div className="flex gap-2 overflow-x-auto no-scrollbar pr-6">
          <button
            type="button"
            aria-pressed={selectedId === null}
            onClick={() => onSelect(null)}
            className={`pos-category ${
              selectedId === null
                ? 'is-selected'
                : ''
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              type="button"
              aria-pressed={selectedId === cat.id}
              key={cat.id}
              onClick={() => onSelect(cat.id)}
              className={`pos-category ${
                selectedId === cat.id
                  ? 'is-selected'
                  : ''
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
