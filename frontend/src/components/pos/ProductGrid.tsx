import React from 'react';
import { Product } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { Input } from '@/components/ui/Input';
import { CategoryTabs } from '@/components/pos/CategoryTabs';
import { Search, Scan, Star, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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

const StockBadge = ({ product }: { product: Product }) => {
  if (!product.trackInventory) return null;
  const qty = product.stockQuantity;
  if (qty <= 0) {
    return (
      <span className="absolute bottom-1 right-1 text-xs px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium border border-destructive/20">
        Out
      </span>
    );
  }
  if (qty <= product.lowStockAlert) {
    return (
      <span className="absolute bottom-1 right-1 text-xs px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500 font-medium border border-amber-500/20">
        {qty}
      </span>
    );
  }
  return (
    <span className="absolute bottom-1 right-1 text-xs px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-500 font-medium border border-green-500/20">
      {qty}
    </span>
  );
};

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
  const navigate = useNavigate();
  const isOutOfStock = (product: Product) => product.trackInventory && product.stockQuantity <= 0;

  return (
    <div className="flex-1 flex flex-col bg-background min-h-0">
      {/* Search bar */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/dashboard')}
            className="shrink-0 p-2 rounded-md hover:bg-accent transition-colors text-muted-foreground"
            title="Back to Dashboard"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            type="text"
            placeholder="Search products... (/ or F3)"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10 pr-10"
          />
          {hardware.scanner.isEnabled() && (
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
              <Scan className="h-4 w-4 text-green-500" />
              <span className="text-xs text-green-500">Scanner</span>
            </div>
          )}
          </div>
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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-40 bg-muted rounded animate-pulse"></div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {products.map((product) => {
              const outOfStock = isOutOfStock(product);
              return (
                <button
                  key={product.id}
                  onClick={() => onProductClick(product)}
                  disabled={outOfStock}
                  className={`relative p-4 border border-border rounded-lg transition-all text-left bg-card ${
                    outOfStock
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:border-primary hover:shadow-md'
                  }`}
                >
                  <div className="aspect-square bg-muted rounded mb-3 flex items-center justify-center overflow-hidden">
                    {product.image ? (
                      <img
                        src={product.image}
                        alt={product.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="text-4xl text-muted-foreground">
                        {product.name.charAt(0)}
                      </div>
                    )}
                  </div>
                  <h3 className="font-medium text-sm mb-1 truncate">{product.name}</h3>
                  <p className="text-lg font-bold text-primary">
                    {formatCurrency(product.price)}
                  </p>
                  {getCartQty(product.id) > 0 && (
                    <div className="absolute top-2 left-2 bg-primary text-primary-foreground text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                      {getCartQty(product.id)}
                    </div>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleFavorite(product.id); }}
                    className="absolute top-2 right-2 p-1 rounded-full hover:bg-accent/80 transition-colors"
                    title={isFavorite(product.id) ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <Star className={`h-3.5 w-3.5 ${isFavorite(product.id) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/40'}`} />
                  </button>
                  <StockBadge product={product} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
