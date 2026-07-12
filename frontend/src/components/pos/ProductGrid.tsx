import React, { useState } from 'react';
import { Product } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { CategoryTabs } from '@/components/pos/CategoryTabs';
import { Search, Scan, Star, PackageSearch } from 'lucide-react';
import { hardware } from '@/services/hardware';

interface Category {
  id: string;
  name: string;
  color?: string | null;
}

interface ProductGridProps {
  products: Product[];
  categories: Category[];
  selectedCategoryId: string | null;
  onSelectCategory: (id: string | null) => void;
  search: string;
  onSearchChange: (value: string) => void;
  isLoading: boolean;
  onProductClick: (product: Product) => void;
  getCartQty: (productId: string) => number;
  isFavorite: (productId: string) => boolean;
  toggleFavorite: (productId: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement>;
}

/** Deterministic hue per product so no-image tiles are distinguishable but stable */
const nameHue = (name: string): number =>
  name.split('').reduce((acc, c) => acc + c.charCodeAt(0) * 31, 7) % 360;

const StockLine = ({ product }: { product: Product }) => {
  if (!product.trackInventory) return <div className="h-4" />;
  const qty = product.stockQuantity;
  if (qty <= 0) {
    return <p className="h-4 text-xs font-medium text-destructive">Out of stock</p>;
  }
  if (qty <= product.lowStockAlert) {
    return <p className="h-4 text-xs font-medium text-warning">{qty} left</p>;
  }
  return <p className="h-4 text-xs text-muted-foreground">{qty} in stock</p>;
};

interface ProductCardProps {
  product: Product;
  qty: number;
  favorite: boolean;
  outOfStock: boolean;
  onClick: () => void;
  onToggleFavorite: () => void;
}

const ProductCard: React.FC<ProductCardProps> = ({
  product,
  qty,
  favorite,
  outOfStock,
  onClick,
  onToggleFavorite,
}) => {
  const [imgError, setImgError] = useState(false);
  const hue = nameHue(product.name);
  const showImage = product.image && !imgError;

  return (
    <div className="relative group">
      <button
        onClick={onClick}
        disabled={outOfStock}
        className={`w-full text-left p-3 border border-border rounded-lg bg-card transition-all ${
          outOfStock
            ? 'opacity-50 cursor-not-allowed'
            : 'hover:border-primary hover:shadow-md active:scale-[0.98]'
        }`}
      >
        <div className="aspect-square rounded mb-3 overflow-hidden">
          {showImage ? (
            <img
              src={product.image!}
              alt={product.name}
              loading="lazy"
              onError={() => setImgError(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center text-3xl font-semibold"
              style={{
                backgroundColor: `hsl(${hue} 70% 45% / 0.15)`,
                color: `hsl(${hue} 70% 45%)`,
              }}
            >
              {product.name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <h3 className="font-medium text-sm truncate">{product.name}</h3>
        <p className="text-lg font-bold text-primary tabular-nums">
          {formatCurrency(product.price)}
        </p>
        <StockLine product={product} />
      </button>

      {/* In-cart quantity badge (non-interactive, sibling of the card button) */}
      {qty > 0 && (
        <span className="absolute top-2 left-2 min-w-[1.5rem] h-6 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center ring-2 ring-card pointer-events-none">
          {qty}
        </span>
      )}

      {/* Favorite toggle — sibling button, comfortable touch target */}
      <button
        onClick={onToggleFavorite}
        className="absolute top-1 right-1 h-9 w-9 flex items-center justify-center rounded-full bg-card/70 backdrop-blur-sm hover:bg-accent transition-colors"
        title={favorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Star className={`h-4 w-4 ${favorite ? 'fill-warning text-warning' : 'text-muted-foreground/50'}`} />
      </button>
    </div>
  );
};

const GRID_CLASSES = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3';

export const ProductGrid: React.FC<ProductGridProps> = ({
  products,
  categories,
  selectedCategoryId,
  onSelectCategory,
  search,
  onSearchChange,
  isLoading,
  onProductClick,
  getCartQty,
  isFavorite,
  toggleFavorite,
  searchInputRef,
}) => {
  const isOutOfStock = (product: Product) => product.trackInventory && product.stockQuantity <= 0;

  return (
    <div className="flex-1 flex flex-col bg-background min-h-0">
      {/* Search bar */}
      <div className="p-4 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            type="text"
            placeholder="Search products... (/ or F3)"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10 pr-24 h-11"
          />
          {hardware.scanner.isEnabled() && (
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
              <Scan className="h-4 w-4 text-success" />
              <span className="text-xs text-success">Scanner</span>
            </div>
          )}
        </div>
      </div>

      {/* Category filter tabs */}
      <CategoryTabs
        categories={categories}
        selectedId={selectedCategoryId}
        onSelect={onSelectCategory}
      />

      {/* Products grid */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className={GRID_CLASSES}>
            {[...Array(10)].map((_, i) => (
              <div key={i} className="rounded-lg border border-border p-3 animate-pulse">
                <div className="aspect-square rounded bg-muted mb-3" />
                <div className="h-4 w-3/4 bg-muted rounded mb-2" />
                <div className="h-5 w-1/2 bg-muted rounded" />
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <PackageSearch className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <p className="font-medium">No products found</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              Try a different search or category
            </p>
            {search ? (
              <Button variant="outline" size="sm" onClick={() => onSearchChange('')}>
                Clear search
              </Button>
            ) : selectedCategoryId ? (
              <Button variant="outline" size="sm" onClick={() => onSelectCategory(null)}>
                Show all products
              </Button>
            ) : null}
          </div>
        ) : (
          <div className={GRID_CLASSES}>
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                qty={getCartQty(product.id)}
                favorite={isFavorite(product.id)}
                outOfStock={isOutOfStock(product)}
                onClick={() => onProductClick(product)}
                onToggleFavorite={() => toggleFavorite(product.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
