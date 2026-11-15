import { FormSection, ManagementPage } from '@/components/common/Workspace';
import { Select } from '@/components/ui/Select';
import { useLegacyPageRefresh } from '@/hooks/useLegacyPageRefresh';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import { useUrlFilter, useUrlPage } from '@/hooks/useUrlFilter';
import { SupplierPicker, PickableSupplier } from '@/components/common/SupplierPicker';
import { OrderInvoicePhotos } from '@/components/deliveries/OrderInvoicePhotos';
import { useAuthStore } from '@/store/authStore';
import { can } from '@/lib/capabilities';
import { PurchaseReceiptModal } from '@/components/inventory/PurchaseReceiptModal';
import { PurchaseOrder, outstandingQuantity } from '@/types/purchasing';
import React, { useState, useEffect, useRef, useId } from 'react';
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Package,
  FileText,
  CheckCircle,
  XCircle,
  Truck,
  RefreshCw,
  Clock,
} from 'lucide-react';
import { supplierService, purchaseOrderService, productService, apiErrorMessage } from '../services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Textarea';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PageTabs } from '@/components/common/PageTabs';
import { DeliveryDaysField } from '@/components/inventory/DeliveryDaysField';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { EmptyState } from '@/components/common/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import toast from 'react-hot-toast';
import { Spinner } from '@/components/ui/LoadingState';
import { DialogActions } from '@/components/ui/DialogActions';
import { RowActions } from '@/components/common/RowActions';

interface Supplier {
  id: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  isActive: boolean;
  paymentTerms?: string;
  leadTimeDays?: number;
  minimumOrder?: number;
  deliveryDays?: number[];
  _count?: {
    products: number;
    purchaseOrders: number;
  };
}

interface Product {
  id: string;
  name: string;
  sku: string;
  barcode?: string;
  price: number;
  stockQuantity: number;
  cost: number;
  // Set on pack rows (e.g. a carton): the stock item it holds and how many.
  inventoryProductId?: string;
  sellingUnitId?: string | null;
  unitsPerPackage?: number;
}

const PAGE_SIZE = 20;

