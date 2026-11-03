import { PackagingEditor } from '@/components/inventory/PackagingEditor';
import { ADJUSTMENT_REASONS } from '@/components/inventory/StockAdjustmentModal';
import { Select } from '@/components/ui/Select';
import React, { useState, useEffect, useRef, useCallback, useId } from 'react';
import { api, productService, categoryService } from '@/services/api';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import { useAuthStore } from '@/store/authStore';
import { can } from '@/lib/capabilities';
import { suggestedCatalogCategory } from '@/lib/catalogCategory';
import { Product } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PageHeader } from '@/components/common/PageHeader';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { useProductIdentification } from '@/hooks/useProductIdentification';
import { AutoRefreshStatus } from '@/components/common/AutoRefreshStatus';
import { Pagination } from '@/components/common/Pagination';
import { EmptyState } from '@/components/common/EmptyState';
import { DataPanel, FormSection, ManagementPage, SummaryStrip } from '@/components/common/Workspace';
import { ProductCatalogTable } from '@/components/inventory/ProductCatalogTable';
import { ProductImage } from '@/components/inventory/ProductImage';
import toast from 'react-hot-toast';
import { Plus, Search, AlertTriangle, Package, FolderPlus, Camera, Tag, Upload, X } from 'lucide-react';
import { StockAdjustmentModal } from '@/components/inventory/StockAdjustmentModal';
import { ReceiptScanModal } from '@/components/inventory/ReceiptScanModal';
import { BarcodeLabelPrint } from '@/components/inventory/BarcodeLabelPrint';
import { CSVImportModal } from '@/components/inventory/CSVImportModal';
import '@/styles/products.css';

