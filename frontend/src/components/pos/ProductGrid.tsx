import React, { useState } from 'react';
import { Product } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { CategoryTabs } from '@/components/pos/CategoryTabs';
import { Search, Scan, Star, PackageSearch, Package, CheckCircle2, AlertTriangle, Loader2, X } from 'lucide-react';
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
  error?: string;
  onRetry?: () => void;
  onProductClick: (product: Product) => void;
  getCartQty: (productId: string) => number;
  isFavorite: (productId: string) => boolean;
  toggleFavorite: (productId: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement>;
  /** Enter in the search box. Return true when it was handled as a scan. */
  onSearchEnter?: (value: string, typedFast: boolean) => boolean;
  /** What the last scan did, shown in and under the search box. */
  scanStatus?: ScanStatus | null;
  onDismissScanStatus?: () => void;
  /** Shown above the search (the phone layout's "Sale complete" strip). */
  topSlot?: React.ReactNode;
  /** More products match than are shown; the button loads the next set. */
  hasMore?: boolean;
  onLoadMore?: () => void;
  /** Shown when the favorites tab is empty because nothing has been starred yet. */
  emptyHint?: string;
}

export interface ScanStatus {
  kind: 'busy' | 'added' | 'info' | 'error';
  message: string;
  /** Follow-up buttons for a scan that found nothing. */
  actions?: { label: string; onClick: () => void }[];
}

/** Scanners type a whole code in well under 50 ms a key; people don't. */
const SCAN_MS_PER_KEY = 35;

// Stock counts are deliberately not shown at the register: recorded stock never
// blocks a sale. Only a recall/prohibited-sale hold is surfaced.
const SaleHoldLine = ({ product, reserve }: { product: Product; reserve: boolean }) => product.saleBlockedReason
  ? <p className="pos-product-hold h-4 text-xs font-medium text-destructive truncate">Not for sale</p>
  : reserve ? <div className="h-4" /> : null;

/** A category color only when it is a plain hex value (it becomes a CSS variable). */
const accentColor = (product: Product) => {
  const color = product.category?.color;
  return color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : undefined;
};

interface ProductCardProps {
  product: Product;
  /** Photo tiles when most items in view have photos; otherwise compact text tiles. */
  layout: 'photo' | 'text';
  qty: number;
  favorite: boolean;
  saleBlocked: boolean;
  onClick: () => void;
  onToggleFavorite: () => void;
}