export const Suppliers: React.FC<{ view: 'suppliers' | 'orders' }> = ({ view: activeTab }) => {
  const { locationId } = useEffectiveLocation();
  const requestVersion = useRef(0);
  const [loadError, setLoadError] = useState('');
  const [chosenSupplier, setChosenSupplier] = useState<PickableSupplier | null>(null);
  const role = useAuthStore(s => s.user?.role);
  const canManage = can(role, 'inventory.manage');
  const [receivingOrder, setReceivingOrder] = useState<PurchaseOrder | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [productSuggestions, setProductSuggestions] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useUrlFilter('search');
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [orderStatusFilter, setOrderStatusFilter] = useUrlFilter('status');

  // Pagination (server-side)
  const [supplierPage, setSupplierPage] = useUrlPage();
  const [supplierTotal, setSupplierTotal] = useState(0);
  const [supplierTotalPages, setSupplierTotalPages] = useState(1);
  const [orderPage, setOrderPage] = useUrlPage();
  const [orderTotal, setOrderTotal] = useState(0);
  const [orderTotalPages, setOrderTotalPages] = useState(1);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const productSearchDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Modal states
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showNewProductModal, setShowNewProductModal] = useState(false);
  const [showOrderDetailModal, setShowOrderDetailModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
  const [editingOrder, setEditingOrder] = useState(false);

  // Product search
  const [productSearches, setProductSearches] = useState<string[]>(['']);
  const [showSuggestions, setShowSuggestions] = useState<number | null>(null);
  const searchRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Form states
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    contactName: '',
    email: '',
    phone: '',
    address: '',
    notes: '',
    paymentTerms: '',
    leadTimeDays: '',
    minimumOrder: '',
    deliveryDays: [] as number[],
  });

  const [orderForm, setOrderForm] = useState({
    supplierId: '',
    items: [{ productId: '', quantity: 1, cost: 0, productName: '', packSize: 1, packQuantity: 1, packCost: 0 }],
    notes: '',
    expectedAt: '',
  });

  // New product form
  const [newProductForm, setNewProductForm] = useState({
    sku: '',
    name: '',
    barcode: '',
    cost: '',
    price: '',
    stockQuantity: '0',
    lowStockAlert: '10',
  });
  const [newProductIndex, setNewProductIndex] = useState<number>(0);

  // Debounce the shared search box (drives the server-side supplier search)
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [search]);

  const fetchSuppliers = async (quiet = false, active: () => boolean = () => true, signal?: AbortSignal) => {
    const version = ++requestVersion.current; if (!quiet) setLoadError('');
    try {
      if (!quiet) setLoading(true);
      const res = await supplierService.getAll({
        locationId, page: supplierPage,
        limit: PAGE_SIZE,
        search: debouncedSearch || undefined,
      }, signal);
      if (version !== requestVersion.current || !active()) return;
      setLoadError('');
      setSuppliers(res.data.data);
      setSupplierTotal(res.data.pagination?.total ?? res.data.data.length);
      setSupplierTotalPages(res.data.pagination?.totalPages ?? 1);
    } catch (error) {
      if (quiet) throw error;
      if (version === requestVersion.current) setLoadError('Unable to load suppliers. Try again.');
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  };

  const fetchOrders = async (quiet = false, active: () => boolean = () => true, signal?: AbortSignal) => {
    const version = ++requestVersion.current; if (!quiet) setLoadError('');
    try {
      if (!quiet) setLoading(true);
      const res = await purchaseOrderService.getAll({
        locationId, search: debouncedSearch || undefined, page: orderPage,
        limit: PAGE_SIZE,
        status: orderStatusFilter || undefined,
      }, signal);
      if (version !== requestVersion.current || !active()) return;
      setLoadError('');
      setOrders(res.data.data);
      setOrderTotal(res.data.pagination?.total ?? res.data.data.length);
      setOrderTotalPages(res.data.pagination?.totalPages ?? 1);
    } catch (error) {
      if (quiet) throw error;
      if (version === requestVersion.current) setLoadError('Unable to load orders. Try again.');
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'suppliers') fetchSuppliers(); else fetchOrders();
    return () => { requestVersion.current++; };
  }, [activeTab, supplierPage, orderPage, debouncedSearch, orderStatusFilter, locationId]);
  useEffect(() => {
    setSuppliers([]); setOrders([]); setReceivingOrder(null); setShowSupplierModal(false); setShowOrderModal(false);
    setShowNewProductModal(false); setShowOrderDetailModal(false); resetOrderForm(); resetSupplierForm(); setChosenSupplier(null);
    return () => { if (productSearchDebounceRef.current) clearTimeout(productSearchDebounceRef.current); };
  }, [locationId]);
  const fetchData = () => { if (activeTab === 'suppliers') fetchSuppliers(); else fetchOrders(); };

  // Which pop-up is saving: its main button shows a spinner and cannot be pressed twice.
  const [saving, setSaving] = useState<'supplier' | 'order' | 'product' | null>(null);
  const supplierFormId = useId(), newProductFormId = useId();

  const handleCreateSupplier = async () => {
    if (saving) return;
    setSaving('supplier');
    try {
      const supplierData = {
        ...supplierForm,
        email: supplierForm.email.trim() || null,
        leadTimeDays: supplierForm.leadTimeDays ? parseInt(supplierForm.leadTimeDays) : undefined,
        minimumOrder: supplierForm.minimumOrder ? parseFloat(supplierForm.minimumOrder) : undefined,
      };

      if (editingSupplier) {
        await supplierService.update(editingSupplier.id, supplierData);
      } else {
        await supplierService.create(supplierData);
      }

      setShowSupplierModal(false);
      resetSupplierForm();
      fetchData();
      toast.success(editingSupplier ? 'Supplier updated' : 'Supplier created');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to save supplier');
    } finally { setSaving(null); }
  };

  // One shared confirm dialog for delete/receive/cancel actions
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    destructive?: boolean;
    confirmLabel?: string;
    action: () => void;
  } | null>(null);

  const handleDeleteSupplier = async (id: string) => {
    try {
      await supplierService.delete(id);
      fetchData();
      toast.success('Supplier deleted');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to delete supplier');
    }
  };

  /** A line ordered in supplier cases: units = cases x units per case. */
  type OrderLine = { productId: string; quantity: number; cost: number; productName: string; packSize: number; packQuantity: number; packCost: number };
  const lineUnits = (item: OrderLine) => item.packSize > 1 ? item.packQuantity * item.packSize : item.quantity;
  const lineUnitCost = (item: OrderLine) => item.packSize > 1 ? Math.round(item.packCost / item.packSize * 10000) / 10000 : item.cost;
  const lineTotal = (item: OrderLine) => item.packSize > 1 ? item.packCost * item.packQuantity : item.cost * item.quantity;

  const handleCreateOrder = async () => {
    if (saving) return;
    setSaving('order');
    try {
      const validItems = orderForm.items.filter(item => item.productId);
      if (validItems.some(item => !(item.packSize > 1 ? item.packQuantity : item.quantity))) {
        toast.error('Enter a quantity of at least 1 for every item');
        return;
      }
      if (validItems.length === 0) {
        toast.error('Please add at least one product to the order');
        return;
      }

      const orderData = {
        supplierId: orderForm.supplierId,
        items: validItems.map(item => ({
          productId: item.productId,
          quantity: lineUnits(item),
          cost: lineUnitCost(item),
          ...(item.packSize > 1 ? { packSize: item.packSize, packQuantity: item.packQuantity, packCost: item.packCost } : {}),
        })),
        notes: orderForm.notes || undefined,
        expectedAt: orderForm.expectedAt || undefined,
      };

      if (editingOrder && selectedOrder) {
        await purchaseOrderService.update(selectedOrder.id, orderData);
      } else {
        await purchaseOrderService.create(orderData);
      }

      setShowOrderModal(false);
      resetOrderForm();
      fetchData();
      toast.success(editingOrder ? 'Order updated' : 'Order created');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to save order');
    } finally { setSaving(null); }
  };

  const openReceiving = async (orderId: string) => {
    try {
      const response = await purchaseOrderService.getById(orderId);
      setReceivingOrder(response.data.data);
    } catch { toast.error('Could not load the order. Please try again.'); }
  };

  const confirmOrderAction = (orderId: string) => setConfirmState({
    title: 'Cancel order?', message: 'This action cannot be undone.', destructive: true,
    confirmLabel: 'Cancel Order', action: () => handleOrderAction(orderId, 'cancel'),
  });

  const handleOrderAction = async (orderId: string, action: string) => {
    try {
      if (action === 'cancel') {
        await purchaseOrderService.cancel(orderId);
      } else {
        await purchaseOrderService.updateStatus(orderId, action);
      }
      fetchData();
      if (showOrderDetailModal) {
        const response = await purchaseOrderService.getById(orderId);
        setSelectedOrder(response.data.data);
      }
      toast.success('Order updated');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to update order');
    }
  };

  const handleAutoGenerate = async () => {
    try {
      const response = await purchaseOrderService.autoGenerate();
      const created = response.data.data.ordersCreated;
      if (created > 0) {
        toast.success(`Created ${created} purchase order(s)`);
      } else {
        toast('No orders created — only low-stock products that are linked to a supplier can be auto-ordered.', { icon: 'ℹ️', duration: 6000 });
      }
      fetchData();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to auto-generate orders');
    }
  };

  const handleCreateNewProduct = async () => {
    if (saving) return;
    setSaving('product');
    try {
      const productData = {
        sku: newProductForm.sku,
        name: newProductForm.name,
        barcode: newProductForm.barcode || undefined,
        cost: parseFloat(newProductForm.cost),
        price: parseFloat(newProductForm.price),
        stockQuantity: parseInt(newProductForm.stockQuantity),
        lowStockAlert: parseInt(newProductForm.lowStockAlert),
        isTaxable: true,
      };

      const response = await productService.create(productData);
      const newProduct = response.data.data;

      const newItems = [...orderForm.items];
      newItems[newProductIndex] = {
        productId: newProduct.id,
        quantity: newItems[newProductIndex].quantity,
        cost: newProduct.cost,
        productName: newProduct.name,
        packSize: 1, packQuantity: 1, packCost: newProduct.cost,
      };
      setOrderForm({ ...orderForm, items: newItems });

      const newSearches = [...productSearches];
      newSearches[newProductIndex] = newProduct.name;
      setProductSearches(newSearches);

      setNewProductForm({
        sku: '',
        name: '',
        barcode: '',
        cost: '',
        price: '',
        stockQuantity: '0',
        lowStockAlert: '10',
      });
      setShowNewProductModal(false);
      toast.success('Product created');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to create product');
    } finally { setSaving(null); }
  };

  const closeOrderDetail = () => { setShowOrderDetailModal(false); setSelectedOrder(null); };

  const handleProductSearch = (index: number, value: string) => {
    const newSearches = [...productSearches];
    newSearches[index] = value;
    setProductSearches(newSearches);
    setShowSuggestions(index);

    // Server-side product search (debounced), replaces the old 500-row prefetch
    if (productSearchDebounceRef.current) clearTimeout(productSearchDebounceRef.current);
    if (!value) {
      setProductSuggestions([]);
      return;
    }
    productSearchDebounceRef.current = setTimeout(async () => {
      try {
        // Packs (e.g. "Marlboro Red Carton") are listed too: ordering one orders its single in cases.
        const res = await productService.getAll({ search: value, limit: 10, includeSellingUnits: true });
        const results: Product[] = res.data.data || [];
        setProductSuggestions(results);

        const exactMatch = results.find(
          p => p.barcode === value || p.sku.toLowerCase() === value.toLowerCase()
        );
        if (exactMatch) {
          selectProduct(index, exactMatch);
        }
      } catch (error) {
        console.error('Product search failed:', error);
      }
    }, 300);
  };

  const selectProduct = (index: number, product: Product) => {
    const newItems = [...orderForm.items];
    // A pack row orders its single (the stock item) in cases of the pack's size, at the pack's cost.
    const productId = product.inventoryProductId || product.id;
    const packUnits = product.sellingUnitId ? product.unitsPerPackage || 1 : 1;
    const packCost = Number(product.cost);
    newItems[index] = packUnits > 1 ? {
      productId, quantity: packUnits, cost: Math.round(packCost / packUnits * 10000) / 10000,
      productName: product.name, packSize: packUnits, packQuantity: 1, packCost,
    } : {
      productId,
      quantity: newItems[index].quantity,
      cost: product.cost,
      productName: product.name,
      packSize: 1, packQuantity: 1, packCost: product.cost,
    };
    setOrderForm({ ...orderForm, items: newItems });
    // Default to how this supplier sells it (e.g. a case of 24) when a case is set up.
    const supplierId = orderForm.supplierId;
    productService.getSellingUnits(productId).then(res => {
      const supplierCase = (res.data.data.suppliers || []).find((s: { supplierId: string; packSize: number }) =>
        s.supplierId === supplierId && (packUnits === 1 || Number(s.packSize) === packUnits));
      if (!supplierCase) return;
      setOrderForm(current => {
        const items = [...current.items];
        const line = items[index];
        if (!line || line.productId !== productId) return current;
        const packSize = Number(supplierCase.packSize) || 1;
        const unitCost = supplierCase.cost != null ? Number(supplierCase.cost) : line.cost;
        items[index] = { ...line, cost: unitCost, packSize, packQuantity: 1,
          packCost: supplierCase.packCost != null ? Number(supplierCase.packCost) : Math.round(unitCost * packSize * 100) / 100 };
        return { ...current, items };
      });
    }).catch(() => { /* no case information: order in single units */ });

    const newSearches = [...productSearches];
    newSearches[index] = product.name;
    setProductSearches(newSearches);
    setShowSuggestions(null);
  };

  const getFilteredProducts = (searchTerm: string) => {
    // Suggestions are already server-filtered by the debounced search
    if (!searchTerm) return [];
    return productSuggestions;
  };

  const resetSupplierForm = () => {
    setSupplierForm({
      name: '',
      contactName: '',
      email: '',
      phone: '',
      address: '',
      notes: '',
      paymentTerms: '',
      leadTimeDays: '',
      minimumOrder: '',
      deliveryDays: [],
    });
    setEditingSupplier(null);
  };

  const resetOrderForm = () => {
    setChosenSupplier(null);
    setOrderForm({
      supplierId: '',
      items: [{ productId: '', quantity: 1, cost: 0, productName: '', packSize: 1, packQuantity: 1, packCost: 0 }],
      notes: '',
      expectedAt: '',
    });
    setProductSearches(['']);
    setEditingOrder(false);
    setSelectedOrder(null);
  };

  const openEditSupplier = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setSupplierForm({
      name: supplier.name,
      contactName: supplier.contactName || '',
      email: supplier.email || '',
      phone: supplier.phone || '',
      address: supplier.address || '',
      notes: supplier.notes || '',
      paymentTerms: supplier.paymentTerms || '',
      leadTimeDays: supplier.leadTimeDays?.toString() || '',
      minimumOrder: supplier.minimumOrder?.toString() || '',
      deliveryDays: supplier.deliveryDays || [],
    });
    setShowSupplierModal(true);
  };

  const openOrderDetail = async (order: PurchaseOrder) => {
    try {
      const response = await purchaseOrderService.getById(order.id);
      setSelectedOrder(response.data.data);
      setShowOrderDetailModal(true);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'This order could not be opened. Try again.'));
    }
  };

  const openEditOrder = async (order: PurchaseOrder) => {
    try {
      const response = await purchaseOrderService.getById(order.id);
      const orderData = response.data.data;
      setSelectedOrder(orderData);
      setEditingOrder(true);
      setChosenSupplier(orderData.supplier);

      setOrderForm({
        supplierId: orderData.supplier.id,
        items: orderData.items.map((item: any) => ({
          productId: item.productId,
          quantity: item.quantity,
          cost: Number(item.cost),
          productName: item.productName,
          packSize: item.packSize || 1,
          packQuantity: item.packQuantity || item.quantity,
          packCost: item.packCost != null ? Number(item.packCost) : Number(item.cost) * (item.packSize || 1),
        })),
        notes: orderData.notes || '',
        expectedAt: orderData.expectedAt ? orderData.expectedAt.split('T')[0] : '',
      });

      setProductSearches(orderData.items.map((item: any) => item.productName));
      setShowOrderModal(true);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'This order could not be opened for editing. Try again.'));
    }
  };

  const addOrderItem = () => {
    setOrderForm({
      ...orderForm,
      items: [...orderForm.items, { productId: '', quantity: 1, cost: 0, productName: '', packSize: 1, packQuantity: 1, packCost: 0 }],
    });
    setProductSearches([...productSearches, '']);
  };

  const removeOrderItem = (index: number) => {
    setOrderForm({
      ...orderForm,
      items: orderForm.items.filter((_, i) => i !== index),
    });
    setProductSearches(productSearches.filter((_, i) => i !== index));
  };

  const updateOrderItem = (index: number, field: string, value: any) => {
    const newItems = [...orderForm.items];
    newItems[index] = { ...newItems[index], [field]: value };
    setOrderForm({ ...orderForm, items: newItems });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <Badge variant="warning">Pending</Badge>;
      case 'ORDERED':
        return <Badge variant="default">Ordered</Badge>;
      case 'PARTIALLY_RECEIVED':
        return <Badge variant="warning">Partially received</Badge>;
      case 'RECEIVED':
        return <Badge variant="success">Closed</Badge>;
      case 'CANCELLED':
        return <Badge variant="destructive">Cancelled</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const filteredSuppliers = suppliers;
  const filteredOrders = orders;

  // Loading is rendered inside the tab cards so the page chrome (tabs,
  // search box) stays mounted — otherwise typing in search loses focus
  const loadingRow = (
    <div className="flex justify-center py-12">
      <Spinner size="lg" />
    </div>
  );

  const autoRefresh = useLegacyPageRefresh((current, signal) => activeTab === 'suppliers' ? fetchSuppliers(true, current, signal) : fetchOrders(true, current, signal), { key: JSON.stringify([locationId, activeTab, supplierPage, orderPage, debouncedSearch, orderStatusFilter]), paused: loading });

  return (
    <ManagementPage className="">
      <PageHeader
        title={activeTab === 'suppliers' ? 'Suppliers' : 'Purchase Orders'}
        secondaryTabs={activeTab === 'orders' ? <PageTabs secondary label="Order status" value={orderStatusFilter} onChange={setOrderStatusFilter} items={[
          { id: '', label: 'All' }, { id: 'PENDING', label: 'Pending' }, { id: 'ORDERED', label: 'Ordered' },
          { id: 'PARTIALLY_RECEIVED', label: 'Partially Received' }, { id: 'RECEIVED', label: 'Closed' }, { id: 'CANCELLED', label: 'Cancelled' },
        ]} /> : undefined}
        actions={<>{canManage && <>
          {activeTab === 'orders' && (
            <Button onClick={handleAutoGenerate}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Auto-Generate POs
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => {
              if (activeTab === 'suppliers') {
                resetSupplierForm();
                setShowSupplierModal(true);
              } else {
                resetOrderForm();
                setShowOrderModal(true);
              }
            }}
          >
            <Plus className="w-4 h-4 mr-2" />
            {activeTab === 'suppliers' ? 'Add Supplier' : 'New Order'}
          </Button></>}</>}
        subtitle={activeTab === 'suppliers' ? 'Manage your store suppliers and purchasing terms.' : 'Create orders and record deliveries as they arrive.'}
      />
      {autoRefresh.notice}

      <div className="flex flex-wrap gap-3 justify-between items-center mb-6">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            type="text"
            placeholder={activeTab === 'suppliers' ? 'Search suppliers...' : 'Search orders...'}
            aria-label={activeTab === 'suppliers' ? 'Search suppliers' : 'Search purchase orders'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

      </div>

      {activeTab === 'suppliers' && (
        <Card>
          {loading ? (
            loadingRow
          ) : loadError ? (<div className="p-6" role="alert"><p>{loadError}</p><Button className="mt-3" variant="outline" onClick={fetchData}>Retry</Button></div>) : filteredSuppliers.length === 0 ? (
            <EmptyState
              icon={Truck}
              title="No suppliers found"
              hint={search ? 'Try adjusting your search' : 'Get started by adding your first supplier'}
            />
          ) : (
            <Table scrollLabel="Suppliers" stackOnPhone>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Products</TableHead>
                  <TableHead>Orders</TableHead>
                  <TableHead>Lead Time</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSuppliers.map((supplier) => (
                  <TableRow key={supplier.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{supplier.name}</p>
                        {supplier.email && (
                          <p className="text-sm text-muted-foreground">{supplier.email}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {supplier.contactName && <p className="text-sm">{supplier.contactName}</p>}
                      {supplier.phone && <p className="text-sm text-muted-foreground">{supplier.phone}</p>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Package className="w-4 h-4 text-muted-foreground" />
                        <span>{supplier._count?.products || 0}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        <span>{supplier._count?.purchaseOrders || 0}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {supplier.leadTimeDays ? (
                        <div className="flex items-center gap-1">
                          <Clock className="w-4 h-4 text-muted-foreground" />
                          <span>{supplier.leadTimeDays} days</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {supplier.isActive ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <RowActions name={supplier.name}
                        primary={canManage && { label: 'Edit', onAction: () => openEditSupplier(supplier) }}
                        items={[can(role, 'financial.delete') && { id: 'delete', label: 'Delete supplier', icon: <Trash2 size={16} />, destructive: true,
                          onAction: () => setConfirmState({ title: 'Delete supplier?', message: 'This will remove the supplier. Suppliers with purchase orders cannot be deleted.', destructive: true, confirmLabel: 'Delete', action: () => handleDeleteSupplier(supplier.id) }) }]} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {activeTab === 'suppliers' && (
        <Pagination
          page={supplierPage}
          totalPages={supplierTotalPages}
          onPageChange={setSupplierPage}
          totalItems={supplierTotal}
          itemName="suppliers"
        />
      )}



      {activeTab === 'orders' && (
        <Card>
          {loading ? (
            loadingRow
          ) : loadError ? (<div className="p-6" role="alert"><p>{loadError}</p><Button className="mt-3" variant="outline" onClick={fetchData}>Retry</Button></div>) : filteredOrders.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No purchase orders found"
              hint={search ? 'Try adjusting your search' : 'Create a new purchase order to get started'}
            />
          ) : (
            <Table scrollLabel="Purchase orders" stackOnPhone>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <span className="font-mono text-sm">{order.orderNumber}</span>
                    </TableCell>
                    <TableCell>{order.supplier.name}</TableCell>
                    <TableCell className="text-right">{order._count?.items || 0} {(order._count?.items || 0) === 1 ? 'item' : 'items'}</TableCell>
                    <TableCell className="text-right font-medium whitespace-nowrap">{formatCurrency(order.totalAmount)}</TableCell>
                    <TableCell>{getStatusBadge(order.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(order.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {/* The next step for the order's status is the visible word; the rest is under "…". */}
                      {(() => {
                        const next = !canManage ? null
                          : order.status === 'PENDING' ? { label: 'Mark ordered', onAction: () => void handleOrderAction(order.id, 'ORDERED') }
                          : ['ORDERED', 'PARTIALLY_RECEIVED'].includes(order.status) ? { label: 'Receive', onAction: () => void openReceiving(order.id) } : null;
                        return <RowActions name={order.orderNumber} primary={next || { label: 'View', onAction: () => openOrderDetail(order) }} items={[
                          next && { id: 'view', label: 'View details', icon: <FileText size={16} />, onAction: () => openOrderDetail(order) },
                          canManage && order.status === 'PENDING' && { id: 'edit', label: 'Edit order', icon: <Edit size={16} />, onAction: () => openEditOrder(order) },
                          canManage && (order.status === 'PENDING' || order.status === 'ORDERED') && { id: 'cancel', label: 'Cancel order', icon: <XCircle size={16} />, destructive: true, onAction: () => confirmOrderAction(order.id) },
                        ]} />;
                      })()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {activeTab === 'orders' && (
        <Pagination
          page={orderPage}
          totalPages={orderTotalPages}
          onPageChange={setOrderPage}
          totalItems={orderTotal}
          itemName="orders"
        />
      )}

      {/* Supplier Modal: essentials first; terms and notes open when needed. */}
      <Modal
        isOpen={showSupplierModal}
        onClose={() => { if (saving) return; setShowSupplierModal(false); resetSupplierForm(); }}
        title={editingSupplier ? 'Edit Supplier' : 'Add Supplier'}
        description="The name is all you need. Add the rest any time."
        size="lg"
        footer={<DialogActions form={supplierFormId} confirmLabel={editingSupplier ? 'Update Supplier' : 'Create Supplier'} loading={saving === 'supplier'}
          onCancel={() => { setShowSupplierModal(false); resetSupplierForm(); }} />}
      >
        <form id={supplierFormId} onSubmit={event => { event.preventDefault(); void handleCreateSupplier(); }}>
          <FormSection title="Supplier">
            <Input label="Supplier Name" type="text" value={supplierForm.name} onChange={(event) => setSupplierForm({ ...supplierForm, name: event.target.value })} placeholder="Enter supplier name" required />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Contact Name" type="text" value={supplierForm.contactName} onChange={(e) => setSupplierForm({ ...supplierForm, contactName: e.target.value })} placeholder="Contact person" />
              <Input label="Phone" type="tel" value={supplierForm.phone} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })} placeholder="Phone number" />
            </div>
            <Input label="Email" type="email" value={supplierForm.email} onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })} placeholder="supplier@example.com" />
          </FormSection>
          <FormSection collapsible defaultOpen={!!editingSupplier} title="Ordering terms"
            summary={[supplierForm.leadTimeDays && `${supplierForm.leadTimeDays}-day lead time`, supplierForm.paymentTerms, supplierForm.deliveryDays.length > 0 && `${supplierForm.deliveryDays.length} delivery day${supplierForm.deliveryDays.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ') || 'Not set'}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input label="Lead Time (days)" type="number" value={supplierForm.leadTimeDays} onChange={(e) => setSupplierForm({ ...supplierForm, leadTimeDays: e.target.value })} placeholder="e.g., 7" min="0" />
              <Input label="Min. Order ($)" type="number" value={supplierForm.minimumOrder} onChange={(e) => setSupplierForm({ ...supplierForm, minimumOrder: e.target.value })} placeholder="e.g., 100" min="0" step="0.01" />
              <Select label="Payment Terms" value={supplierForm.paymentTerms} onChange={(e) => setSupplierForm({ ...supplierForm, paymentTerms: e.target.value })}>
                <option value="">Select...</option>
                <option value="NET15">Net 15</option>
                <option value="NET30">Net 30</option>
                <option value="NET60">Net 60</option>
                <option value="COD">COD</option>
                <option value="PREPAID">Prepaid</option>
              </Select>
            </div>
            <DeliveryDaysField value={supplierForm.deliveryDays} supplierId={editingSupplier?.id}
              onChange={deliveryDays => setSupplierForm({ ...supplierForm, deliveryDays })} />
          </FormSection>
          <FormSection collapsible defaultOpen={!!(editingSupplier?.address || editingSupplier?.notes)} title="Address & notes"
            summary={[supplierForm.address && 'Address', supplierForm.notes && 'Notes'].filter(Boolean).join(' · ') || 'Not added'}>
            <Textarea label="Address" value={supplierForm.address} onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })} rows={2} placeholder="Full address" />
            <Textarea label="Notes" value={supplierForm.notes} onChange={(e) => setSupplierForm({ ...supplierForm, notes: e.target.value })} rows={3} placeholder="Additional notes..." />
          </FormSection>
        </form>
      </Modal>

      {/* Order Modal */}
      <Modal
        isOpen={showOrderModal}
        onClose={() => { setShowOrderModal(false); resetOrderForm(); }}
        title={editingOrder ? 'Edit Purchase Order' : 'New Purchase Order'}
        size="lg"
        footer={(() => {
          const lines = orderForm.items.filter(item => item.productId);
          return <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{lines.length} item{lines.length === 1 ? '' : 's'} · <span className="text-base font-semibold text-foreground tabular-nums">Total {formatCurrency(orderForm.items.reduce((sum, item) => sum + lineTotal(item), 0))}</span></p>
            <DialogActions confirmLabel={editingOrder ? 'Update Order' : 'Create Order'} onConfirm={() => void handleCreateOrder()} loading={saving === 'order'}
              onCancel={() => { setShowOrderModal(false); resetOrderForm(); }} />
          </div>;
        })()}
      >
        <div>
          <div className="space-y-5">
            <div>
              {editingOrder ? <p className="text-sm">Supplier: {chosenSupplier?.name || selectedOrder?.supplier.name}</p> : <SupplierPicker locationId={locationId || undefined} selected={chosenSupplier} onSelect={supplier => { setChosenSupplier(supplier); setOrderForm(current => ({ ...current, supplierId: supplier.id })); }} />}
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Items <span className="text-destructive">*</span> <span className="font-normal text-muted-foreground">— scan a barcode or type a name. Buying by the case? Set units per case.</span></p>

              {/* Column Headers */}
              <div className="grid grid-cols-12 gap-2 mb-2 text-xs font-medium text-muted-foreground">
                <div className="col-span-5">Product</div>
                <div className="col-span-2">Quantity</div>
                <div className="col-span-2">Cost each</div>
                <div className="col-span-2">Units per case</div>
                <div className="col-span-1"></div>
              </div>

              <div className="space-y-3">
                {orderForm.items.map((item, index) => (
                  <div key={index} className="grid grid-cols-12 gap-2 items-start">
                    <div className="col-span-5 relative">
                      <Input
                        ref={(el) => { searchRefs.current[index] = el; }}
                        type="text"
                        value={productSearches[index] || ''}
                        onChange={(e) => handleProductSearch(index, e.target.value)}
                        onFocus={() => setShowSuggestions(index)}
                        // Keep the list open while focus moves into it (keyboard users), close otherwise.
                        onBlur={(e) => { if (!(e.relatedTarget as HTMLElement | null)?.closest('[data-product-suggestions]')) setTimeout(() => setShowSuggestions(null), 200); }}
                        placeholder="Scan or type a product"
                        className="w-full text-base py-2"
                      />
                      {showSuggestions === index && productSearches[index] && (
                        <div data-product-suggestions className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-y-auto"
                          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setShowSuggestions(null); }}>
                          {getFilteredProducts(productSearches[index]).map((product) => (
                            <button type="button" key={product.id} className="block w-full text-left px-3 py-2 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none cursor-pointer"
                              onMouseDown={(e) => e.preventDefault()} onClick={() => selectProduct(index, product)}>
                              <span className="block font-medium text-sm">{product.name}</span>
                              <span className="block text-xs text-muted-foreground">{product.sellingUnitId
                                ? `Pack of ${product.unitsPerPackage} | Pack cost: ${formatCurrency(product.cost)}`
                                : `${product.sku} | Stock: ${product.stockQuantity} | Cost: ${formatCurrency(product.cost)}`}</span>
                            </button>
                          ))}
                          {getFilteredProducts(productSearches[index]).length === 0 && (
                            <button type="button" className="block w-full text-left px-3 py-2 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none cursor-pointer text-primary"
                              onMouseDown={(e) => e.preventDefault()} onClick={() => { setNewProductIndex(index); setNewProductForm({ ...newProductForm, name: productSearches[index], sku: productSearches[index] }); setShowNewProductModal(true); }}>
                              <span className="block font-medium text-sm">+ Create new product</span>
                              <span className="block text-xs text-muted-foreground">"{productSearches[index]}" not found</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="col-span-2">
                      {item.packSize > 1
                        ? <Input type="number" aria-label={`Cases for item ${index + 1}`} value={item.packQuantity} onChange={(e) => updateOrderItem(index, 'packQuantity', Math.max(0, parseInt(e.target.value) || 0))} min="1" className="w-full" />
                        : <Input type="number" aria-label={`Quantity for item ${index + 1}`} value={item.quantity} onChange={(e) => updateOrderItem(index, 'quantity', Math.max(0, parseInt(e.target.value) || 0))} min="1" placeholder="0" className="w-full" />}
                    </div>
                    <div className="col-span-2">
                      {item.packSize > 1
                        ? <Input type="number" aria-label={`Case cost for item ${index + 1}`} value={item.packCost} onChange={(e) => updateOrderItem(index, 'packCost', parseFloat(e.target.value) || 0)} min="0" step="0.01" className="w-full" />
                        : <Input type="number" aria-label={`Unit cost for item ${index + 1}`} value={item.cost} onChange={(e) => updateOrderItem(index, 'cost', parseFloat(e.target.value) || 0)} min="0" step="0.01" placeholder="0.00" className="w-full" />}
                    </div>
                    <div className="col-span-2">
                      <Input type="number" aria-label={`Units per case for item ${index + 1}`} value={item.packSize} min="1" step="1" className="w-full"
                        onChange={(e) => {
                          const packSize = Math.max(1, parseInt(e.target.value) || 1);
                          const newItems = [...orderForm.items];
                          const line = newItems[index];
                          newItems[index] = packSize > 1
                            ? { ...line, packSize, packQuantity: line.packSize > 1 ? line.packQuantity : 1, packCost: line.packSize > 1 ? line.packCost / line.packSize * packSize : line.cost * packSize }
                            : { ...line, packSize: 1, quantity: lineUnits(line), cost: lineUnitCost(line) };
                          setOrderForm({ ...orderForm, items: newItems });
                        }} />
                    </div>
                    {item.productId && <p className="col-span-12 -mt-1 text-xs text-muted-foreground">
                      {item.packSize > 1 ? `${item.packQuantity} case${item.packQuantity === 1 ? '' : 's'} × ${item.packSize} = ${lineUnits(item)} units · ` : `${item.quantity} units · `}
                      {formatCurrency(lineUnitCost(item))} per unit · line {formatCurrency(lineTotal(item))}
                    </p>}
                    <div className="col-span-1 flex justify-center">
                      {orderForm.items.length > 1 && (
                        <Button variant="ghost" aria-label={`Remove order item ${index + 1}`} onClick={() => removeOrderItem(index)} className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <Button variant="ghost" onClick={addOrderItem} className="mt-2"><Plus className="w-4 h-4 mr-1" />Add another item</Button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_2fr]">
              <Input type="date" label="Expected Delivery" description="Optional" value={orderForm.expectedAt} onChange={(e) => setOrderForm({ ...orderForm, expectedAt: e.target.value })} />
              <Textarea label="Notes" description="Optional" value={orderForm.notes} onChange={(e) => setOrderForm({ ...orderForm, notes: e.target.value })} rows={2} />
            </div>
          </div>
        </div>
      </Modal>

      {/* New Product Modal */}
      <Modal isOpen={showNewProductModal} onClose={() => { if (!saving) setShowNewProductModal(false); }} title="Create New Product" size="md"
        description="It is added to your products and to this order."
        footer={<DialogActions form={newProductFormId} confirmLabel="Create Product" loading={saving === 'product'} onCancel={() => setShowNewProductModal(false)} />}>
        <form id={newProductFormId} className="space-y-4" onSubmit={event => { event.preventDefault(); void handleCreateNewProduct(); }}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="SKU" type="text" value={newProductForm.sku} onChange={(e) => setNewProductForm({ ...newProductForm, sku: e.target.value })} placeholder="e.g., PROD-001" required />
            <Input label="Barcode" type="text" value={newProductForm.barcode} onChange={(e) => setNewProductForm({ ...newProductForm, barcode: e.target.value })} placeholder="Barcode" />
          </div>
          <Input label="Product Name" type="text" value={newProductForm.name} onChange={(e) => setNewProductForm({ ...newProductForm, name: e.target.value })} placeholder="Enter product name" required />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Cost" type="number" value={newProductForm.cost} onChange={(e) => setNewProductForm({ ...newProductForm, cost: e.target.value })} placeholder="0.00" min="0" step="0.01" required />
            <Input label="Price" type="number" value={newProductForm.price} onChange={(e) => setNewProductForm({ ...newProductForm, price: e.target.value })} placeholder="0.00" min="0" step="0.01" required />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Initial Stock" type="number" value={newProductForm.stockQuantity} onChange={(e) => setNewProductForm({ ...newProductForm, stockQuantity: e.target.value })} min="0" />
            <Input label="Low Stock Alert" type="number" value={newProductForm.lowStockAlert} onChange={(e) => setNewProductForm({ ...newProductForm, lowStockAlert: e.target.value })} min="0" />
          </div>
        </form>
      </Modal>

      {/* Order Detail Modal: the next step is the one filled button; cancelling the order sits apart on the left. */}
      <Modal isOpen={showOrderDetailModal} onClose={closeOrderDetail} title={`Order ${selectedOrder?.orderNumber || ''}`} size="lg"
        footer={selectedOrder && <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-base font-semibold tabular-nums">Total {formatCurrency(selectedOrder.totalAmount)}</p>
          <DialogActions cancelLabel="Close" onCancel={closeOrderDetail}
            remove={canManage && (selectedOrder.status === 'PENDING' || selectedOrder.status === 'ORDERED') ? { label: 'Cancel order', icon: <XCircle aria-hidden="true" />, onClick: () => confirmOrderAction(selectedOrder.id) } : undefined}
            {...(canManage && selectedOrder.status === 'PENDING' ? { confirmLabel: <><Truck aria-hidden="true" />Mark as Ordered</>, onConfirm: () => void handleOrderAction(selectedOrder.id, 'ORDERED') }
              : canManage && ['ORDERED', 'PARTIALLY_RECEIVED'].includes(selectedOrder.status) ? { confirmLabel: <><CheckCircle aria-hidden="true" />Receive Delivery</>, onConfirm: () => void openReceiving(selectedOrder.id) } : {})}>
            {canManage && selectedOrder.status === 'PENDING' && <Button type="button" onClick={() => { setShowOrderDetailModal(false); openEditOrder(selectedOrder); }}><Edit aria-hidden="true" />Edit</Button>}
          </DialogActions>
        </div>}>
        {selectedOrder && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Supplier</p>
                <p className="font-medium">{selectedOrder.supplier.name}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <div className="mt-1">{getStatusBadge(selectedOrder.status)}</div>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Created</p>
                <p className="font-medium">{formatDate(selectedOrder.createdAt)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Expected Delivery</p>
                <p className="font-medium">{selectedOrder.expectedAt ? formatDate(selectedOrder.expectedAt) : 'Not set'}</p>
              </div>
              {selectedOrder.orderedAt && (
                <div>
                  <p className="text-sm text-muted-foreground">Ordered</p>
                  <p className="font-medium">{formatDate(selectedOrder.orderedAt)}</p>
                </div>
              )}
              {selectedOrder.receivedAt && (
                <div>
                  <p className="text-sm text-muted-foreground">Received</p>
                  <p className="font-medium">{formatDate(selectedOrder.receivedAt)}</p>
                </div>
              )}
            </div>
            {selectedOrder.notes && (
              <div>
                <p className="text-sm text-muted-foreground">Notes</p>
                <p className="text-sm">{selectedOrder.notes}</p>
              </div>
            )}
            <OrderInvoicePhotos purchaseOrderId={selectedOrder.id} />
            <div className="border-t pt-4">
              <h4 className="font-medium mb-2">Items</h4>
              <Table scrollLabel="Order items" stackOnPhone>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Ordered</TableHead>
                    <TableHead>Delivery progress</TableHead>
                    <TableHead>Cost</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedOrder.items?.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <p className="font-medium">{item.productName}</p>
                        <p className="text-xs text-muted-foreground">{item.sku}</p>
                      </TableCell>
                      <TableCell>{item.quantity}</TableCell>
                      <TableCell className="text-sm tabular-nums">{selectedOrder.receivingHistoryKnown ? <><p>{item.receivedQty} accepted · {item.damagedQty} damaged · {item.rejectedQty} rejected</p><p className="text-muted-foreground">{outstandingQuantity(item)} {selectedOrder.status === 'RECEIVED' ? 'missing at closure' : 'remaining'}</p></> : <span title="This order was closed before delivery history was recorded.">History unavailable</span>}</TableCell>
                      <TableCell>{formatCurrency(item.cost)}</TableCell>
                      <TableCell className="font-medium">{formatCurrency(item.quantity * item.cost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="border-t pt-4 space-y-2">
              <h4 className="font-medium">Delivery history</h4>
              {selectedOrder.receivingHistoryKnown === false && <p className="text-sm text-muted-foreground">This order predates item-level delivery records. Historical accepted and missing quantities are unavailable.</p>}
              {selectedOrder.receivingHistoryKnown && !selectedOrder.receipts?.length && <p className="text-sm text-muted-foreground">No deliveries recorded yet.</p>}
              {selectedOrder.receipts?.map(receipt => <div key={receipt.id} className="rounded-md border p-3 text-sm space-y-1">
                <p className="font-medium">{formatDateTime(receipt.createdAt)} {receipt.finalDelivery ? '· Final delivery' : '· Partial delivery'}</p>
                {receipt.items.map(line => <p key={line.purchaseOrderItemId}>{selectedOrder.items?.find(item => item.id === line.purchaseOrderItemId)?.productName}: {line.acceptedQty} accepted, {line.damagedQty} damaged, {line.rejectedQty} rejected</p>)}
                {receipt.notes && <p className="text-muted-foreground">{receipt.notes}</p>}
              </div>)}
            </div>
          </div>
        )}
      </Modal>

      {receivingOrder && <PurchaseReceiptModal key={receivingOrder.id} order={receivingOrder} onClose={() => setReceivingOrder(null)} onSaved={() => {
        setReceivingOrder(null);
        fetchOrders();
        if (showOrderDetailModal) openOrderDetail(receivingOrder);
        toast.success('Delivery recorded');
      }} />}

      <ConfirmDialog
        isOpen={confirmState !== null}
        onClose={() => setConfirmState(null)}
        onConfirm={() => confirmState?.action()}
        title={confirmState?.title || ''}
        message={confirmState?.message || ''}
        destructive={confirmState?.destructive}
        confirmLabel={confirmState?.confirmLabel}
      />
    </ManagementPage>
  );
};

export default Suppliers;