export const Inventory: React.FC = () => {
  const { locationId, isReadOnly } = useEffectiveLocation();
  const role = useAuthStore(state => state.user?.role);
  const userId = useAuthStore(state => state.user?.id);
  const canManage = !isReadOnly && can(role, 'inventory.manage');
  const productRequest = useRef<AbortController | null>(null);
  const statsRequest = useRef<AbortController | null>(null);
  const categoryRequest = useRef<AbortController | null>(null);
  const productDetailsRequest = useRef<AbortController | null>(null);
  const [loadError, setLoadError] = useState('');
  const [statsError, setStatsError] = useState('');
  const [categoriesError, setCategoriesError] = useState('');
  const [statsLoading, setStatsLoading] = useState(true);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const productFormId = useId();
  const labelPhotoInput = useRef<HTMLInputElement>(null);
  const savingProduct = useRef(false);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [showStockAdjustModal, setShowStockAdjustModal] = useState(false);
  const [adjustingProduct, setAdjustingProduct] = useState<Product | null>(null);
  const [showReceiptScanModal, setShowReceiptScanModal] = useState(false);
  const [showLabelPrintModal, setShowLabelPrintModal] = useState(false);
  const [showCSVImportModal, setShowCSVImportModal] = useState(false);
  const [selectedForLabels, setSelectedForLabels] = useState<Product[]>([]);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState<'' | 'true' | 'false'>('');
  const [lowStockCount, setLowStockCount] = useState<number | null>(null);
  const [outOfStockCount, setOutOfStockCount] = useState<number | null>(null);
  const [inventoryValue, setInventoryValue] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalProducts, setTotalProducts] = useState<number | null>(null);
  const ITEMS_PER_PAGE = 20;
  const [formData, setFormData] = useState({
    sku: '',
    name: '',
    description: '',
    cost: '',
    price: '',
    compareAtPrice: '',
    stockQuantity: '',
    lowStockAlert: '',
    barcode: '',
    image: '',
    isTaxable: true,
    isActive: true,
    trackInventory: true,
    allowBackorder: false,
    saleBlockedReason: '',
    provisionalUnitCost: '',
    stockAdjustmentReason: 'MANUAL_COUNT',
    brand: '',
    productFamily: '',
    variant: '',
    size: '',
    minimumAge: '',
    ebtEligible: false,
    priceEmbedded: false,
    categoryId: '',
  });

  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();

  const lookup = useProductIdentification({
    open: showModal, enabled: canManage, editing: !!editingProduct,
    contextKey: `${userId}:${role}:${locationId}`, draft: formData, setDraft: setFormData, categories,
  });
  const duplicateProductId = !editingProduct ? lookup.state.info?.existingProductId : undefined;
  const suggestedCategory = suggestedCatalogCategory([
    ...(lookup.state.info?.categoryCandidates || []),
    ...(lookup.state.info?.category ? [lookup.state.info.category] : []),
  ]);

  // Debounce search input and reset page
  useEffect(() => {
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(debounceTimer.current);
  }, [search]);

  const loadLowStockCount = useCallback(async (quiet = false, active: () => boolean = () => true) => {
    statsRequest.current?.abort();
    const request = new AbortController(); statsRequest.current = request;
    const current = () => !request.signal.aborted && statsRequest.current === request && active();
    if (!quiet) { setStatsLoading(true); setStatsError(''); setLowStockCount(null); setOutOfStockCount(null); setInventoryValue(null); }
    try {
      const response = await api.get('/products/stats', { params: { locationId: locationId || undefined }, signal: request.signal });
      if (!current()) return;
      const stats = response.data.data;
      setStatsError('');
      setLowStockCount(stats.lowStockCount ?? null);
      setOutOfStockCount(stats.outOfStockCount ?? null);
      setInventoryValue(stats.inventoryValue ?? null);
    } catch (error) {
      if (quiet) throw error;
      if (current()) setStatsError('Inventory summary is unavailable. Try again.');
    } finally { if (current()) setStatsLoading(false); }
  }, [locationId]);

  const loadCategories = useCallback(async (quiet = false, active: () => boolean = () => true) => {
    categoryRequest.current?.abort();
    const request = new AbortController(); categoryRequest.current = request;
    const current = () => !request.signal.aborted && categoryRequest.current === request && active();
    if (!quiet) { setCategoriesLoading(true); setCategoriesError(''); setCategories([]); }
    try {
      const response = await api.get('/categories', { params: { locationId: locationId || undefined }, signal: request.signal });
      if (!current()) return;
      setCategories(response.data.data || []);
      setCategoriesError('');
    } catch (error) {
      if (quiet) throw error;
      if (current()) setCategoriesError('Categories are unavailable. Try again.');
    } finally { if (current()) setCategoriesLoading(false); }
  }, [locationId]);

  const categoryUpdates = useAutoRefresh(ctx => loadCategories(ctx.quiet, ctx.current), { key: ['product-categories', locationId] });
  const summaryUpdates = useAutoRefresh(ctx => loadLowStockCount(ctx.quiet, ctx.current), { key: ['product-summary', locationId] });

  const handleCreateCategory = async () => {
    if (!canManage) return;
    if (!newCategoryName.trim()) return;

    setIsCreatingCategory(true);
    try {
      const response = await categoryService.create({ name: newCategoryName.trim() });
      const newCategory = response.data.data;
      setCategories(previous => [...previous, newCategory]);
      lookup.editIdentity('categoryId', newCategory.id);
      setNewCategoryName('');
      setShowNewCategoryInput(false);
      toast.success('Category created');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to create category');
    } finally {
      setIsCreatingCategory(false);
    }
  };

  const loadProducts = useCallback(async (quiet = false, active: () => boolean = () => true) => {
    productRequest.current?.abort();
    const request = new AbortController(); productRequest.current = request;
    const current = () => !request.signal.aborted && productRequest.current === request && active();
    if (!quiet) { setIsLoading(true); setLoadError(''); setProducts([]); setTotalProducts(null); setTotalPages(1); }
    try {
      const params: any = {
        locationId: locationId || undefined,
        search: debouncedSearch,
        page: currentPage,
        limit: ITEMS_PER_PAGE,
      };
      if (filterCategory) params.categoryId = filterCategory;
      if (filterStatus) params.isActive = filterStatus;
      const response = await productService.getAll(params, request.signal);
      if (!current()) return;
      setProducts(response.data.data);
      setLoadError('');
      setTotalPages(response.data.pagination?.totalPages || 1);
      setTotalProducts(response.data.pagination?.total ?? response.data.data.length);
    } catch (error) {
      if (quiet) throw error;
      if (current()) setLoadError('Unable to load products. Try again.');
    } finally {
      if (current()) setIsLoading(false);
    }
  }, [locationId, debouncedSearch, currentPage, filterCategory, filterStatus]);

  const productUpdates = useAutoRefresh(ctx => loadProducts(ctx.quiet, ctx.current), { key: ['products', locationId, debouncedSearch, currentPage, filterCategory, filterStatus] });
  useEffect(() => () => { productRequest.current?.abort(); statsRequest.current?.abort(); categoryRequest.current?.abort(); productDetailsRequest.current?.abort(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || savingProduct.current || duplicateProductId) return;
    lookup.reset();
    savingProduct.current = true;
    setIsSavingProduct(true);
    setSaveError('');

    try {
      const data: any = {
        sku: formData.sku,
        name: formData.name,
        description: formData.description || undefined,
        categoryId: formData.categoryId || undefined,
        cost: parseFloat(formData.cost),
        price: parseFloat(formData.price),
        compareAtPrice: formData.compareAtPrice ? parseFloat(formData.compareAtPrice) : undefined,
        stockQuantity: parseInt(formData.stockQuantity) || 0,
        lowStockAlert: parseInt(formData.lowStockAlert) || 0,
        barcode: formData.barcode || undefined,
        image: formData.image || undefined,
        isTaxable: formData.isTaxable,
        isActive: formData.isActive,
        trackInventory: formData.trackInventory,
        allowBackorder: formData.allowBackorder,
        saleBlockedReason: formData.saleBlockedReason.trim() || null,
        provisionalUnitCost: formData.provisionalUnitCost ? parseFloat(formData.provisionalUnitCost) : null,
        brand: formData.brand.trim() || null,
        productFamily: formData.productFamily.trim() || null,
        variant: formData.variant.trim() || null,
        size: formData.size.trim() || null,
        minimumAge: formData.minimumAge ? parseInt(formData.minimumAge) : null,
        ebtEligible: formData.ebtEligible,
        priceEmbedded: formData.priceEmbedded,
      };

      if (editingProduct) {
        if (!data.trackInventory || data.stockQuantity === editingProduct.stockQuantity) delete data.stockQuantity;
        else { data.expectedStockVersion = editingProduct.stockVersion; data.stockAdjustmentReason = formData.stockAdjustmentReason; }
        await productService.update(editingProduct.id, data);
      } else {
        await productService.create(data);
      }

      setShowModal(false);
      resetForm();
      productUpdates.refresh();
      summaryUpdates.refresh();
      toast.success(editingProduct ? 'Product updated' : 'Product created');
    } catch (error: any) {
      setSaveError(error.response?.data?.error || 'Unable to save the product. Your changes are still here. Try again.');
    } finally {
      savingProduct.current = false;
      setIsSavingProduct(false);
    }
  };

  const handleEdit = (product: Product) => {
    if (!canManage) return;
    productDetailsRequest.current?.abort();
    lookup.reset();
    setSaveError('');
    setEditingProduct(product);
    setFormData({
      sku: product.sku,
      name: product.name,
      description: product.description || '',
      cost: product.cost.toString(),
      price: product.price.toString(),
      compareAtPrice: product.compareAtPrice?.toString() || '',
      stockQuantity: product.stockQuantity.toString(),
      lowStockAlert: product.lowStockAlert.toString(),
      barcode: product.barcode || '',
      image: product.image || '',
      isTaxable: product.isTaxable,
      isActive: product.isActive,
      trackInventory: product.trackInventory,
      allowBackorder: product.allowBackorder,
      saleBlockedReason: product.saleBlockedReason || '',
      stockAdjustmentReason: 'MANUAL_COUNT',
      provisionalUnitCost: product.provisionalUnitCost?.toString() || '',
      brand: product.brand || '',
      productFamily: product.productFamily || '',
      variant: product.variant || '',
      size: product.size || '',
      minimumAge: product.minimumAge?.toString() || '',
      ebtEligible: product.ebtEligible ?? false,
      priceEmbedded: product.priceEmbedded ?? false,
      categoryId: product.categoryId || '',
    });
    setShowNewCategoryInput(false);
    setNewCategoryName('');
    setShowModal(true);
  };

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (!canManage) return;
    try {
      await productService.delete(id);
      productUpdates.refresh();
      summaryUpdates.refresh();
      toast.success('Product deleted');
    } catch (error) {
      toast.error('Failed to delete product');
    }
  };

  const resetForm = () => {
    productDetailsRequest.current?.abort();
    lookup.reset();
    setSaveError('');
    setEditingProduct(null);
    setFormData({
      sku: '',
      name: '',
      description: '',
      cost: '',
      price: '',
      compareAtPrice: '',
      stockQuantity: '',
      lowStockAlert: '',
      barcode: '',
      image: '',
      isTaxable: true,
      isActive: true,
      trackInventory: true,
      allowBackorder: false,
      saleBlockedReason: '',
      provisionalUnitCost: '',
      stockAdjustmentReason: 'MANUAL_COUNT',
      brand: '',
      productFamily: '',
      variant: '',
      size: '',
      minimumAge: '',
      ebtEligible: false,
      priceEmbedded: false,
      categoryId: '',
    });
    setShowNewCategoryInput(false);
    setNewCategoryName('');
  };

  const openCreateModal = () => {
    if (!canManage) return;
    resetForm();
    setShowModal(true);
  };

  const hasFilters = !!(search || filterCategory || filterStatus);
  const clearFilters = () => { setSearch(''); setFilterCategory(''); setFilterStatus(''); setCurrentPage(1); };

  return (
    <ManagementPage className="products-workspace">
      <PageHeader title="Products" actions={<>
        {canManage && <Button variant="outline" onClick={() => setShowCSVImportModal(true)}><Upload size={16} />Import CSV</Button>}
        <Button variant="outline" disabled={isLoading || !!loadError || !products.length} onClick={() => { setSelectedForLabels(products); setShowLabelPrintModal(true); }}><Tag size={16} />Print Labels</Button>
        {canManage && <Button variant="outline" onClick={() => setShowReceiptScanModal(true)}><Camera size={16} />Scan Receipt</Button>}
        {canManage && <Button variant="primary" onClick={openCreateModal}><Plus size={16} />Add Product</Button>}
      </>} />

      <AutoRefreshStatus state={productUpdates} />
      <AutoRefreshStatus state={summaryUpdates} />
      <AutoRefreshStatus state={categoryUpdates} />
      {statsError && <div role="alert" className="mb-4 flex flex-wrap items-center gap-3"><p>{statsError}</p><Button variant="outline" onClick={() => void summaryUpdates.refresh()}>Retry inventory summary</Button></div>}
      {categoriesError && <div role="alert" className="mb-4 flex flex-wrap items-center gap-3"><p>{categoriesError}</p><Button variant="outline" onClick={() => void categoryUpdates.refresh()}>Retry categories</Button></div>}

      <DataPanel
        summary={<SummaryStrip items={[
          { label: hasFilters ? 'Matching Products' : 'Total Products', value: totalProducts ?? (isLoading ? '...' : 'Unavailable') },
          { label: 'Low Stock', value: lowStockCount ?? (statsLoading ? '...' : 'Unavailable'), tone: lowStockCount ? 'warning' : 'default' },
          { label: 'Out of Stock', value: outOfStockCount ?? (statsLoading ? '...' : 'Unavailable'), tone: outOfStockCount ? 'danger' : 'default' },
          { label: 'Inventory Value', value: inventoryValue === null ? statsLoading ? '...' : 'Unavailable' : formatCurrency(inventoryValue) },
        ]} />}
        toolbar={<div>
          <div className="products-toolbar">
            <div className="products-search"><Search aria-hidden="true" /><Input type="search" aria-label="Search products" placeholder="Search by name, SKU, or barcode..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" /></div>
            <Select aria-label="Category filter" disabled={categoriesLoading || !!categoriesError} value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setCurrentPage(1); }}>
              <option value="">All Categories</option>{categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
            </Select>
            <Select aria-label="Product status filter" value={filterStatus} onChange={e => { setFilterStatus(e.target.value as '' | 'true' | 'false'); setCurrentPage(1); }}>
              <option value="">All statuses</option><option value="true">Active</option><option value="false">Inactive</option>
            </Select>
          </div>
          {hasFilters && <div className="products-filter-summary" aria-label="Active product filters">
            {search && <button type="button" className="products-filter-chip" onClick={() => setSearch('')} aria-label="Remove product search">Search: {search}<X aria-hidden="true" size={12} /></button>}
            {filterCategory && <button type="button" className="products-filter-chip" onClick={() => { setFilterCategory(''); setCurrentPage(1); }} aria-label="Remove category filter">{categories.find(category => category.id === filterCategory)?.name || 'Category'}<X aria-hidden="true" size={12} /></button>}
            {filterStatus && <button type="button" className="products-filter-chip" onClick={() => { setFilterStatus(''); setCurrentPage(1); }} aria-label="Remove status filter">{filterStatus === 'true' ? 'Active' : 'Inactive'}<X aria-hidden="true" size={12} /></button>}
            <Button type="button" variant="ghost" onClick={clearFilters}>Clear filters</Button>
          </div>}
        </div>}
        footer={!isLoading && !loadError && <div className="products-results-footer">
          <span role="status">{totalProducts === 0 ? '0 products' : `Showing ${(currentPage - 1) * ITEMS_PER_PAGE + 1} to ${(currentPage - 1) * ITEMS_PER_PAGE + products.length} of ${totalProducts ?? products.length} products`}</span>
          <Pagination page={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} itemName="products" />
        </div>}
      >
        {isLoading ? <div className="p-8 text-center" role="status"><div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mx-auto" /><p className="mt-3 text-muted-foreground">Loading products...</p></div>
          : loadError ? <div role="alert" className="p-6 space-y-3"><p>{loadError}</p><Button variant="outline" onClick={() => void productUpdates.refresh()}>Retry products</Button></div>
            : products.length === 0 ? <EmptyState icon={Package} title="No products found" hint={hasFilters ? 'Try another search or clear your filters.' : 'Add a product to start building your catalog.'} />
              : <ProductCatalogTable products={products} canManage={canManage} onEdit={handleEdit} onAdjustStock={product => { setAdjustingProduct(product); setShowStockAdjustModal(true); }} onDelete={product => setDeleteTargetId(product.id)} />}
      </DataPanel>

      {/* Product Modal */}
      <Modal
        isOpen={canManage && showModal}
        onClose={() => {
          if (savingProduct.current) return;
          setShowModal(false);
          resetForm();
        }}
        title={editingProduct ? 'Edit Product' : 'Add New Product'}
        size="lg"
        footer={<div className="space-y-3">
          {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={isSavingProduct} onClick={() => { setShowModal(false); resetForm(); }}>Cancel</Button>
            <Button type="submit" form={productFormId} disabled={isSavingProduct || !!duplicateProductId}>
              {isSavingProduct ? 'Saving...' : editingProduct ? 'Update Product' : 'Create Product'}
            </Button>
          </div>
        </div>}
      >
        <form id={productFormId} onSubmit={handleSubmit} aria-busy={isSavingProduct}>
          <fieldset disabled={isSavingProduct} className="min-w-0 product-form">
            <FormSection title="Product identity" description="Product name and SKU are required. Barcode and category are optional.">
              <div className="space-y-4">
                <Input label="Barcode" value={formData.barcode} onChange={e => lookup.changeBarcode(e.target.value)} placeholder="Scan or enter a barcode" autoFocus={!editingProduct} autoComplete="off" maxLength={100}
                  description={editingProduct ? 'Use Auto-fill to look up missing details.' : 'Scan to fill available product details automatically.'}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void lookup.identify(); } }} />
                <div className="product-lookup">
                  <p id={`${productFormId}-identify-hint`} className="product-lookup-hint">Review catalog details and age requirements, then enter your prices and stock.</p>
                  <Button type="button" variant="outline" onClick={() => { void lookup.identify(undefined, true); }} disabled={lookup.identifying || !formData.barcode.trim()} aria-describedby={`${productFormId}-identify-hint`} title="Look the barcode up in the product database">{lookup.identifying ? 'Looking up...' : lookup.state.kind === 'unavailable' ? 'Retry lookup' : 'Auto-fill'}</Button>
                  <Button type="button" variant="outline" disabled={lookup.identifying} onClick={() => labelPhotoInput.current?.click()}><Camera size={16} />Photo</Button>
                  <input ref={labelPhotoInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) void lookup.identify(file); e.target.value = ''; }} />
                  {lookup.state.kind !== 'idle' && <div className="product-lookup-result" role={lookup.state.kind === 'unavailable' ? 'alert' : 'status'}>
                    {lookup.state.info?.image && <ProductImage src={lookup.state.info.image} name="Catalog match" preview />}
                    <div className="min-w-0 flex-1">
                      <p>{lookup.state.message}</p>
                      {!!lookup.state.info?.missingFields?.length && <p className="text-xs text-muted-foreground mt-1">Not supplied by the catalog: {lookup.state.info.missingFields.map(field => field === 'image' ? 'photo' : field).join(', ')}.</p>}
                      {lookup.state.info?.imageStatus === 'community_only' && <p className="text-xs text-muted-foreground mt-1">Only community snapshots are available. Add a product photo below.</p>}
                      {lookup.state.info?.ageRestriction?.status === 'restricted' && <p className="text-xs mt-1">{formData.minimumAge === '21' ? '21+ age check selected' : '21+ age check recommended'}: {lookup.state.info.ageRestriction.reason}</p>}
                      {lookup.state.info?.ageRestriction?.status === 'review' && <p className="text-xs text-warning mt-1">Check age restriction: {lookup.state.info.ageRestriction.reason}</p>}
                      {suggestedCategory && !formData.categoryId && <p className="text-xs text-muted-foreground mt-1">Suggested category: {suggestedCategory}. Choose or add it below.</p>}
                      {!!lookup.state.info?.attributions?.length && <p className="text-xs text-muted-foreground mt-1">Source: {lookup.state.info.attributions.map((source, index) => <React.Fragment key={source.url}>{index > 0 && ', '}<a className="underline" href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a></React.Fragment>)}</p>}
                      {duplicateProductId && <Button type="button" variant="outline" className="mt-2" onClick={async () => {
                        productDetailsRequest.current?.abort();
                        const request = new AbortController(); productDetailsRequest.current = request;
                        try { const response = await productService.getById(duplicateProductId, request.signal); if (!request.signal.aborted) handleEdit(response.data.data); }
                        catch { if (!request.signal.aborted) toast.error('Could not open this product. Try again.'); }
                      }}>Open existing product</Button>}
                    </div>
                  </div>}
                </div>
                <div className="product-field-grid">
                  <Input label="Product Name" value={formData.name} onChange={e => lookup.editIdentity('name', e.target.value)} required />
                  <Input label="SKU" value={formData.sku} onChange={e => lookup.editIdentity('sku', e.target.value)} description="Editable store code; defaults to the barcode." required />
                </div>
                <div className="product-field-grid">
                  <Input label="Brand" description="Optional" value={formData.brand} onChange={e => setFormData({ ...formData, brand: e.target.value })} maxLength={80} placeholder="e.g. Gatorade" />
                  <Input label="Product family" description="Optional. Groups flavors/variants to check together." value={formData.productFamily} onChange={e => setFormData({ ...formData, productFamily: e.target.value })} maxLength={80} placeholder="e.g. Gatorade Thirst Quencher" />
                  <Input label="Flavor / variant" description="Optional" value={formData.variant} onChange={e => setFormData({ ...formData, variant: e.target.value })} maxLength={80} placeholder="e.g. Lemon-Lime" />
                  <Input label="Size" description="Optional" value={formData.size} onChange={e => setFormData({ ...formData, size: e.target.value })} maxLength={40} placeholder="e.g. 20 oz" />
                </div>
                {!showNewCategoryInput ? <div className="space-y-2"><div className="product-category-control">
                  <Select label="Category" value={formData.categoryId} disabled={categoriesLoading || !!categoriesError} onChange={e => lookup.editIdentity('categoryId', e.target.value)}>
                    <option value="">Select a category</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </Select>
                  <Button type="button" variant="outline" onClick={() => { setNewCategoryName(suggestedCategory || ''); setShowNewCategoryInput(true); }} title="Create new category" aria-label="Create new category"><FolderPlus size={16} /></Button>
                </div>
                  {suggestedCategory && !formData.categoryId && !categoriesLoading && !categoriesError && <Button type="button" variant="outline" className="max-w-full whitespace-normal text-left" onClick={() => { setNewCategoryName(suggestedCategory); setShowNewCategoryInput(true); }}>Add suggested category: {suggestedCategory}</Button>}
                </div> : <div className="space-y-2">
                  <Input label="New category name" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} autoFocus />
                  <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => { setShowNewCategoryInput(false); setNewCategoryName(''); }}>Cancel</Button><Button type="button" onClick={handleCreateCategory} disabled={isCreatingCategory || !newCategoryName.trim()}>{isCreatingCategory ? 'Creating...' : 'Add category'}</Button></div>
                </div>}
              </div>
            </FormSection>

            <FormSection title="Pricing & stock" description="Cost is the latest purchase price. Changing it does not revalue existing inventory or previous sales.">
              <div className="space-y-4">
                <div className="product-field-grid product-price-grid">
                  <Input type="number" label="Cost Price" value={formData.cost} onChange={e => setFormData({ ...formData, cost: e.target.value })} step="0.01" min="0" required />
                  <Input type="number" label="Retail Price" value={formData.price} onChange={e => setFormData({ ...formData, price: e.target.value })} step="0.01" min="0.01" required />
                  <Input type="number" label="Compare-at Price" description="Optional" value={formData.compareAtPrice} onChange={e => setFormData({ ...formData, compareAtPrice: e.target.value })} step="0.01" min="0" />
                </div>
                {formData.cost && formData.price && parseFloat(formData.price) < parseFloat(formData.cost) && <p className="text-xs text-warning flex items-center gap-1"><AlertTriangle size={14} />Retail price is below cost</p>}
                <div className="product-field-grid">
                  <Input type="number" label="Stock Quantity" value={formData.stockQuantity} onChange={e => setFormData({ ...formData, stockQuantity: e.target.value })} required />
                  <Input type="number" label="Low Stock Alert" value={formData.lowStockAlert} onChange={e => setFormData({ ...formData, lowStockAlert: e.target.value })} required />
                </div>
                {editingProduct && formData.trackInventory && formData.stockQuantity !== '' && parseInt(formData.stockQuantity) !== editingProduct.stockQuantity && (
                  <Select label="Reason for stock change" value={formData.stockAdjustmentReason} onChange={e => setFormData({ ...formData, stockAdjustmentReason: e.target.value })}>
                    {ADJUSTMENT_REASONS.filter(r => r.value !== 'OTHER').map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </Select>
                )}
                <div className="product-choice-grid">
                  <label><input type="checkbox" checked={formData.trackInventory} onChange={e => setFormData({ ...formData, trackInventory: e.target.checked })} className="rounded border-input" /><span>Track inventory</span></label>
                </div>
                <p className="text-xs text-muted-foreground">The register never blocks a sale because recorded stock is zero or negative. A negative balance opens an inventory exception for review.</p>
                <div className="product-field-grid">
                  <Input type="number" label="Provisional unit cost" description="Optional. Used for cost of goods only when stock runs out before any receipt or average cost exists." value={formData.provisionalUnitCost} onChange={e => setFormData({ ...formData, provisionalUnitCost: e.target.value })} step="0.01" min="0" />
                  <Input label="Sale hold" description="Optional. Recall or prohibited-sale reason; the register refuses this item while set." value={formData.saleBlockedReason} onChange={e => setFormData({ ...formData, saleBlockedReason: e.target.value })} maxLength={200} />
                </div>
              </div>
            </FormSection>

            <FormSection title="Packaging" description="Sell this item as single units and packs (e.g. a 12-pack), and buy it in supplier cases. Everything shares one stock of single units.">
              {editingProduct && formData.trackInventory ? <PackagingEditor product={editingProduct} onChanged={() => productUpdates.refresh()} />
                : <p className="text-sm text-muted-foreground">{formData.trackInventory ? 'Save the product first, then add packs and supplier cases here.' : 'Packs need stock tracking turned on.'}</p>}
            </FormSection>
            <FormSection title="Sale settings">
              <div className="space-y-4">
                <div className="product-choice-grid">
                  <label><input type="checkbox" checked={formData.isTaxable} onChange={e => setFormData({ ...formData, isTaxable: e.target.checked })} className="rounded border-input" /><span>Taxable item</span></label>
                  <label><input type="checkbox" checked={formData.isActive} onChange={e => setFormData({ ...formData, isActive: e.target.checked })} className="rounded border-input" /><span>Active</span></label>
                  <label title="SNAP/EBT can pay for this item"><input type="checkbox" checked={formData.ebtEligible} onChange={e => setFormData({ ...formData, ebtEligible: e.target.checked })} className="rounded border-input" /><span>EBT / SNAP eligible</span></label>
                  <label title="The scanned scale or deli barcode contains the price"><input type="checkbox" checked={formData.priceEmbedded} onChange={e => setFormData({ ...formData, priceEmbedded: e.target.checked })} className="rounded border-input" /><span>Price-embedded barcode</span></label>
                </div>
                <Select label="Age restriction" value={formData.minimumAge} onChange={e => lookup.editIdentity('minimumAge', e.target.value)}>
                  <option value="">None</option><option value="18">18+ (lottery)</option><option value="21">21+ (alcohol, tobacco, vape)</option>
                </Select>
                {lookup.state.info?.ageRestriction?.status === 'unknown' && <p className="text-xs text-muted-foreground">The catalog did not establish an age requirement. Check the product before saving.</p>}
                {formData.minimumAge && <p className="text-xs text-warning">Checkout will require a logged ID check whenever this item is in the cart.</p>}
              </div>
            </FormSection>

            <FormSection title="Additional details" description="Optional information and the image shown in the product grid.">
              <div className="space-y-4">
                <Input label="Description" value={formData.description} onChange={e => lookup.editIdentity('description', e.target.value)} />
                <div className="product-image-field">
                  <ProductImage src={formData.image} name={formData.name} preview />
                  <Input label="Image URL" value={formData.image} onChange={e => lookup.editIdentity('image', e.target.value)} placeholder="https://example.com/image.jpg" />
                </div>
                {!!lookup.state.info?.imageCandidates?.some(photo => photo.kind === 'catalog') && <details className="product-photo-choices">
                  <summary>Catalog photos ({lookup.state.info.imageCandidates.filter(photo => photo.kind === 'catalog').length})</summary>
                  <p className="text-xs text-muted-foreground mt-2">Check the size and pack count before choosing a photo.</p>
                  <div className="product-photo-grid" role="group" aria-label="Catalog product photos">
                    {lookup.state.info.imageCandidates.filter(photo => photo.kind === 'catalog').map((photo, index) => <button key={photo.url} type="button" className="product-photo-option" aria-label={`Use product photo ${index + 1} from ${photo.source}`} aria-pressed={formData.image === photo.url} onClick={() => lookup.editIdentity('image', photo.url)}>
                      <ProductImage src={photo.url} name={`Catalog photo ${index + 1}`} preview />
                      <span>{photo.source}</span>
                    </button>)}
                  </div>
                </details>}
              </div>
            </FormSection>
          </fieldset>
        </form>
      </Modal>

      {/* Stock Adjustment Modal */}
      <StockAdjustmentModal
        isOpen={canManage && showStockAdjustModal}
        onClose={() => {
          setShowStockAdjustModal(false);
          setAdjustingProduct(null);
        }}
        onSuccess={() => { productUpdates.refresh(); summaryUpdates.refresh(); }}
        product={adjustingProduct}
      />

      {/* Receipt Scan Modal */}
      <ReceiptScanModal
        isOpen={canManage && showReceiptScanModal}
        onClose={() => setShowReceiptScanModal(false)}
        onSuccess={() => { productUpdates.refresh(); summaryUpdates.refresh(); }}
      />

      <BarcodeLabelPrint
        isOpen={showLabelPrintModal}
        onClose={() => setShowLabelPrintModal(false)}
        products={selectedForLabels}
      />

      <CSVImportModal
        isOpen={canManage && showCSVImportModal}
        onClose={() => setShowCSVImportModal(false)}
        onImportComplete={() => { productUpdates.refresh(); summaryUpdates.refresh(); }}
      />

      <ConfirmDialog
        isOpen={canManage && deleteTargetId !== null}
        onClose={() => setDeleteTargetId(null)}
        onConfirm={() => deleteTargetId && handleDelete(deleteTargetId)}
        title="Delete product?"
        message="This will remove the product from your catalog. This action cannot be undone."
        destructive
        confirmLabel="Delete"
      />
    </ManagementPage>
  );
};
