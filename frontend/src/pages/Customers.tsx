import React, { useState, useEffect, useRef } from 'react';
import { customerService, analyticsService } from '@/services/api';
import { Customer } from '@/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { EmptyState } from '@/components/common/EmptyState';
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
import { Plus, Search, Edit, Trash2, Users as UsersIcon, Star, BarChart3, PieChart, Eye, Megaphone } from 'lucide-react';
import { PieChart as RechartsPieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { useAuthStore } from '@/store/authStore';

export const Customers: React.FC = () => {
  const { user } = useAuthStore();
  const canDelete = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const [activeTab, setActiveTab] = useState<'directory' | 'insights' | 'segments'>('directory');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  // Customer detail modal
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [customerHistory, setCustomerHistory] = useState<any[]>([]);

  // Customer insights data
  const [customerData, setCustomerData] = useState<any>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

  // Debounce search
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    emailMarketing: false,
    smsMarketing: false,
    tags: [] as string[],
    birthDate: '',
  });
  const [tagInput, setTagInput] = useState('');

  // ─── Email campaign (admin) ───
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [campaignSegment, setCampaignSegment] = useState('all');
  const [campaignTag, setCampaignTag] = useState('');
  const [campaignSubject, setCampaignSubject] = useState('');
  const [campaignMessage, setCampaignMessage] = useState('');
  const [campaignReach, setCampaignReach] = useState<number | null>(null);
  const [campaignSending, setCampaignSending] = useState(false);

  const effectiveSegment = campaignSegment === 'tag' ? `tag:${campaignTag.trim().toLowerCase()}` : campaignSegment;

  // Live reach preview as the segment changes
  useEffect(() => {
    if (!showCampaignModal) return;
    if (campaignSegment === 'tag' && !campaignTag.trim()) { setCampaignReach(null); return; }
    let cancelled = false;
    customerService.previewCampaign(effectiveSegment)
      .then((res) => { if (!cancelled) setCampaignReach(res.data.data.matched); })
      .catch(() => { if (!cancelled) setCampaignReach(null); });
    return () => { cancelled = true; };
  }, [showCampaignModal, effectiveSegment]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSendCampaign = async () => {
    if (!campaignSubject.trim() || !campaignMessage.trim()) {
      toast.error('Subject and message are required');
      return;
    }
    setCampaignSending(true);
    try {
      const res = await customerService.sendCampaign({
        segment: effectiveSegment,
        subject: campaignSubject.trim(),
        message: campaignMessage.trim(),
      });
      toast.success(res.data.message);
      setShowCampaignModal(false);
      setCampaignSubject('');
      setCampaignMessage('');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to send campaign');
    } finally {
      setCampaignSending(false);
    }
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (!tag) return;
    if (formData.tags.includes(tag)) { setTagInput(''); return; }
    if (formData.tags.length >= 20) { toast.error('Maximum 20 tags'); return; }
    setFormData((f) => ({ ...f, tags: [...f.tags, tag] }));
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setFormData((f) => ({ ...f, tags: f.tags.filter((t) => t !== tag) }));
  };

  useEffect(() => {
    if (activeTab === 'directory') {
      loadCustomers();
    } else if (activeTab === 'insights' || activeTab === 'segments') {
      loadCustomerInsights();
    }
  }, [debouncedSearch, page, activeTab]);

  const loadCustomers = async () => {
    setIsLoading(true);
    try {
      const response = await customerService.getAll({
        search: debouncedSearch,
        page,
        limit: 20,
      });
      setCustomers(response.data.data);
      setTotalPages(response.data.pagination?.totalPages || 1);
      setTotal(response.data.pagination?.total || 0);
    } catch (error) {
      console.error('Failed to load customers:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadCustomerInsights = async () => {
    setInsightsLoading(true);
    try {
      const response = await analyticsService.getCustomerInsights();
      setCustomerData(response.data.data);
    } catch (error) {
      console.error('Failed to load customer insights:', error);
    } finally {
      setInsightsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      if (editingCustomer) {
        await customerService.update(editingCustomer.id, formData);
      } else {
        await customerService.create(formData);
      }

      setShowModal(false);
      resetForm();
      loadCustomers();
      toast.success(editingCustomer ? 'Customer updated' : 'Customer created');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to save customer');
    }
  };

  const handleEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    setFormData({
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email || '',
      phone: customer.phone || '',
      address: customer.address || '',
      city: customer.city || '',
      state: customer.state || '',
      zipCode: customer.zipCode || '',
      emailMarketing: customer.emailMarketing ?? false,
      smsMarketing: customer.smsMarketing ?? false,
      tags: customer.tags ?? [],
      birthDate: customer.birthDate ? customer.birthDate.slice(0, 10) : '',
    });
    setTagInput('');
    setShowModal(true);
  };

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    try {
      await customerService.delete(id);
      loadCustomers();
      toast.success('Customer deleted');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to delete customer');
    }
  };

  const viewCustomerDetail = async (customer: Customer) => {
    try {
      const [detailRes, historyRes] = await Promise.all([
        customerService.getById(customer.id),
        customerService.getHistory(customer.id),
      ]);
      setSelectedCustomer(detailRes.data.data);
      setCustomerHistory(historyRes.data.data || []);
      setShowDetailModal(true);
    } catch {
      toast.error('Failed to load customer details');
    }
  };

  const resetForm = () => {
    setEditingCustomer(null);
    setFormData({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      address: '',
      city: '',
      state: '',
      zipCode: '',
      emailMarketing: false,
      smsMarketing: false,
      tags: [],
      birthDate: '',
    });
    setTagInput('');
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  return (
    <div className="p-8">
      <PageHeader
        title="Customers"
        subtitle="Manage customers, view insights, and track segments"
        actions={activeTab === 'directory' && (
          <>
            {isAdmin && (
              <Button variant="outline" onClick={() => setShowCampaignModal(true)}>
                <Megaphone className="h-4 w-4 mr-2" />
                Email Campaign
              </Button>
            )}
            <Button variant="primary" onClick={openCreateModal}>
              <Plus className="h-4 w-4 mr-2" />
              Add Customer
            </Button>
          </>
        )}
      />

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-6">
        <Button
          variant={activeTab === 'directory' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('directory')}
          size="sm"
        >
          <UsersIcon className="w-4 h-4 mr-2" />
          Directory
        </Button>
        <Button
          variant={activeTab === 'insights' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('insights')}
          size="sm"
        >
          <BarChart3 className="w-4 h-4 mr-2" />
          Insights
        </Button>
        <Button
          variant={activeTab === 'segments' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('segments')}
          size="sm"
        >
          <PieChart className="w-4 h-4 mr-2" />
          Segments
        </Button>
      </div>

      {/* Directory Tab */}
      {activeTab === 'directory' && (
        <>
          {/* Search */}
          <div className="mb-6">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by name, email, or phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {/* Customers table */}
          <Card>
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Loading customers...</p>
          </div>
        ) : customers.length === 0 ? (
          <EmptyState
            icon={UsersIcon}
            title="No customers found"
            hint={search ? 'Try adjusting your search' : 'Get started by adding your first customer'}
            action={!search && (
              <Button variant="primary" onClick={openCreateModal}>
                <Plus className="h-4 w-4 mr-2" />
                Add Customer
              </Button>
            )}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Loyalty</TableHead>
                <TableHead>Total Spent</TableHead>
                <TableHead>Visits</TableHead>
                <TableHead>Last Visit</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell>
                    <p className="font-medium">
                      {customer.firstName} {customer.lastName}
                    </p>
                    {(customer.tags?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {customer.tags!.slice(0, 3).map((tag) => (
                          <span key={tag} className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                            {tag}
                          </span>
                        ))}
                        {customer.tags!.length > 3 && (
                          <span className="text-[10px] text-muted-foreground">+{customer.tags!.length - 3}</span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      {customer.email && (
                        <p className="text-muted-foreground">{customer.email}</p>
                      )}
                      {customer.phone && (
                        <p className="text-muted-foreground">{customer.phone}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center">
                        <Star className="h-4 w-4 text-warning mr-1" />
                        <span className="font-medium">{customer.loyaltyPoints}</span>
                      </div>
                      {customer.loyaltyTier && (
                        <Badge variant={
                          customer.loyaltyTier === 'GOLD' ? 'warning' :
                          customer.loyaltyTier === 'SILVER' ? 'secondary' : 'default'
                        }>
                          {customer.loyaltyTier}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{formatCurrency(customer.totalSpent)}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{customer.visitCount}</Badge>
                  </TableCell>
                  <TableCell>
                    {customer.lastVisitAt ? (
                      <span className="text-sm text-muted-foreground">
                        {formatDate(customer.lastVisitAt)}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">Never</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => viewCustomerDetail(customer)}
                        title="View Details"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(customer)}
                        title="Edit"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      {canDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTargetId(customer.id)}
                        className="text-destructive"
                        title="Delete"
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

          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} totalItems={total} itemName="customers" />
        </>
      )}

      {/* Insights Tab */}
      {activeTab === 'insights' && (
        <div className="space-y-6">
          {insightsLoading ? (
            <div className="flex justify-center items-center h-64">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
            </div>
          ) : customerData ? (
            <>
              {/* Overview Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="p-4">
                  <p className="text-sm text-muted-foreground">Total Customers</p>
                  <p className="text-2xl font-bold">{customerData.overview.totalCustomers}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-sm text-muted-foreground">Avg Lifetime Value</p>
                  <p className="text-2xl font-bold">{formatCurrency(customerData.overview.avgLifetimeValue)}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-sm text-muted-foreground">Avg Order Value</p>
                  <p className="text-2xl font-bold">{formatCurrency(customerData.overview.avgOrderValue)}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-sm text-muted-foreground">Avg Visit Count</p>
                  <p className="text-2xl font-bold">{customerData.overview.avgVisitCount}</p>
                </Card>
              </div>

              {/* Top Customers */}
              <Card>
                <div className="p-4 border-b">
                  <h4 className="font-medium">Top Customers</h4>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Total Spent</TableHead>
                      <TableHead>Visits</TableHead>
                      <TableHead>Avg Order</TableHead>
                      <TableHead>Last Visit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customerData.topCustomers.map((customer: any) => (
                      <TableRow key={customer.id}>
                        <TableCell>
                          <p className="font-medium">{customer.name}</p>
                          {customer.email && <p className="text-xs text-muted-foreground">{customer.email}</p>}
                        </TableCell>
                        <TableCell className="font-medium">{formatCurrency(customer.totalSpent)}</TableCell>
                        <TableCell>{customer.visitCount}</TableCell>
                        <TableCell>{formatCurrency(customer.avgOrderValue)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {customer.lastVisit ? new Date(customer.lastVisit).toLocaleDateString() : 'Never'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>

              {/* Acquisition Stats */}
              <Card className="p-6">
                <h4 className="font-medium mb-4">Customer Acquisition</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Retention Rate</p>
                    <p className="text-2xl font-bold">{customerData.acquisition.retentionRate}%</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">New Customers (30d)</p>
                    <p className="text-2xl font-bold">{customerData.acquisition.newCustomers}</p>
                  </div>
                </div>
              </Card>
            </>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              No customer insights available
            </div>
          )}
        </div>
      )}

      {/* Segments Tab */}
      {activeTab === 'segments' && (
        <div className="space-y-6">
          {insightsLoading ? (
            <div className="flex justify-center items-center h-64">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
            </div>
          ) : customerData ? (
            <div className="grid grid-cols-2 gap-6">
              {/* Recency Segments */}
              <Card className="p-6">
                <h4 className="font-medium mb-4">Customer Recency</h4>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 bg-success rounded-full"></span>
                      <span>{customerData.segments.byRecency.active.label}</span>
                    </div>
                    <span className="font-bold">{customerData.segments.byRecency.active.count}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 bg-warning rounded-full"></span>
                      <span>{customerData.segments.byRecency.atRisk.label}</span>
                    </div>
                    <span className="font-bold">{customerData.segments.byRecency.atRisk.count}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 bg-destructive rounded-full"></span>
                      <span>{customerData.segments.byRecency.lost.label}</span>
                    </div>
                    <span className="font-bold">{customerData.segments.byRecency.lost.count}</span>
                  </div>
                </div>
                <div className="h-48 mt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsPieChart>
                      <Pie
                        data={[
                          { name: 'Active', value: customerData.segments.byRecency.active.count },
                          { name: 'At Risk', value: customerData.segments.byRecency.atRisk.count },
                          { name: 'Lost', value: customerData.segments.byRecency.lost.count },
                        ]}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={70}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        <Cell fill="#10b981" />
                        <Cell fill="#f59e0b" />
                        <Cell fill="#ef4444" />
                      </Pie>
                      <Tooltip />
                    </RechartsPieChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              {/* Value Segments */}
              <Card className="p-6">
                <h4 className="font-medium mb-4">Customer Value Segments</h4>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Star className="w-4 h-4 text-primary" />
                      <span>{customerData.segments.byValue.vip.label}</span>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">{customerData.segments.byValue.vip.count}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(customerData.segments.byValue.vip.totalSpent)}
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <UsersIcon className="w-4 h-4 text-info" />
                      <span>{customerData.segments.byValue.regular.label}</span>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">{customerData.segments.byValue.regular.count}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(customerData.segments.byValue.regular.totalSpent)}
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <UsersIcon className="w-4 h-4 text-muted-foreground" />
                      <span>{customerData.segments.byValue.occasional.label}</span>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">{customerData.segments.byValue.occasional.count}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(customerData.segments.byValue.occasional.totalSpent)}
                      </p>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              No segment data available
            </div>
          )}
        </div>
      )}

      {/* Customer Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          resetForm();
        }}
        title={editingCustomer ? 'Edit Customer' : 'Add New Customer'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="First Name"
              value={formData.firstName}
              onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
              required
            />
            <Input
              label="Last Name"
              value={formData.lastName}
              onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              type="email"
              label="Email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
            <Input
              type="tel"
              label="Phone"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              required
            />
          </div>

          <Input
            label="Address"
            value={formData.address}
            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input
              label="City"
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            />
            <Input
              label="State"
              value={formData.state}
              onChange={(e) => setFormData({ ...formData, state: e.target.value })}
            />
            <Input
              label="ZIP Code"
              value={formData.zipCode}
              onChange={(e) => setFormData({ ...formData, zipCode: e.target.value })}
            />
          </div>

          {/* Birthday */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Birthday <span className="text-xs text-muted-foreground font-normal">(for the birthday email perk)</span>
            </label>
            <Input
              type="date"
              value={formData.birthDate}
              onChange={(e) => setFormData({ ...formData, birthDate: e.target.value })}
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium mb-1">Tags</label>
            {formData.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {formData.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-1 rounded-full"
                  >
                    {tag}
                    <button type="button" onClick={() => removeTag(tag)} className="hover:text-destructive" title="Remove tag">
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                placeholder='e.g. "wholesale", "vip", "coffee-club"'
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addTag(); }
                }}
              />
              <Button type="button" variant="outline" onClick={addTag} disabled={!tagInput.trim()}>
                Add
              </Button>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={formData.emailMarketing}
                onChange={(e) =>
                  setFormData({ ...formData, emailMarketing: e.target.checked })
                }
                className="rounded border-input"
              />
              <span className="text-sm">Email marketing consent</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={formData.smsMarketing}
                onChange={(e) =>
                  setFormData({ ...formData, smsMarketing: e.target.checked })
                }
                className="rounded border-input"
              />
              <span className="text-sm">SMS marketing consent</span>
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
              {editingCustomer ? 'Update Customer' : 'Create Customer'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Email Campaign Modal */}
      <Modal
        isOpen={showCampaignModal}
        onClose={() => setShowCampaignModal(false)}
        title="Email Campaign"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Who gets it?</label>
            <select
              value={campaignSegment}
              onChange={(e) => setCampaignSegment(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
            >
              <option value="all">All opted-in customers</option>
              <option value="lapsed30">Lapsed — no visit in 30+ days</option>
              <option value="lapsed60">Lapsed — no visit in 60+ days</option>
              <option value="top20">Top 20 spenders</option>
              <option value="tag">Customers with a tag...</option>
            </select>
            {campaignSegment === 'tag' && (
              <Input
                placeholder='Tag name, e.g. "vip"'
                value={campaignTag}
                onChange={(e) => setCampaignTag(e.target.value)}
                className="mt-2"
              />
            )}
            <p className="text-xs text-muted-foreground mt-1.5">
              {campaignReach === null
                ? 'Only customers who opted into emails are ever contacted.'
                : `Will reach ${campaignReach} opted-in customer${campaignReach !== 1 ? 's' : ''}.`}
            </p>
          </div>

          <Input
            label="Subject"
            placeholder="This weekend only: 2-for-1 energy drinks"
            value={campaignSubject}
            onChange={(e) => setCampaignSubject(e.target.value)}
          />

          <div>
            <label className="block text-sm font-medium mb-1">Message</label>
            <textarea
              value={campaignMessage}
              onChange={(e) => setCampaignMessage(e.target.value)}
              placeholder={'Hi {firstName},\n\nCome see us this weekend...'}
              rows={5}
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {'{firstName}'} is replaced with each customer's name.
            </p>
          </div>

          <div className="flex gap-3 pt-2 border-t">
            <Button variant="outline" className="flex-1" onClick={() => setShowCampaignModal(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={handleSendCampaign}
              disabled={
                campaignSending ||
                !campaignSubject.trim() ||
                !campaignMessage.trim() ||
                campaignReach === 0 ||
                (campaignSegment === 'tag' && !campaignTag.trim())
              }
            >
              <Megaphone className="h-4 w-4 mr-2" />
              {campaignSending
                ? 'Sending...'
                : `Send${campaignReach ? ` to ${campaignReach}` : ''}`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Customer Detail Modal */}
      <Modal
        isOpen={showDetailModal}
        onClose={() => { setShowDetailModal(false); setSelectedCustomer(null); }}
        title={selectedCustomer ? `${selectedCustomer.firstName} ${selectedCustomer.lastName}` : 'Customer Details'}
        size="lg"
      >
        {selectedCustomer && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Email</p>
                <p className="font-medium">{selectedCustomer.email || 'Not provided'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Phone</p>
                <p className="font-medium">{selectedCustomer.phone || 'Not provided'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Loyalty Tier</p>
                <Badge variant={
                  selectedCustomer.loyaltyTier === 'GOLD' ? 'warning' :
                  selectedCustomer.loyaltyTier === 'SILVER' ? 'secondary' : 'default'
                }>
                  {selectedCustomer.loyaltyTier || 'BRONZE'}
                </Badge>
              </div>
              <div>
                <p className="text-muted-foreground">Loyalty Points</p>
                <p className="font-medium">{selectedCustomer.loyaltyPoints}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Total Spent</p>
                <p className="font-medium">{formatCurrency(selectedCustomer.totalSpent)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Visits</p>
                <p className="font-medium">{selectedCustomer.visitCount}</p>
              </div>
              {selectedCustomer.address && (
                <div className="col-span-2 sm:col-span-3">
                  <p className="text-muted-foreground">Address</p>
                  <p className="font-medium">
                    {[selectedCustomer.address, selectedCustomer.city, selectedCustomer.state, selectedCustomer.zipCode].filter(Boolean).join(', ')}
                  </p>
                </div>
              )}
            </div>

            {/* Purchase History */}
            <div className="border-t pt-4">
              <h4 className="font-medium mb-2">Recent Purchases ({customerHistory.length})</h4>
              {customerHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground">No purchase history</p>
              ) : (
                <div className="max-h-[250px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sale #</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Items</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customerHistory.map((sale: any) => (
                        <TableRow key={sale.id}>
                          <TableCell className="font-mono text-sm">{sale.saleNumber}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{new Date(sale.createdAt).toLocaleDateString()}</TableCell>
                          <TableCell className="text-sm">{sale.items?.length || 0}</TableCell>
                          <TableCell className="font-medium">{formatCurrency(sale.total)}</TableCell>
                          <TableCell>
                            <Badge variant={sale.status === 'COMPLETED' ? 'success' : sale.status === 'REFUNDED' ? 'destructive' : 'secondary'}>
                              {sale.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => { setShowDetailModal(false); handleEdit(selectedCustomer); }}>
                <Edit className="w-4 h-4 mr-1" /> Edit
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={deleteTargetId !== null}
        onClose={() => setDeleteTargetId(null)}
        onConfirm={() => deleteTargetId && handleDelete(deleteTargetId)}
        title="Delete customer?"
        message="This is a soft delete — the customer record is kept and can be restored."
        destructive
        confirmLabel="Delete"
      />
    </div>
  );
};
