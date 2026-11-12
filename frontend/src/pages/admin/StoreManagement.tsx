import { ManagementPage, SummaryStrip } from '@/components/common/Workspace';
import { Select } from '@/components/ui/Select';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { AutoRefreshStatus } from '@/components/common/AutoRefreshStatus';
import { useNavigate } from 'react-router-dom';
import { useAdminViewStore } from '@/store/adminViewStore';
import { StoreConnections } from '@/components/StoreConnections';
import { StoreBusiness } from '@/components/admin/StoreBusiness';
import { LotteryConfiguration } from '@/components/lottery/LotteryConfiguration';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useFocusTrap, isTopFocusTrap } from '@/hooks/useFocusTrap';
import { locationService, apiErrorMessage } from '@/services/api';
import { formatCurrency, CHART_COLORS, formatDateTime } from '@/lib/utils';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { FormSection } from '@/components/common/Workspace';
import { Badge } from '@/components/ui/Badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import {
  Plus,
  Edit,
  Trash2,
  Store,
  DollarSign,
  TrendingUp,
  ShoppingCart,
  Package,
  Eye,
  Link2,
  X,
  Building2,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import toast from 'react-hot-toast';
import { Spinner } from '@/components/ui/LoadingState';
import { useConfirm } from '@/components/ui/useConfirm';

interface Location {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  phone: string;
  email: string;
  taxRate: number;
  currency: string;
  timezone: string;
  isActive: boolean;
  /** The business the store belongs to; its owners run all of its stores. */
  organization?: { id: string; name: string } | null;
  _count: {
    users: number;
    products: number;
    sales: number;
  };
  totalRevenue: number;
  todayRevenue: number;
}

interface StoreDetails {
  location: any;
  stats: any;
}

const COLORS = CHART_COLORS;
const STORE_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern' },
  { value: 'America/Chicago', label: 'Central' },
  { value: 'America/Denver', label: 'Mountain' },
  { value: 'America/Phoenix', label: 'Mountain (Arizona, no daylight saving)' },
  { value: 'America/Los_Angeles', label: 'Pacific' },
  { value: 'America/Anchorage', label: 'Alaska' },
  { value: 'Pacific/Honolulu', label: 'Hawaii' },
  { value: 'America/Puerto_Rico', label: 'Atlantic (Puerto Rico)' },
];

