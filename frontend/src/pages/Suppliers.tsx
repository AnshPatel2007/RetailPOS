import { ManagementPage } from '@/components/common/Workspace';
import { Select } from '@/components/ui/Select';
import { useLegacyPageRefresh } from '@/hooks/useLegacyPageRefresh';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import { useUrlFilter, useUrlPage } from '@/hooks/useUrlFilter';
import { SupplierPicker, PickableSupplier } from '@/components/common/SupplierPicker';
import { useAuthStore } from '@/store/authStore';
import { can } from '@/lib/capabilities';
import { PurchaseReceiptModal } from '@/components/inventory/PurchaseReceiptModal';
import { PurchaseOrder, outstandingQuantity } from '@/types/purchasing';
import React, { useState, useEffect, useRef } from 'react';
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
  DollarSign,
  Clock,
  Eye,
  AlertTriangle,
} from 'lucide-react';
import { supplierService, purchaseOrderService, productService } from '../services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PageTabs } from '@/components/common/PageTabs';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { EmptyState } from '@/components/common/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency } from '@/lib/utils';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import toast from 'react-hot-toast';

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

  const handleCreateSupplier = async () => {
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
    }
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
    try {
      const validItems = orderForm.items.filter(item => item.productId);
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
    }
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
    }
  };

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
        const res = await productService.getAll({ search: value, limit: 10 });
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
    newItems[index] = {
      productId: product.id,
      quantity: newItems[index].quantity,
      cost: product.cost,
      productName: product.name,
      packSize: 1, packQuantity: 1, packCost: product.cost,
    };
    setOrderForm({ ...orderForm, items: newItems });
    // Default to how this supplier sells it (e.g. a case of 24) when a case is set up.
    const supplierId = orderForm.supplierId;
    productService.getSellingUnits(product.id).then(res => {
      const supplierCase = (res.data.data.suppliers || []).find((s: { supplierId: string }) => s.supplierId === supplierId);
      if (!supplierCase) return;
      setOrderForm(current => {
        const items = [...current.items];
        const line = items[index];
        if (!line || line.productId !== product.id) return current;
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
    });
    setShowSupplierModal(true);
  };

  const openOrderDetail = async (order: PurchaseOrder) => {
    try {
      const response = await purchaseOrderService.getById(order.id);
      setSelectedOrder(response.data.data);
      setShowOrderDetailModal(true);
    } catch (error) {
      console.error('Failed to load order details:', error);
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
      console.error('Failed to load order for editing:', error);
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
      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );

  const autoRefresh = useLegacyPageRefresh((current, signal) => activeTab === 'suppliers' ? fetchSuppliers(true, current, signal) : fetchOrders(true, current, signal), { key: JSON.stringify([locationId, activeTab, supplierPage, orderPage, debouncedSearch, orderStatusFilter]), paused: loading });

  return (
    <ManagementPage className="">
      <PageHeader
        title={activeTab === 'suppliers' ? 'Suppliers' : 'Purchase Orders'}
        secondaryTabs={activeTab === 'orders' ? <PageTabs secondary label="Order status" value={orderStatusFilter} onChange={setOrderStatusFilter} items={[
          { id: '', label: 'All' }, { id: 'PENDING', label: 'Pending' }, { id: 'ORDERED', label: 'Ordered' },
          { id: 'PARTIALLY_RECEIVED', label: 'Partially received' }, { id: 'RECEIVED', label: 'Closed' }, { id: 'CANCELLED', label: 'Cancelled' },
        ]} /> : undefined}
        actions={<>{canManage && <>
          {activeTab === 'orders' && (
            <Button variant="secondary" onClick={handleAutoGenerate}>
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
            <Table scrollLabel="Suppliers records">
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
                      <div className="flex justify-end gap-2">
                        {canManage && <Button variant="ghost" size="sm" aria-label={`Edit supplier ${supplier.name}`} onClick={() => openEditSupplier(supplier)}>
                          <Edit className="h-4 w-4" />
                        </Button>}
                        {can(role, 'financial.delete') && <Button variant="ghost" size="sm" aria-label={`Delete supplier ${supplier.name}`} onClick={() => setConfirmState({ title: 'Delete supplier?', message: 'This will remove the supplier. Suppliers with purchase orders cannot be deleted.', destructive: true, confirmLabel: 'Delete', action: () => handleDeleteSupplier(supplier.id) })} className="text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>}
                      </div>
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
            <Table scrollLabel="Suppliers records">
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
                      {new Date(order.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openOrderDetail(order)} title="View Details">
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canManage && order.status === 'PENDING' && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => openEditOrder(order)} title="Edit Order">
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleOrderAction(order.id, 'ORDERED')} className="text-info" title="Mark as Ordered">
                              <Truck className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                        {canManage && ['ORDERED', 'PARTIALLY_RECEIVED'].includes(order.status) && (
                          <Button variant="ghost" size="sm" onClick={() => openReceiving(order.id)} className="text-success" title="Receive Delivery">
                            <CheckCircle className="w-4 h-4" />
                          </Button>
                        )}
                        {canManage && (order.status === 'PENDING' || order.status === 'ORDERED') && (
                          <Button variant="ghost" size="sm" onClick={() => confirmOrderAction(order.id)} className="text-destructive" title="Cancel Order">
                            <XCircle className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
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

      {/* Supplier Modal */}
      <Modal
        isOpen={showSupplierModal}
        onClose={() => { setShowSupplierModal(false); resetSupplierForm(); }}
        title={editingSupplier ? 'Edit Supplier' : 'Add Supplier'}
        size="lg"
      >
        <div className="max-h-[70vh] overflow-y-auto pr-2">
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Basic Information</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Input label="Supplier Name" type="text" value={supplierForm.name} onChange={(event) => setSupplierForm({ ...supplierForm, name: event.target.value })} placeholder="Enter supplier name" required />
            </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Contact Name</label>
                  <Input type="text" value={supplierForm.contactName} onChange={(e) => setSupplierForm({ ...supplierForm, contactName: e.target.value })} placeholder="Contact person" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Phone</label>
                  <Input type="tel" value={supplierForm.phone} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })} placeholder="Phone number" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium mb-1">Email</label>
                  <Input type="email" value={supplierForm.email} onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })} placeholder="supplier@example.com" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium mb-1">Address</label>
                  <textarea value={supplierForm.address} onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })} className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm text-foreground" rows={2} placeholder="Full address" />
                </div>
              </div>
            </div>
            <div className="border-t pt-6">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Business Terms</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1"><Clock className="w-3 h-3 inline mr-1" />Lead Time (days)</label>
                  <Input type="number" value={supplierForm.leadTimeDays} onChange={(e) => setSupplierForm({ ...supplierForm, leadTimeDays: e.target.value })} placeholder="e.g., 7" min="0" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1"><DollarSign className="w-3 h-3 inline mr-1" />Min. Order ($)</label>
                  <Input type="number" value={supplierForm.minimumOrder} onChange={(e) => setSupplierForm({ ...supplierForm, minimumOrder: e.target.value })} placeholder="e.g., 100" min="0" step="0.01" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Payment Terms</label>
                  <Select value={supplierForm.paymentTerms} onChange={(e) => setSupplierForm({ ...supplierForm, paymentTerms: e.target.value })} className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm text-foreground">
                    <option value="">Select...</option>
                    <option value="NET15">Net 15</option>
                    <option value="NET30">Net 30</option>
                    <option value="NET60">Net 60</option>
                    <option value="COD">COD</option>
                    <option value="PREPAID">Prepaid</option>
                  </Select>
                </div>
              </div>
            </div>
            <div className="border-t pt-6">
              <label className="block text-sm font-medium mb-1">Notes</label>
              <textarea value={supplierForm.notes} onChange={(e) => setSupplierForm({ ...supplierForm, notes: e.target.value })} className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm text-foreground" rows={3} placeholder="Additional notes..." />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
          <Button variant="outline" onClick={() => { setShowSupplierModal(false); resetSupplierForm(); }}>Cancel</Button>
          <Button variant="primary" onClick={handleCreateSupplier}>{editingSupplier ? 'Update Supplier' : 'Create Supplier'}</Button>
        </div>
      </Modal>

      {/* Order Modal */}
      <Modal
        isOpen={showOrderModal}
        onClose={() => { setShowOrderModal(false); resetOrderForm(); }}
        title={editingOrder ? 'Edit Purchase Order' : 'New Purchase Order'}
        size="lg"
      >
        <div className="max-h-[70vh] overflow-y-auto pr-2">
          <div className="space-y-4">
            <div>
              {editingOrder ? <p className="text-sm">Supplier: {chosenSupplier?.name || selectedOrder?.supplier.name}</p> : <SupplierPicker locationId={locationId || undefined} selected={chosenSupplier} onSelect={supplier => { setChosenSupplier(supplier); setOrderForm(current => ({ ...current, supplierId: supplier.id })); }} />}
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Items <span className="text-destructive">*</span></label>

              {/* Column Headers */}
              <div className="grid grid-cols-12 gap-2 mb-2 text-xs font-medium text-muted-foreground">
                <div className="col-span-5">Product (Barcode / SKU / Name)</div>
                <div className="col-span-2">Qty / cases</div>
                <div className="col-span-2">Cost ($ per unit / case)</div>
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
                        onBlur={() => setTimeout(() => setShowSuggestions(null), 200)}
                        placeholder="Scan barcode or type product name..."
                        className="w-full text-base py-2"
                      />
                      {showSuggestions === index && productSearches[index] && (
                        <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-y-auto">
                          {getFilteredProducts(productSearches[index]).map((product) => (
                            <div key={product.id} className="px-3 py-2 hover:bg-muted cursor-pointer" onMouseDown={() => selectProduct(index, product)}>
                              <p className="font-medium text-sm">{product.name}</p>
                              <p className="text-xs text-muted-foreground">{product.sku} | Stock: {product.stockQuantity} | Cost: {formatCurrency(product.cost)}</p>
                            </div>
                          ))}
                          {getFilteredProducts(productSearches[index]).length === 0 && (
                            <div className="px-3 py-2 hover:bg-muted cursor-pointer text-primary" onMouseDown={() => { setNewProductIndex(index); setNewProductForm({ ...newProductForm, name: productSearches[index], sku: productSearches[index] }); setShowNewProductModal(true); }}>
                              <p className="font-medium text-sm">+ Create new product</p>
                              <p className="text-xs text-muted-foreground">"{productSearches[index]}" not found</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="col-span-2">
                      {item.packSize > 1
                        ? <Input type="number" aria-label={`Cases for item ${index + 1}`} value={item.packQuantity} onChange={(e) => updateOrderItem(index, 'packQuantity', Math.max(1, parseInt(e.target.value) || 1))} min="1" className="w-full" />
                        : <Input type="number" aria-label={`Quantity for item ${index + 1}`} value={item.quantity} onChange={(e) => updateOrderItem(index, 'quantity', parseInt(e.target.value) || 1)} min="1" placeholder="0" className="w-full" />}
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
                        <Button variant="ghost" size="sm" aria-label={`Remove order item ${index + 1}`} onClick={() => removeOrderItem(index)} className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={addOrderItem} className="mt-2"><Plus className="w-4 h-4 mr-1" />Add another item</Button>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Expected Delivery</label>
              <Input type="date" value={orderForm.expectedAt} onChange={(e) => setOrderForm({ ...orderForm, expectedAt: e.target.value })} />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Notes</label>
              <textarea value={orderForm.notes} onChange={(e) => setOrderForm({ ...orderForm, notes: e.target.value })} className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm text-foreground" rows={2} />
            </div>

            <div className="pt-4 border-t">
              <div className="flex justify-between text-lg font-bold">
                <span>Total:</span>
                <span>{formatCurrency(orderForm.items.reduce((sum, item) => sum + lineTotal(item), 0))}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
          <Button variant="outline" onClick={() => { setShowOrderModal(false); resetOrderForm(); }}>Cancel</Button>
          <Button variant="primary" onClick={handleCreateOrder}>{editingOrder ? 'Update Order' : 'Create Order'}</Button>
        </div>
      </Modal>

      {/* New Product Modal */}
      <Modal isOpen={showNewProductModal} onClose={() => setShowNewProductModal(false)} title="Create New Product" size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">SKU <span className="text-destructive">*</span></label>
              <Input type="text" value={newProductForm.sku} onChange={(e) => setNewProductForm({ ...newProductForm, sku: e.target.value })} placeholder="e.g., PROD-001" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Barcode</label>
              <Input type="text" value={newProductForm.barcode} onChange={(e) => setNewProductForm({ ...newProductForm, barcode: e.target.value })} placeholder="Barcode" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Product Name <span className="text-destructive">*</span></label>
            <Input type="text" value={newProductForm.name} onChange={(e) => setNewProductForm({ ...newProductForm, name: e.target.value })} placeholder="Enter product name" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Cost <span className="text-destructive">*</span></label>
              <Input type="number" value={newProductForm.cost} onChange={(e) => setNewProductForm({ ...newProductForm, cost: e.target.value })} placeholder="0.00" min="0" step="0.01" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Price <span className="text-destructive">*</span></label>
              <Input type="number" value={newProductForm.price} onChange={(e) => setNewProductForm({ ...newProductForm, price: e.target.value })} placeholder="0.00" min="0" step="0.01" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Initial Stock</label>
              <Input type="number" value={newProductForm.stockQuantity} onChange={(e) => setNewProductForm({ ...newProductForm, stockQuantity: e.target.value })} min="0" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Low Stock Alert</label>
              <Input type="number" value={newProductForm.lowStockAlert} onChange={(e) => setNewProductForm({ ...newProductForm, lowStockAlert: e.target.value })} min="0" />
            </div>
          </div>
          <div className="bg-muted/50 rounded-md p-3 text-sm">
            <AlertTriangle className="w-4 h-4 inline mr-2 text-warning" />
            This product will be added to inventory and this order.
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setShowNewProductModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleCreateNewProduct}>Create Product</Button>
          </div>
        </div>
      </Modal>

      {/* Order Detail Modal */}
      <Modal isOpen={showOrderDetailModal} onClose={() => { setShowOrderDetailModal(false); setSelectedOrder(null); }} title={`Order ${selectedOrder?.orderNumber || ''}`} size="lg">
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
                <p className="font-medium">{new Date(selectedOrder.createdAt).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Expected Delivery</p>
                <p className="font-medium">{selectedOrder.expectedAt ? new Date(selectedOrder.expectedAt).toLocaleDateString() : 'Not set'}</p>
              </div>
              {selectedOrder.orderedAt && (
                <div>
                  <p className="text-sm text-muted-foreground">Ordered</p>
                  <p className="font-medium">{new Date(selectedOrder.orderedAt).toLocaleDateString()}</p>
                </div>
              )}
              {selectedOrder.receivedAt && (
                <div>
                  <p className="text-sm text-muted-foreground">Received</p>
                  <p className="font-medium">{new Date(selectedOrder.receivedAt).toLocaleDateString()}</p>
                </div>
              )}
            </div>
            {selectedOrder.notes && (
              <div>
                <p className="text-sm text-muted-foreground">Notes</p>
                <p className="text-sm">{selectedOrder.notes}</p>
              </div>
            )}
            <div className="border-t pt-4">
              <h4 className="font-medium mb-2">Items</h4>
              <Table scrollLabel="Suppliers records">
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
                <p className="font-medium">{new Date(receipt.createdAt).toLocaleString()} {receipt.finalDelivery ? '· Final delivery' : '· Partial delivery'}</p>
                {receipt.items.map(line => <p key={line.purchaseOrderItemId}>{selectedOrder.items?.find(item => item.id === line.purchaseOrderItemId)?.productName}: {line.acceptedQty} accepted, {line.damagedQty} damaged, {line.rejectedQty} rejected</p>)}
                {receipt.notes && <p className="text-muted-foreground">{receipt.notes}</p>}
              </div>)}
            </div>
            <div className="flex flex-wrap justify-between items-center gap-3 pt-4 border-t">
              <div className="text-lg font-bold">Total: {formatCurrency(selectedOrder.totalAmount)}</div>
              <div className="flex gap-2">
                {canManage && selectedOrder.status === 'PENDING' && (
                  <>
                    <Button variant="outline" onClick={() => { setShowOrderDetailModal(false); openEditOrder(selectedOrder); }}><Edit className="w-4 h-4 mr-2" />Edit</Button>
                    <Button variant="primary" onClick={() => handleOrderAction(selectedOrder.id, 'ORDERED')}><Truck className="w-4 h-4 mr-2" />Mark as Ordered</Button>
                  </>
                )}
                {canManage && ['ORDERED', 'PARTIALLY_RECEIVED'].includes(selectedOrder.status) && (
                  <Button variant="primary" onClick={() => openReceiving(selectedOrder.id)}><CheckCircle className="w-4 h-4 mr-2" />Receive Delivery</Button>
                )}
                {canManage && (selectedOrder.status === 'PENDING' || selectedOrder.status === 'ORDERED') && (
                  <Button variant="destructive" onClick={() => confirmOrderAction(selectedOrder.id)}><XCircle className="w-4 h-4 mr-2" />Cancel</Button>
                )}
              </div>
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
