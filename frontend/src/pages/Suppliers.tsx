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
import { Badge } from '@/components/ui/Badge';
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

interface PurchaseOrder {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number;
  notes?: string;
  expectedAt?: string;
  orderedAt?: string;
  receivedAt?: string;
  createdAt: string;
  supplier: {
    id: string;
    name: string;
  };
  items?: Array<{
    id: string;
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    cost: number;
    total: number;
  }>;
  _count?: {
    items: number;
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

export const Suppliers: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'suppliers' | 'orders'>('suppliers');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

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
    items: [{ productId: '', quantity: 1, cost: 0, productName: '' }],
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

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [suppliersRes, ordersRes, productsRes] = await Promise.all([
        supplierService.getAll({ limit: 100 }),
        purchaseOrderService.getAll({ limit: 100 }),
        productService.getAll({ limit: 500 }),
      ]);
      setSuppliers(suppliersRes.data.data);
      setOrders(ordersRes.data.data);
      setProducts(productsRes.data.data);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSupplier = async () => {
    try {
      const supplierData = {
        ...supplierForm,
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

  const handleDeleteSupplier = async (id: string) => {
    if (!confirm('Are you sure you want to delete this supplier?')) return;
    try {
      await supplierService.delete(id);
      fetchData();
      toast.success('Supplier deleted');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to delete supplier');
    }
  };

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
          quantity: item.quantity,
          cost: item.cost,
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

  const handleOrderAction = async (orderId: string, action: string) => {
    try {
      if (action === 'receive') {
        await purchaseOrderService.receive(orderId);
      } else if (action === 'cancel') {
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
      toast.success(`Created ${response.data.data.ordersCreated} purchase order(s)`);
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

      setProducts([...products, newProduct]);

      const newItems = [...orderForm.items];
      newItems[newProductIndex] = {
        productId: newProduct.id,
        quantity: newItems[newProductIndex].quantity,
        cost: newProduct.cost,
        productName: newProduct.name,
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

    const exactMatch = products.find(
      p => p.barcode === value || p.sku.toLowerCase() === value.toLowerCase()
    );
    if (exactMatch) {
      selectProduct(index, exactMatch);
    }
  };

  const selectProduct = (index: number, product: Product) => {
    const newItems = [...orderForm.items];
    newItems[index] = {
      productId: product.id,
      quantity: newItems[index].quantity,
      cost: product.cost,
      productName: product.name,
    };
    setOrderForm({ ...orderForm, items: newItems });

    const newSearches = [...productSearches];
    newSearches[index] = product.name;
    setProductSearches(newSearches);
    setShowSuggestions(null);
  };

  const getFilteredProducts = (searchTerm: string) => {
    if (!searchTerm) return [];
    const lower = searchTerm.toLowerCase();
    return products.filter(
      p =>
        p.name.toLowerCase().includes(lower) ||
        p.sku.toLowerCase().includes(lower) ||
        (p.barcode && p.barcode.includes(searchTerm))
    ).slice(0, 10);
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
    setOrderForm({
      supplierId: '',
      items: [{ productId: '', quantity: 1, cost: 0, productName: '' }],
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

      setOrderForm({
        supplierId: orderData.supplier.id,
        items: orderData.items.map((item: any) => ({
          productId: item.productId,
          quantity: item.quantity,
          cost: item.cost,
          productName: item.productName,
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
      items: [...orderForm.items, { productId: '', quantity: 1, cost: 0, productName: '' }],
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
      case 'RECEIVED':
        return <Badge variant="success">Received</Badge>;
      case 'CANCELLED':
        return <Badge variant="destructive">Cancelled</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const filteredSuppliers = suppliers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.email?.toLowerCase().includes(search.toLowerCase())
  );

  const filteredOrders = orders.filter(o =>
    o.orderNumber.toLowerCase().includes(search.toLowerCase()) ||
    o.supplier.name.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Supplier Management</h1>
          <p className="text-muted-foreground">
            Manage suppliers and create purchase orders
          </p>
        </div>
      </div>

      <div className="flex gap-4 mb-6">
        <Button
          variant={activeTab === 'suppliers' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('suppliers')}
        >
          <Truck className="w-4 h-4 mr-2" />
          Suppliers ({suppliers.length})
        </Button>
        <Button
          variant={activeTab === 'orders' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('orders')}
        >
          <FileText className="w-4 h-4 mr-2" />
          Purchase Orders ({orders.length})
        </Button>
      </div>

      <div className="flex justify-between items-center mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            type="text"
            placeholder={activeTab === 'suppliers' ? 'Search suppliers...' : 'Search orders...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2">
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
          </Button>
        </div>
      </div>

      {activeTab === 'suppliers' && (
        <Card>
          {filteredSuppliers.length === 0 ? (
            <div className="p-12 text-center">
              <Truck className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No suppliers found</h3>
              <p className="text-muted-foreground mb-4">
                {search ? 'Try adjusting your search' : 'Get started by adding your first supplier'}
              </p>
            </div>
          ) : (
            <Table>
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
                        <Button variant="ghost" size="sm" onClick={() => openEditSupplier(supplier)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDeleteSupplier(supplier.id)} className="text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
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
        <Card>
          {filteredOrders.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No purchase orders found</h3>
              <p className="text-muted-foreground mb-4">
                {search ? 'Try adjusting your search' : 'Create a new purchase order to get started'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Total</TableHead>
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
                    <TableCell>{order._count?.items || 0} items</TableCell>
                    <TableCell className="font-medium">${order.totalAmount.toFixed(2)}</TableCell>
                    <TableCell>{getStatusBadge(order.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(order.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openOrderDetail(order)} title="View Details">
                          <Eye className="w-4 h-4" />
                        </Button>
                        {order.status === 'PENDING' && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => openEditOrder(order)} title="Edit Order">
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleOrderAction(order.id, 'ORDERED')} className="text-blue-500" title="Mark as Ordered">
                              <Truck className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                        {order.status === 'ORDERED' && (
                          <Button variant="ghost" size="sm" onClick={() => handleOrderAction(order.id, 'receive')} className="text-green-500" title="Receive Order">
                            <CheckCircle className="w-4 h-4" />
                          </Button>
                        )}
                        {(order.status === 'PENDING' || order.status === 'ORDERED') && (
                          <Button variant="ghost" size="sm" onClick={() => handleOrderAction(order.id, 'cancel')} className="text-destructive" title="Cancel Order">
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
                  <label className="block text-sm font-medium mb-1">Supplier Name <span className="text-destructive">*</span></label>
                  <Input type="text" value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} placeholder="Enter supplier name" required />
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
                  <select value={supplierForm.paymentTerms} onChange={(e) => setSupplierForm({ ...supplierForm, paymentTerms: e.target.value })} className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm text-foreground">
                    <option value="">Select...</option>
                    <option value="NET15">Net 15</option>
                    <option value="NET30">Net 30</option>
                    <option value="NET60">Net 60</option>
                    <option value="COD">COD</option>
                    <option value="PREPAID">Prepaid</option>
                  </select>
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
              <label className="block text-sm font-medium mb-1">Supplier <span className="text-destructive">*</span></label>
              <select value={orderForm.supplierId} onChange={(e) => setOrderForm({ ...orderForm, supplierId: e.target.value })} className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground" required disabled={editingOrder}>
                <option value="">Select supplier...</option>
                {suppliers.filter(s => s.isActive).map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>{supplier.name}{supplier.minimumOrder ? ` (Min: $${supplier.minimumOrder})` : ''}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Items <span className="text-destructive">*</span></label>

              {/* Column Headers */}
              <div className="grid grid-cols-12 gap-2 mb-2 text-xs font-medium text-muted-foreground">
                <div className="col-span-6">Product (Barcode / SKU / Name)</div>
                <div className="col-span-2">Quantity</div>
                <div className="col-span-3">Unit Cost ($)</div>
                <div className="col-span-1"></div>
              </div>

              <div className="space-y-3">
                {orderForm.items.map((item, index) => (
                  <div key={index} className="grid grid-cols-12 gap-2 items-start">
                    <div className="col-span-6 relative">
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
                              <p className="text-xs text-muted-foreground">{product.sku} | Stock: {product.stockQuantity} | Cost: ${product.cost.toFixed(2)}</p>
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
                      <Input type="number" value={item.quantity} onChange={(e) => updateOrderItem(index, 'quantity', parseInt(e.target.value) || 1)} min="1" placeholder="0" className="w-full" />
                    </div>
                    <div className="col-span-3">
                      <Input type="number" value={item.cost} onChange={(e) => updateOrderItem(index, 'cost', parseFloat(e.target.value) || 0)} min="0" step="0.01" placeholder="0.00" className="w-full" />
                    </div>
                    <div className="col-span-1 flex justify-center">
                      {orderForm.items.length > 1 && (
                        <Button variant="ghost" size="sm" onClick={() => removeOrderItem(index)} className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
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
                <span>${orderForm.items.reduce((sum, item) => sum + (item.cost * item.quantity), 0).toFixed(2)}</span>
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Cost</TableHead>
                    <TableHead>Total</TableHead>
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
                      <TableCell>${item.cost.toFixed(2)}</TableCell>
                      <TableCell className="font-medium">${(item.quantity * item.cost).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-between items-center pt-4 border-t">
              <div className="text-lg font-bold">Total: ${selectedOrder.totalAmount.toFixed(2)}</div>
              <div className="flex gap-2">
                {selectedOrder.status === 'PENDING' && (
                  <>
                    <Button variant="outline" onClick={() => { setShowOrderDetailModal(false); openEditOrder(selectedOrder); }}><Edit className="w-4 h-4 mr-2" />Edit</Button>
                    <Button variant="primary" onClick={() => handleOrderAction(selectedOrder.id, 'ORDERED')}><Truck className="w-4 h-4 mr-2" />Mark as Ordered</Button>
                  </>
                )}
                {selectedOrder.status === 'ORDERED' && (
                  <Button variant="primary" onClick={() => handleOrderAction(selectedOrder.id, 'receive')}><CheckCircle className="w-4 h-4 mr-2" />Mark as Received</Button>
                )}
                {(selectedOrder.status === 'PENDING' || selectedOrder.status === 'ORDERED') && (
                  <Button variant="destructive" onClick={() => handleOrderAction(selectedOrder.id, 'cancel')}><XCircle className="w-4 h-4 mr-2" />Cancel</Button>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Suppliers;