const ProductCard: React.FC<ProductCardProps> = ({
  product,
  layout,
  qty,
  favorite,
  saleBlocked,
  onClick,
  onToggleFavorite,
}) => {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const showImage = product.image && product.image !== failedImage;
  const image = showImage ? (
    <img
      src={product.image!}
      alt=""
      loading="lazy"
      onError={() => setFailedImage(product.image || null)}
      className="w-full h-full object-contain"
    />
  ) : null;
  const accent = accentColor(product);

  return (
    <div className={`pos-product-tile relative group${layout === 'text' ? ' is-text' : ''}`}>
      <button
        onClick={onClick}
        disabled={saleBlocked}
        type="button"
        title={product.name}
        style={accent ? { '--tile-accent': accent } as React.CSSProperties : undefined}
        className={`pos-product-button w-full text-left border border-border rounded-lg bg-card transition-colors ${
          saleBlocked
            ? 'opacity-50 cursor-not-allowed'
            : 'hover:border-primary/50 hover:bg-accent/30'
        }${layout === 'text' && image ? ' has-thumb' : ''}`}
      >
        {layout === 'photo' ? (
          <div className="pos-product-image">
            {image || <div className="pos-product-placeholder" aria-hidden="true"><Package size={28} strokeWidth={1.3} /></div>}
          </div>
        ) : image ? <div className="pos-product-thumb">{image}</div> : null}
        <h3 className="pos-product-name">{product.name}</h3>
        <p className="pos-product-price tabular-nums">
          {formatCurrency(product.price)}
        </p>
        <SaleHoldLine product={product} reserve={layout === 'photo'} />
      </button>

      {/* In-cart quantity badge (non-interactive, sibling of the card button) */}
      {qty > 0 && (
        <span className="pos-product-qty absolute top-2 left-2 min-w-[1.5rem] h-6 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center ring-2 ring-card pointer-events-none">
          {qty}
        </span>
      )}

      {/* Favorite toggle — sibling button, comfortable touch target */}
      <button
        type="button"
        onClick={onToggleFavorite}
        className="pos-product-favorite"
        aria-label={`${favorite ? 'Remove from' : 'Add to'} favorites: ${product.name}`}
        aria-pressed={favorite}
        title={favorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Star className={`h-4 w-4 ${favorite ? 'fill-warning text-warning' : 'text-muted-foreground/50'}`} />
      </button>
    </div>
  );
};

const GRID_CLASSES = 'pos-product-grid';

export const ProductGrid: React.FC<ProductGridProps> = ({
  products,
  categories,
  selectedCategoryId,
  onSelectCategory,
  search,
  onSearchChange,
  isLoading,
  error,
  onRetry,
  onProductClick,
  getCartQty,
  isFavorite,
  toggleFavorite,
  searchInputRef,
  onSearchEnter,
  hasMore,
  onLoadMore,
  emptyHint,
  scanStatus,
  onDismissScanStatus,
  topSlot,
}) => {
  const typing = React.useRef<{ start: number; keys: number }>({ start: 0, keys: 0 });
  // A mostly-photographed catalog keeps photo tiles; otherwise empty image boxes
  // would take most of the screen, so items show as compact text tiles.
  const layout: 'photo' | 'text' = products.length > 0 && products.filter(product => product.image).length * 2 >= products.length ? 'photo' : 'text';
  const chip = !search && scanStatus && (scanStatus.kind === 'added' || scanStatus.kind === 'busy') ? scanStatus : null;
  const problem = scanStatus && (scanStatus.kind === 'error' || scanStatus.kind === 'info') ? scanStatus : null;

  return (
    <div className="pos-catalog">
      {topSlot}
      {/* Search bar */}
      <div className="pos-product-search">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            type="text"
            placeholder="Search products... (/ or F3)"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const { start, keys } = typing.current;
                const fast = keys > 3 && (performance.now() - start) / keys < SCAN_MS_PER_KEY;
                typing.current = { start: 0, keys: 0 };
                if (onSearchEnter?.(e.currentTarget.value, fast)) e.preventDefault();
                return;
              }
              if (e.key.length === 1) {
                if (!e.currentTarget.value || !typing.current.keys) typing.current = { start: performance.now(), keys: 0 };
                typing.current.keys++;
              }
            }}
            className={`pl-10 h-11 ${chip ? 'pos-search-with-chip' : 'pr-24'}`}
          />
          {/* Announces scan results; shows the last item added until the next scan. */}
          <p role="status" aria-live="polite" className={chip ? `pos-scan-chip is-${chip.kind}` : 'sr-only'}>
            {chip && (chip.kind === 'busy'
              ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
              : <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />)}
            {chip && <span className="truncate">{chip.message}</span>}
          </p>
          {!chip && hardware.scanner.isEnabled() && (
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
              <Scan className="h-4 w-4 text-success" />
              <span className="text-xs text-success">Scanner</span>
            </div>
          )}
        </div>
        {problem && (
          <div role={problem.kind === 'error' ? 'alert' : undefined} className={`pos-scan-problem is-${problem.kind}`}>
            {problem.kind === 'error' && <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />}
            <p className="min-w-0 flex-1 text-sm">{problem.message}</p>
            {problem.actions?.map(action => (
              <Button key={action.label} variant="outline" size="sm" onClick={action.onClick}>{action.label}</Button>
            ))}
            {onDismissScanStatus && (
              <button type="button" onClick={onDismissScanStatus} aria-label="Dismiss scan message" className="pos-cart-tool"><X className="h-4 w-4" /></button>
            )}
          </div>
        )}
      </div>

      {/* Category filter tabs */}
      <CategoryTabs
        categories={categories}
        selectedId={selectedCategoryId}
        onSelect={onSelectCategory}
      />

      {/* Products grid */}
      <div className="pos-catalog-scroll">
        {isLoading ? (
          <div className={GRID_CLASSES}>
            {[...Array(10)].map((_, i) => (
              <div key={i} className="rounded-lg border border-border p-3 animate-pulse">
                <div className="pos-product-image rounded bg-muted" />
                <div className="h-4 w-3/4 bg-muted rounded mb-2" />
                <div className="h-5 w-1/2 bg-muted rounded" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div role="alert" className="space-y-3 p-4 text-center">
            <p className="text-destructive">{error}</p>
            <Button variant="outline" onClick={onRetry}>Retry products</Button>
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <PackageSearch className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <p className="font-medium">No products found</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              {emptyHint || 'Try a different search or category'}
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
          <div className={`${GRID_CLASSES}${layout === 'text' ? ' is-text' : ''}`}>
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                layout={layout}
                qty={getCartQty(product.id)}
                favorite={isFavorite(product.id)}
                saleBlocked={!!product.saleBlockedReason}
                onClick={() => onProductClick(product)}
                onToggleFavorite={() => toggleFavorite(product.id)}
              />
            ))}
            {hasMore && onLoadMore && (
              <div className="col-span-full flex justify-center py-3">
                <Button variant="outline" onClick={onLoadMore}>Show more products</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