export const StoreManagement: React.FC = () => {
  const [confirm, confirmDialog] = useConfirm();
  const navigate = useNavigate();
  const enterAdminView = useAdminViewStore(state => state.enterAdminView);
  const [showModal, setShowModal] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [connectionStore, setConnectionStore] = useState<Location | null>(null);
  const [lotteryStore, setLotteryStore] = useState<Location | null>(null);
  const [businessStore, setBusinessStore] = useState<Location | null>(null);

  // Store detail modal state
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedStore, setSelectedStore] = useState<Location | null>(null);
  const [storeDetails, setStoreDetails] = useState<StoreDetails | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [detailPeriod, setDetailPeriod] = useState(30);
  const [detailError, setDetailError] = useState('');
  const detailVersion = useRef(0);
  const detailRef = useFocusTrap(showDetailModal);
  const closeDetails = useCallback(() => {
    detailVersion.current++; setShowDetailModal(false); setStoreDetails(null); setDetailError('');
  }, []);
  useEffect(() => {
    if (!showDetailModal) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && isTopFocusTrap(detailRef.current)) { event.preventDefault(); closeDetails(); } };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [showDetailModal, closeDetails]);
  useEffect(() => () => { detailVersion.current++; }, []);

  const [formData, setFormData] = useState({
    name: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'US',
    phone: '',
    email: '',
    taxRate: '0',
    cardSurchargePercent: '0',
    currency: 'USD',
    timezone: 'America/New_York',
  });


  const query = useScopedQuery<Location[]>(['admin-stores'], async signal => (await locationService.getAllWithStats(signal)).data.data);
  const locations = query.data || [], isLoading = query.loading, loadLocations = query.refresh;
  const loadError = query.stale ? '' : query.error;

  const loadStoreDetails = async (store: Location, period: number = detailPeriod) => {
    const version = ++detailVersion.current;
    setIsLoadingDetails(true); setStoreDetails(null); setDetailError('');
    try {
      const [locationResponse, statsResponse] = await Promise.all([
        locationService.getById(store.id),
        locationService.getStats(store.id, period),
      ]);
      if (version !== detailVersion.current) return;
      setStoreDetails({
        location: locationResponse.data.data,
        stats: statsResponse.data.data,
      });
    } catch (error) {
      if (version === detailVersion.current) setDetailError('Unable to load this store and period. Retry when connected.');
    } finally {
      if (version === detailVersion.current) setIsLoadingDetails(false);
    }
  };

  const handleViewDetails = (store: Location) => {
    setSelectedStore(store);
    setShowDetailModal(true);
    loadStoreDetails(store);
  };

  const handleDetailPeriodChange = (period: number) => {
    setDetailPeriod(period);
    if (selectedStore) {
      loadStoreDetails(selectedStore, period);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const data = {
        ...formData,
        taxRate: parseFloat(formData.taxRate),
        cardSurchargePercent: parseFloat(formData.cardSurchargePercent) || 0,
      };

      if (editingLocation) {
        await locationService.update(editingLocation.id, data);
        toast.success('Store updated successfully');
      } else {
        await locationService.create(data);
        toast.success('Store created successfully');
      }

      setShowModal(false);
      resetForm();
      loadLocations();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to save store');
    }
  };

  const handleEdit = (location: Location) => {
    setEditingLocation(location);
    setFormData({
      name: location.name,
      address: location.address,
      city: location.city,
      state: location.state,
      zipCode: location.zipCode,
      country: location.country,
      phone: location.phone,
      email: location.email,
      taxRate: location.taxRate.toString(),
      cardSurchargePercent: ((location as any).cardSurchargePercent ?? 0).toString(),
      currency: location.currency,
      timezone: location.timezone,
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!await confirm({ title: 'Deactivate this store?', message: 'Its sales history stays available, but no new sales or changes can be made there. Staff must be moved or deactivated first.', confirmLabel: 'Deactivate', destructive: true })) return;

    try {
      await locationService.delete(id);
      toast.success('Store deactivated');
      loadLocations();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to deactivate store');
    }
  };

  const handleReactivate = async (location: Location) => {
    if (!await confirm({ title: 'Reactivate this store?', message: 'Staff assigned to it can sign in and sell there again.', confirmLabel: 'Reactivate' })) return;
    try {
      await locationService.update(location.id, { isActive: true });
      toast.success('Store reactivated');
      loadLocations();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to reactivate store'));
    }
  };

  const resetForm = () => {
    setEditingLocation(null);
    setFormData({
      name: '',
      address: '',
      city: '',
      state: '',
      zipCode: '',
      country: 'US',
      phone: '',
      email: '',
      taxRate: '0',
      cardSurchargePercent: '0',
      currency: 'USD',
      timezone: 'America/New_York',
    });
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };


  return (
    <>
      {confirmDialog}
    <ManagementPage className="space-y-6">
      <PageHeader
        title="Store Management"
        subtitle="Manage all store locations"
        actions={
          <Button onClick={openCreateModal}>
            <Plus className="h-4 w-4 mr-2" />
            Add Store
          </Button>
        }
      />
      <AutoRefreshStatus state={query} />

      {connectionStore && <StoreConnections key={connectionStore.id} stores={locations} store={connectionStore} onClose={() => setConnectionStore(null)} />}
      {lotteryStore && <LotteryConfiguration key={lotteryStore.id} store={lotteryStore} onClose={() => setLotteryStore(null)} />}
      {businessStore && <StoreBusiness key={businessStore.id} store={businessStore} onClose={() => setBusinessStore(null)} onChanged={loadLocations} />}

      {/* Summary */}
      <SummaryStrip items={[
        { label: 'Total stores', value: locations.length },
        { label: 'Active stores', value: locations.filter(l => l.isActive).length },
        { label: 'Total users', value: locations.reduce((sum, l) => sum + l._count.users, 0) },
      ]} />

      {/* Stores Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Stores</CardTitle>
        </CardHeader>
        {isLoading ? (
          <div className="p-8 text-center">
            <Spinner size="lg" className="mx-auto" />
          </div>
        ) : loadError ? (<div role="alert" className="p-4 space-y-3"><p>Stores could not be loaded.</p><Button variant="outline" onClick={loadLocations}>Retry</Button></div>) : locations.length === 0 ? (
          <div className="p-12 text-center">
            <Store className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No stores yet</h3>
            <p className="text-muted-foreground mb-4">Create your first store to get started</p>
            <Button onClick={openCreateModal}>
              <Plus className="h-4 w-4 mr-2" />
              Add Store
            </Button>
          </div>
        ) : (
          <Table scrollLabel="Store Management records">
            <TableHeader>
              <TableRow>
                <TableHead>Store Name</TableHead>
                <TableHead>Business</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="text-right">Users</TableHead>
                <TableHead className="text-right">Sales After Refunds</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations.map((location) => (
                <TableRow
                  key={location.id}
                  className="cursor-pointer hover:bg-accent/50"
                  onClick={() => handleViewDetails(location)}
                >
                  <TableCell>
                    <p className="font-medium">{location.name}</p>
                    <p className="text-sm text-muted-foreground">
                      Tax Rate: {location.taxRate}%
                    </p>
                  </TableCell>
                  <TableCell>
                    <p className="break-words">{location.organization?.name || '—'}</p>
                  </TableCell>
                  <TableCell>
                    <p>{location.address}</p>
                    <p className="text-sm text-muted-foreground">
                      {location.city}, {location.state} {location.zipCode}
                    </p>
                  </TableCell>
                  <TableCell>
                    <p>{location.phone}</p>
                    <p className="text-sm text-muted-foreground">{location.email}</p>
                  </TableCell>
                  <TableCell className="text-right">{location._count.users}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <p className="font-medium">{formatCurrency(location.totalRevenue)}</p>
                    <p className="text-sm text-muted-foreground">
                      Today: {formatCurrency(location.todayRevenue ?? 0)}
                    </p>
                  </TableCell>
                  <TableCell>
                    {location.isActive ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button variant="outline" aria-label={`Configure lottery for ${location.name}`} onClick={(e) => { e.stopPropagation(); setLotteryStore(location); }}>Lottery</Button>
                      <Button variant="outline" size="sm" aria-label={`Business and owners for ${location.name}`} onClick={(e) => { e.stopPropagation(); setBusinessStore(location); }}>
                        <Building2 className="h-4 w-4 mr-2" />Business
                      </Button>
                      <Button variant="outline" size="sm" aria-label={`Manage connections for ${location.name}`} onClick={(e) => { e.stopPropagation(); setConnectionStore(location); }}>
                        <Link2 className="h-4 w-4 mr-2" />Connections
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`View details for ${location.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewDetails(location);
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Edit store ${location.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(location);
                        }}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      {!location.isActive && (
                        <Button variant="outline" size="sm" aria-label={`Reactivate store ${location.name}`}
                          onClick={(e) => { e.stopPropagation(); void handleReactivate(location); }}>Reactivate</Button>
                      )}
                      {location.isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Deactivate store ${location.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(location.id);
                          }}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
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

      {/* Create/Edit Store Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          resetForm();
        }}
        title={editingLocation ? 'Edit Store' : 'Create New Store'}
        size="lg"
        footer={<div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => { setShowModal(false); resetForm(); }}>Cancel</Button>
          <Button type="submit" form="store-form" variant="primary">{editingLocation ? 'Update Store' : 'Create Store'}</Button>
        </div>}
      >
        <form id="store-form" onSubmit={handleSubmit} className="space-y-4">
          <FormSection title="Store">
            <Input
              label="Store Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              autoFocus
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                required
              />
              <Input
                label="Email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
              />
            </div>
          </FormSection>

          <FormSection title="Address">
            <Input
              label="Street address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              required
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
              <Input
                label="City"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                required
              />
              <Input
                label="State"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                required
              />
              <Input
                label="ZIP Code"
                value={formData.zipCode}
                onChange={(e) => setFormData({ ...formData, zipCode: e.target.value })}
                required
              />
            </div>
          </FormSection>

          <FormSection title="Tax, money & time" description="Sales tax, card fees, and the time zone that decides when the store's business day starts.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Tax Rate (%)"
                type="number"
                step="0.001"
                value={formData.taxRate}
                onChange={(e) => setFormData({ ...formData, taxRate: e.target.value })}
              />
              <Input
                label="Card Surcharge (%)"
                description="Added to card payments for a cash-discount program. 0 = off."
                type="number"
                step="0.1"
                min="0"
                max="10"
                value={formData.cardSurchargePercent}
                onChange={(e) => setFormData({ ...formData, cardSurchargePercent: e.target.value })}
              />
              <Select
                label="Timezone"
                value={formData.timezone}
                onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
              >
                {!STORE_TIMEZONES.some(zone => zone.value === formData.timezone) && formData.timezone && <option value={formData.timezone}>{formData.timezone}</option>}
                {STORE_TIMEZONES.map(zone => <option key={zone.value} value={zone.value}>{zone.label}</option>)}
              </Select>
              <Input
                label="Currency"
                value={formData.currency}
                onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
              />
            </div>
          </FormSection>
        </form>
      </Modal>

      {/* Store Detail Modal */}
      {showDetailModal && selectedStore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={closeDetails}
          />
          <div ref={detailRef} role="dialog" aria-modal="true" aria-label="Store Details" className="relative bg-background rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] overflow-y-auto m-4">
            {/* Header */}
            <div className="sticky top-0 bg-background border-b p-4 flex flex-wrap gap-3 justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold">{selectedStore.name}</h2>
                <p className="text-muted-foreground">
                  {selectedStore.city}, {selectedStore.state}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 max-w-full">
                <Button variant="outline" onClick={() => { enterAdminView(selectedStore.id, selectedStore.name); closeDetails(); navigate('/dashboard'); }}>Preview store</Button>
                {[7, 30, 90].map((p) => (
                  <Button
                    key={p}
                    variant={detailPeriod === p ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => handleDetailPeriodChange(p)}
                  >
                    {p}d
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={closeDetails}
                  aria-label="Close store details"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>

            {isLoadingDetails ? (
              <div className="p-12 text-center">
                <Spinner size="lg" className="mx-auto" />
                <p className="mt-4 text-muted-foreground">Loading store details...</p>
              </div>
            ) : detailError ? <div role="alert" className="p-6 space-y-3"><p>{detailError}</p><Button onClick={() => void loadStoreDetails(selectedStore)}>Retry store details</Button></div> : storeDetails ? (
              <div className="p-6 space-y-6">
                {/* Key Metrics */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <DollarSign className="h-8 w-8 text-success" />
                        <div>
                          <p className="text-sm text-muted-foreground">Revenue</p>
                          <p className="metric-value text-2xl font-semibold">
                            {formatCurrency(storeDetails.stats?.periodRevenue ?? 0)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <TrendingUp className="h-8 w-8 text-success" />
                        <div>
                          <p className="text-sm text-muted-foreground">Profit</p>
                          <p className="metric-value text-2xl font-semibold">
                            {typeof storeDetails.stats?.periodProfit === 'number' ? formatCurrency(storeDetails.stats.periodProfit) : 'Unavailable'}
                          </p>
                          {storeDetails.stats?.profitUnavailableReason && <p className="text-xs text-muted-foreground">{storeDetails.stats.profitUnavailableReason}</p>}
                          {storeDetails.stats?.profitProvisionalReason && <p className="text-xs text-muted-foreground">Not final. {storeDetails.stats.profitProvisionalReason}</p>}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <ShoppingCart className="h-8 w-8 text-info" />
                        <div>
                          <p className="text-sm text-muted-foreground">Transactions</p>
                          <p className="metric-value text-2xl font-semibold">
                            {storeDetails.stats?.periodTransactions ?? '—'}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <Package className="h-8 w-8 text-primary" />
                        <div>
                          <p className="text-sm text-muted-foreground">Products</p>
                          <p className="metric-value text-2xl font-semibold">
                            {storeDetails.location?._count?.products || 0}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Additional Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-muted-foreground">Expenses</p>
                      <p className="text-xl font-bold text-destructive">
                        {formatCurrency(storeDetails.stats?.periodExpenses ?? 0)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-muted-foreground">Sales After Refunds (All Time)</p>
                      <p className="text-xl font-bold">
                        {formatCurrency(storeDetails.stats?.totalRevenue ?? 0)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-muted-foreground">Average Sale</p>
                      <p className="text-xl font-bold">
                        {typeof storeDetails.stats?.averageOrderValue === 'number' ? formatCurrency(storeDetails.stats.averageOrderValue) : '—'}
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Charts Row */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Top Products */}
                  {storeDetails.stats?.topProducts && storeDetails.stats.topProducts.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Top Products</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={storeDetails.stats.topProducts.slice(0, 5)}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="name" fontSize={10} />
                              <YAxis fontSize={12} />
                              <Tooltip formatter={(value: number) => formatCurrency(value)} />
                              <Bar dataKey="revenue" fill="hsl(var(--primary))" name="Sales" />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* User Performance */}
                  {storeDetails.stats?.userPerformance && storeDetails.stats.userPerformance.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Sales by Employee</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={storeDetails.stats.userPerformance}
                                dataKey="total"
                                nameKey="userName"
                                cx="50%"
                                cy="50%"
                                outerRadius={80}
                                label={({ userName, percent }) =>
                                  `${userName} (${(percent * 100).toFixed(0)}%)`
                                }
                                labelLine={false}
                              >
                                {storeDetails.stats.userPerformance.map((_: any, index: number) => (
                                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip formatter={(value: number) => formatCurrency(value)} />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* Users Table */}
                {storeDetails.location?.users && storeDetails.location.users.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Store Users ({storeDetails.location.users.length})</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Table scrollLabel="Store Management records">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {storeDetails.location.users.map((user: any) => (
                            <TableRow key={user.id}>
                              <TableCell className="font-medium">
                                {user.firstName} {user.lastName}
                              </TableCell>
                              <TableCell>{user.email}</TableCell>
                              <TableCell>
                                <Badge variant="secondary">{user.role}</Badge>
                              </TableCell>
                              <TableCell>
                                {user.isActive ? (
                                  <Badge variant="success">Active</Badge>
                                ) : (
                                  <Badge variant="secondary">Inactive</Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}

                {/* Recent Sales */}
                {storeDetails.location?.recentSales && storeDetails.location.recentSales.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Recent Sales</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Table scrollLabel="Store Management records">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Sale #</TableHead>
                            <TableHead>Customer</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {storeDetails.location.recentSales.map((sale: any) => (
                            <TableRow key={sale.id}>
                              <TableCell className="font-medium">{sale.saleNumber}</TableCell>
                              <TableCell>
                                {sale.customer
                                  ? `${sale.customer.firstName} ${sale.customer.lastName}`
                                  : 'Walk-in'}
                              </TableCell>
                              <TableCell>
                                {formatDateTime(sale.createdAt)}
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {formatCurrency(sale.total)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}

                {/* Store Info */}
                <Card>
                  <CardHeader>
                    <CardTitle>Store Information</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">Address</p>
                        <p className="font-medium">{selectedStore.address}</p>
                        <p>{selectedStore.city}, {selectedStore.state} {selectedStore.zipCode}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Contact</p>
                        <p className="font-medium">{selectedStore.phone}</p>
                        <p>{selectedStore.email}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Tax Rate</p>
                        <p className="font-medium">{selectedStore.taxRate}%</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Timezone</p>
                        <p className="font-medium">{selectedStore.timezone}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="p-12 text-center">
                <p className="text-muted-foreground">No data available</p>
              </div>
            )}
          </div>
        </div>
      )}
    </ManagementPage>
    </>
  );
};
