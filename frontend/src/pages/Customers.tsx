import { Select } from '@/components/ui/Select';
import { useLegacyPageRefresh } from '@/hooks/useLegacyPageRefresh';
import { PageTabs } from '@/components/common/PageTabs';
import { useSavedOperation } from '@/hooks/useSavedOperation';
import { OperationRecovery } from '@/components/common/OperationRecovery';
import React, { useState, useEffect, useRef, useId } from 'react';
import { customerService, analyticsService } from '@/services/api';
import { Customer } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PageHeader } from '@/components/common/PageHeader';
import { DataPanel, FormSection, ManagementPage } from '@/components/common/Workspace';
import { CustomerDirectoryTable } from '@/components/customers/CustomerDirectoryTable';
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
import { Plus, Search, Edit, Users as UsersIcon, Star, Megaphone } from 'lucide-react';
import { PieChart as RechartsPieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import { useUrlFilter, useUrlPage } from '@/hooks/useUrlFilter';
import { can } from '@/lib/capabilities';
import { useAuthStore } from '@/store/authStore';
import '@/styles/customers.css';
import { Spinner } from '@/components/ui/LoadingState';
import { Checkbox } from '@/components/ui/Checkbox';

export const Customers: React.FC<{ view: 'directory' | 'insights' }> = ({ view }) => {
  const { locationId } = useEffectiveLocation();
  const requestVersion = useRef(0);
  const [loadError, setLoadError] = useState('');
  const [analysis, setAnalysis] = useUrlFilter('analysis', 'overview', false);
  const activeTab = view === 'directory' ? 'directory' : analysis === 'segments' ? 'segments' : 'insights';
  const { user } = useAuthStore();
  const canDelete = can(user?.role, 'customer.manage');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useUrlFilter('search');
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [page, setPage] = useUrlPage();
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const customerFormId = useId();
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

  const addressSummary = [formData.city, formData.state].filter(Boolean).join(', ') || (formData.address ? formData.address : formData.birthDate ? 'Birthday only' : 'Not added');
  const marketingSummary = [formData.tags.length ? `${formData.tags.length} tag${formData.tags.length === 1 ? '' : 's'}` : '', formData.emailMarketing ? 'emails ok' : '', formData.smsMarketing ? 'texts ok' : ''].filter(Boolean).join(' · ') || 'None';
  const [tagInput, setTagInput] = useState('');

  // ─── Email campaign (admin) ───
  const isAdmin = can(user?.role, 'campaign.send');
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [campaignSegment, setCampaignSegment] = useState('all');
  const [campaignTag, setCampaignTag] = useState('');
  const [campaignSubject, setCampaignSubject] = useState('');
  const [campaignMessage, setCampaignMessage] = useState('');
  const [campaignReach, setCampaignReach] = useState<number | null>(null);
  const campaignOperation = useSavedOperation('campaign', '/customers/campaign', response => {
    toast.success('Queued ' + response.data.queued + ' campaign emails. Review delivery jobs for results.');
    setShowCampaignModal(false); setCampaignSubject(''); setCampaignMessage('');
  });
  const campaignSending = campaignOperation.busy;

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
  }, [showCampaignModal, effectiveSegment]);

  const handleSendCampaign = async () => {
    if (!campaignSubject.trim() || !campaignMessage.trim()) {
      toast.error('Subject and message are required');
      return;
    }
    await campaignOperation.submit({label:'Campaign: '+campaignSubject.trim(),path:'/customers/campaign',payload:{segment:effectiveSegment,subject:campaignSubject.trim(),message:campaignMessage.trim()}});
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
    return () => { requestVersion.current++; };
  }, [debouncedSearch, page, activeTab, locationId]);

  const loadCustomers = async (quiet = false, active: () => boolean = () => true, signal?: AbortSignal) => {
    const version = ++requestVersion.current; if (!quiet) setLoadError('');
    if (!quiet) setIsLoading(true);
    try {
      const response = await customerService.getAll({
        locationId, search: debouncedSearch,
        page,
        limit: 20,
      }, signal);
      if (version !== requestVersion.current || !active()) return;
      setLoadError('');
      setCustomers(response.data.data);
      setTotalPages(response.data.pagination?.totalPages || 1);
      setTotal(response.data.pagination?.total || 0);
    } catch (error) {
      if (quiet) throw error;
      if (version === requestVersion.current) setLoadError('Unable to load customers. Try again.');
    } finally {
      if (version === requestVersion.current) setIsLoading(false);
    }
  };

  const loadCustomerInsights = async (quiet = false, active: () => boolean = () => true, signal?: AbortSignal) => {
    const version = ++requestVersion.current; if (!quiet) setLoadError('');
    if (!quiet) setInsightsLoading(true);
    try {
      const response = await analyticsService.getCustomerInsights({ locationId }, signal);
      if (version !== requestVersion.current || !active()) return;
      setLoadError('');
      setCustomerData(response.data.data);
    } catch (error) {
      if (quiet) throw error;
      if (version === requestVersion.current) setLoadError('Unable to load customer insights. Try again.');
    } finally {
      if (version === requestVersion.current) setInsightsLoading(false);
    }
  };

  useEffect(() => {
    setCustomers([]); setCustomerData(null); setShowModal(false); setShowDetailModal(false); setSelectedCustomer(null); setCustomerHistory([]); setShowCampaignModal(false);
  }, [locationId]);

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

  const autoRefresh = useLegacyPageRefresh((current, signal) => activeTab === 'directory' ? loadCustomers(true, current, signal) : loadCustomerInsights(true, current, signal), { key: JSON.stringify([locationId, activeTab, debouncedSearch, page]), paused: isLoading && activeTab === 'directory' || insightsLoading });

  return (
    <ManagementPage className="customers-workspace">
      <PageHeader
        title={view === 'directory' ? 'Customers' : 'Customer Insights'}
        subtitle={view === 'directory' ? 'Find customers and manage their contact details.' : 'Understand customer activity and plan owner-approved campaigns.'}
        actions={view === 'directory' ? (can(user?.role, 'customer.edit') && <Button variant="primary" onClick={openCreateModal}><Plus className="h-4 w-4 mr-2" />Add Customer</Button>) : isAdmin && <Button variant="outline" onClick={() => setShowCampaignModal(true)}><Megaphone className="h-4 w-4 mr-2" />Email Campaign</Button>}
        tabs={view === 'insights' ? <PageTabs label="Customer analysis" value={analysis === 'segments' ? 'segments' : 'overview'} items={[{ id: 'overview', label: 'Overview' }, { id: 'segments', label: 'Customer Segments' }]} onChange={setAnalysis} /> : undefined}
      />
      {autoRefresh.notice}
      {loadError && <div className="p-6 mb-4 border rounded-lg" role="alert"><p>{loadError}</p><Button className="mt-3" variant="outline" onClick={() => void (view === 'directory' ? loadCustomers() : loadCustomerInsights())}>Retry</Button></div>}
      {/* Directory Tab */}
      {activeTab === 'directory' && !loadError && <DataPanel
        toolbar={<div className="customer-directory-toolbar">
          <div className="customer-directory-search"><Search aria-hidden="true" /><Input type="search" aria-label="Search customers" placeholder="Search by name, email, or phone..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" /></div>
          {search ? <Button variant="ghost" onClick={() => setSearch('')}>Clear search</Button> : !isLoading && <span className="text-xs text-muted-foreground">{total} customers</span>}
        </div>}
        footer={!isLoading && <div className="customer-directory-footer"><span role="status">{customers.length ? `${customers.length} customers on this page, ${total} ${search ? 'matching' : 'total'}` : '0 customers'}</span><Pagination page={page} totalPages={totalPages} onPageChange={setPage} itemName="customers" /></div>}
      >
        {isLoading ? <div className="p-8 text-center" role="status"><Spinner size="md" className="mx-auto" /><p className="mt-3 text-muted-foreground">Loading customers...</p></div>
          : customers.length === 0 ? <EmptyState icon={UsersIcon} title="No customers found" hint={search ? 'Try another search or clear it to see all customers.' : 'Add a customer to keep contact details and purchase history together.'} />
            : <CustomerDirectoryTable customers={customers} canDelete={canDelete} onView={viewCustomerDetail} onEdit={handleEdit} onDelete={customer => setDeleteTargetId(customer.id)} />}
      </DataPanel>}

      {/* Insights Tab */}
      {activeTab === 'insights' && !loadError && (
        <div className="space-y-6">
          {insightsLoading ? (
            <div className="flex justify-center items-center h-64">
              <Spinner size="lg" />
            </div>
          ) : customerData ? (
            <>
              {/* Overview Cards */}
              <div className="metric-grid grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="p-4">
                  <p className="text-sm text-muted-foreground">Total Customers</p>
                  <p className="metric-value text-2xl font-semibold">{customerData.overview.totalCustomers}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-sm text-muted-foreground">Avg Lifetime Value</p>
                  <p className="metric-value text-2xl font-semibold">{formatCurrency(customerData.overview.avgLifetimeValue)}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-sm text-muted-foreground">Avg Order Value</p>
                  <p className="metric-value text-2xl font-semibold">{formatCurrency(customerData.overview.avgOrderValue)}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-sm text-muted-foreground">Avg Visit Count</p>
                  <p className="metric-value text-2xl font-semibold">{customerData.overview.avgVisitCount}</p>
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
                      <TableHead className="text-right">Total Spent</TableHead>
                      <TableHead className="text-right">Visits</TableHead>
                      <TableHead className="text-right">Avg Order</TableHead>
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
                        <TableCell className="text-right whitespace-nowrap font-medium">{formatCurrency(customer.totalSpent)}</TableCell>
                        <TableCell className="text-right">{customer.visitCount}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{formatCurrency(customer.avgOrderValue)}</TableCell>
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
                    <p className="metric-value text-2xl font-semibold">{customerData.acquisition.retentionRate}%</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">New Customers (30d)</p>
                    <p className="metric-value text-2xl font-semibold">{customerData.acquisition.newCustomers}</p>
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
      {activeTab === 'segments' && !loadError && (
        <div className="space-y-6">
          {insightsLoading ? (
            <div className="flex justify-center items-center h-64">
              <Spinner size="lg" />
            </div>
          ) : customerData ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
        description={editingCustomer ? undefined : 'Name and phone are all you need. Add the rest any time.'}
        size="lg"
        footer={<div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={() => { setShowModal(false); resetForm(); }}>Cancel</Button><Button type="submit" form={customerFormId}>{editingCustomer ? 'Update Customer' : 'Create Customer'}</Button></div>}
      >
        <form id={customerFormId} onSubmit={handleSubmit} className="customer-form space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="First Name"
              value={formData.firstName}
              onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
              required
              autoFocus
            />
            <Input
              label="Last Name"
              value={formData.lastName}
              onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
              required
            />
            <Input
              type="tel"
              label="Phone"
              description="Used to find them at the register."
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              required
            />
            <Input
              type="email"
              label="Email"
              description="Optional. For receipts and offers."
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
          </div>

          <FormSection collapsible title="Address & birthday" summary={addressSummary} defaultOpen={!!(editingCustomer && addressSummary !== 'Not added')}>
            <Input
              label="Street address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
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
            <Input
              type="date"
              label="Birthday"
              description="They get the birthday offer, if you run one."
              value={formData.birthDate}
              onChange={(e) => setFormData({ ...formData, birthDate: e.target.value })}
            />
          </FormSection>

          <FormSection collapsible title="Tags & marketing" summary={marketingSummary} defaultOpen={!!(editingCustomer && marketingSummary !== 'None')}>
            <div>
              <label htmlFor={customerFormId + '-tag'} className="mb-1.5 block text-sm font-medium">Tags</label>
              {formData.tags.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {formData.tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">
                      {tag}
                      <button type="button" onClick={() => removeTag(tag)} className="hover:text-destructive" aria-label={'Remove tag ' + tag}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  id={customerFormId + '-tag'}
                  placeholder='e.g. wholesale, vip'
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
            <div className="space-y-1">
              <Checkbox label="Agrees to marketing emails" checked={formData.emailMarketing} onChange={(e) => setFormData({ ...formData, emailMarketing: e.target.checked })} />
              <Checkbox label="Agrees to marketing texts (SMS)" checked={formData.smsMarketing} onChange={(e) => setFormData({ ...formData, smsMarketing: e.target.checked })} />
            </div>
          </FormSection>
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
            <Select
              value={campaignSegment}
              onChange={(e) => setCampaignSegment(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
            >
              <option value="all">All opted-in customers</option>
              <option value="lapsed30">Lapsed — no visit in 30+ days</option>
              <option value="lapsed60">Lapsed — no visit in 60+ days</option>
              <option value="top20">Top 20 spenders</option>
              <option value="tag">Customers with a tag...</option>
            </Select>
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
                campaignOperation.blocked ||
                !campaignSubject.trim() ||
                !campaignMessage.trim() ||
                campaignReach === 0 ||
                (campaignSegment === 'tag' && !campaignTag.trim())
              }
            >
              <Megaphone className="h-4 w-4 mr-2" />
              {campaignSending
                ? 'Queuing...'
                : `Queue${campaignReach ? ` to ${campaignReach}` : ''}`}
            </Button>
          </div>
        </div>
      </Modal>

      <OperationRecovery operation={campaignOperation} />
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
    </ManagementPage>
  );
};
