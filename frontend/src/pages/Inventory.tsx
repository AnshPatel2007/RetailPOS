import React, { useState, useEffect, useRef } from 'react';
import { productService, categoryService } from '@/services/api';
import { Product } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Badge } from '@/components/ui/Badge';
import toast from 'react-hot-toast';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { Plus, Search, Edit, Trash2, AlertTriangle, Package, FolderPlus, RotateCcw, ChevronLeft, ChevronRight, DollarSign, TrendingDown, Camera, Tag, Upload } from 'lucide-react';
import { StockAdjustmentModal } from '@/components/inventory/StockAdjustmentModal';
import { ReceiptScanModal } from '@/components/inventory/ReceiptScanModal';
import { BarcodeLabelPrint } from '@/components/inventory/BarcodeLabelPrint';
import { CSVImportModal } from '@/components/inventory/CSVImportModal';

export const Inventory: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
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
  const [lowStockCount, setLowStockCount] = useState(0);
  const [outOfStockCount, setOutOfStockCount] = useState(0);
  const [inventoryValue, setInventoryValue] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalProducts, setTotalProducts] = useState(0);
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
    categoryId: '',
  });

  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();

  // Debounce search input and reset page
  useEffect(() => {
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(debounceTimer.current);
  }, [search]);

  useEffect(() => {
    loadCategories();
    loadLowStockCount();
  }, []);

  const loadLowStockCount = async () => {
    try {
      const response = await productService.getStats();
      const stats = response.data.data;
      setLowStockCount(stats.lowStockCount || 0);
      setOutOfStockCount(stats.outOfStockCount || 0);
      setInventoryValue(stats.inventoryValue || 0);
    } catch (error) {
      console.error('Failed to load product stats:', error);
    }
  };

  useEffect(() => {
    loadProducts();
  }, [debouncedSearch, currentPage, filterCategory, filterStatus]);

  const loadCategories = async () => {
    try {
      const response = await categoryService.getAll();
      setCategories(response.data.data || []);
    } catch (error) {
      console.error('Failed to load categories:', error);
    }
  };

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return;

    setIsCreatingCategory(true);
    try {
      const response = await categoryService.create({ name: newCategoryName.trim() });
      const newCategory = response.data.data;
      setCategories([...categories, newCategory]);
      setFormData({ ...formData, categoryId: newCategory.id });
      setNewCategoryName('');
      setShowNewCategoryInput(false);
      toast.success('Category created');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to create category');
    } finally {
      setIsCreatingCategory(false);
    }
  };

  const loadProducts = async () => {
    setIsLoading(true);
    try {
      const params: any = {
        search: debouncedSearch,
        page: currentPage,
        limit: ITEMS_PER_PAGE,
      };
      if (filterCategory) params.categoryId = filterCategory;
      if (filterStatus) params.isActive = filterStatus;
      const response = await productService.getAll(params);
      setProducts(response.data.data);
      setTotalPages(response.data.pagination?.totalPages || 1);
      setTotalProducts(response.data.pagination?.total || response.data.data.length);
    } catch (error) {
      console.error('Failed to load products:', error);
      toast.error('Failed to load products');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

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
      };

      if (editingProduct) {
        await productService.update(editingProduct.id, data);
      } else {
        await productService.create(data);
      }

      setShowModal(false);
      resetForm();
      loadProducts();
      loadLowStockCount();
      toast.success(editingProduct ? 'Product updated' : 'Product created');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to save product');
    }
  };

  const handleEdit = (product: Product) => {
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
      categoryId: product.categoryId || '',
    });
    setShowNewCategoryInput(false);
    setNewCategoryName('');
    setShowModal(true);
  };

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    try {
      await productService.delete(id);
      loadProducts();
      loadLowStockCount();
      toast.success('Product deleted');
    } catch (error) {
      toast.error('Failed to delete product');
    }
  };

  const resetForm = () => {
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
      categoryId: '',
    });
    setShowNewCategoryInput(false);
    setNewCategoryName('');
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Inventory Management</h1>
          <p className="text-muted-foreground">
            Manage your products and track stock levels
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowCSVImportModal(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
          <Button variant="outline" onClick={() => { setSelectedForLabels(products); setShowLabelPrintModal(true); }}>
            <Tag className="h-4 w-4 mr-2" />
            Print Labels
          </Button>
          <Button variant="outline" onClick={() => setShowReceiptScanModal(true)}>
            <Camera className="h-4 w-4 mr-2" />
            Scan Receipt
          </Button>
          <Button variant="primary" onClick={openCreateModal}>
            <Plus className="h-4 w-4 mr-2" />
            Add Product
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Package className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Products</p>
              <p className="text-xl font-bold">{totalProducts}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-warning/10">
              <AlertTriangle className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Low Stock</p>
              <p className="text-xl font-bold">{lowStockCount}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-destructive/10">
              <TrendingDown className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Out of Stock</p>
              <p className="text-xl font-bold">{outOfStockCount}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-success/10">
              <DollarSign className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Inventory Value</p>
              <p className="text-xl font-bold">{formatCurrency(inventoryValue)}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by name, SKU, or barcode..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Category</label>
          <select
            value={filterCategory}
            onChange={(e) => { setFilterCategory(e.target.value); setCurrentPage(1); }}
            className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm min-w-[150px]"
          >
            <option value="">All Categories</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Status</label>
          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value as '' | 'true' | 'false'); setCurrentPage(1); }}
            className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm min-w-[130px]"
          >
            <option value="">All</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
      </div>

      {/* Products table */}
      <Card>
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Loading products...</p>
          </div>
        ) : products.length === 0 ? (
          <div className="p-12 text-center">
            <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No products found</h3>
            <p className="text-muted-foreground mb-4">
              {search ? 'Try adjusting your search' : 'Get started by adding your first product'}
            </p>
            {!search && (
              <Button variant="primary" onClick={openCreateModal}>
                <Plus className="h-4 w-4 mr-2" />
                Add Product
              </Button>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Product Name</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => {
                const isLowStock = product.stockQuantity <= product.lowStockAlert;
                const margin = product.price > 0 ? ((product.price - product.cost) / product.price) * 100 : 0;

                return (
                  <TableRow key={product.id}>
                    <TableCell>
                      <span className="font-mono text-sm">{product.sku}</span>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{product.name}</p>
                        {product.category && (
                          <p className="text-xs text-muted-foreground">
                            {product.category.name}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{formatCurrency(product.price)}</p>
                        <p className={`text-xs ${margin >= 0 ? 'text-success' : 'text-destructive'}`}>
                          {margin.toFixed(1)}% margin
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>{formatCurrency(product.cost)}</TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{product.stockQuantity}</p>
                        <p className="text-xs text-muted-foreground">
                          Alert: {product.lowStockAlert}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {!product.isActive && (
                          <Badge variant="secondary">Inactive</Badge>
                        )}
                        {product.isActive && isLowStock ? (
                          <Badge variant="warning">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Low Stock
                          </Badge>
                        ) : product.isActive ? (
                          <Badge variant="success">In Stock</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setAdjustingProduct(product);
                            setShowStockAdjustModal(true);
                          }}
                          title="Adjust Stock"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(product)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTargetId(product.id)}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-muted-foreground">
            Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, totalProducts)} of {totalProducts} products
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm px-2">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Product Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          resetForm();
        }}
        title={editingProduct ? 'Edit Product' : 'Add New Product'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="SKU"
              value={formData.sku}
              onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
              required
            />
            <Input
              label="Barcode"
              value={formData.barcode}
              onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
            />
          </div>

          <Input
            label="Product Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />

          <Input
            label="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          />

          {/* Category Selection */}
          <div>
            <label className="block text-sm font-medium mb-1">Category</label>
            {!showNewCategoryInput ? (
              <div className="flex gap-2">
                <select
                  value={formData.categoryId}
                  onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                  className="flex-1 h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select a category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowNewCategoryInput(true)}
                  title="Create new category"
                >
                  <FolderPlus className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  placeholder="New category name"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleCreateCategory}
                  disabled={isCreatingCategory || !newCategoryName.trim()}
                >
                  {isCreatingCategory ? 'Creating...' : 'Add'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowNewCategoryInput(false);
                    setNewCategoryName('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Input
              type="number"
              label="Cost Price"
              value={formData.cost}
              onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
              step="0.01"
              min="0"
              required
            />
            <Input
              type="number"
              label="Retail Price"
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              step="0.01"
              min="0.01"
              required
            />
            <Input
              type="number"
              label="Compare-at Price"
              value={formData.compareAtPrice}
              onChange={(e) => setFormData({ ...formData, compareAtPrice: e.target.value })}
              step="0.01"
              min="0"
            />
          </div>
          {formData.cost && formData.price && parseFloat(formData.price) < parseFloat(formData.cost) && (
            <p className="text-xs text-warning flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Retail price is below cost
            </p>
          )}

          <Input
            label="Image URL"
            value={formData.image}
            onChange={(e) => setFormData({ ...formData, image: e.target.value })}
            placeholder="https://example.com/image.jpg"
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              type="number"
              label="Stock Quantity"
              value={formData.stockQuantity}
              onChange={(e) => setFormData({ ...formData, stockQuantity: e.target.value })}
              required
            />
            <Input
              type="number"
              label="Low Stock Alert"
              value={formData.lowStockAlert}
              onChange={(e) => setFormData({ ...formData, lowStockAlert: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={formData.isTaxable}
                onChange={(e) => setFormData({ ...formData, isTaxable: e.target.checked })}
                className="rounded border-input"
              />
              <span className="text-sm">Taxable item</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={formData.isActive}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                className="rounded border-input"
              />
              <span className="text-sm">Active</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={formData.trackInventory}
                onChange={(e) => setFormData({ ...formData, trackInventory: e.target.checked })}
                className="rounded border-input"
              />
              <span className="text-sm">Track inventory</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={formData.allowBackorder}
                onChange={(e) => setFormData({ ...formData, allowBackorder: e.target.checked })}
                className="rounded border-input"
              />
              <span className="text-sm">Allow backorder</span>
            </label>
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => {
                setShowModal(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" className="flex-1">
              {editingProduct ? 'Update Product' : 'Create Product'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Stock Adjustment Modal */}
      <StockAdjustmentModal
        isOpen={showStockAdjustModal}
        onClose={() => {
          setShowStockAdjustModal(false);
          setAdjustingProduct(null);
        }}
        onSuccess={() => { loadProducts(); loadLowStockCount(); }}
        product={adjustingProduct}
      />

      {/* Receipt Scan Modal */}
      <ReceiptScanModal
        isOpen={showReceiptScanModal}
        onClose={() => setShowReceiptScanModal(false)}
        onSuccess={() => { loadProducts(); loadLowStockCount(); }}
      />

      <BarcodeLabelPrint
        isOpen={showLabelPrintModal}
        onClose={() => setShowLabelPrintModal(false)}
        products={selectedForLabels}
      />

      <CSVImportModal
        isOpen={showCSVImportModal}
        onClose={() => setShowCSVImportModal(false)}
        onImportComplete={() => { loadProducts(); loadLowStockCount(); }}
      />

      <ConfirmDialog
        isOpen={deleteTargetId !== null}
        onClose={() => setDeleteTargetId(null)}
        onConfirm={() => deleteTargetId && handleDelete(deleteTargetId)}
        title="Delete product?"
        message="This will remove the product from your catalog. This action cannot be undone."
        destructive
        confirmLabel="Delete"
      />
    </div>
  );
};
