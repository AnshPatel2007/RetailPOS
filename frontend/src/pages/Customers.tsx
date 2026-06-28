import React, { useState, useEffect } from 'react';
import { customerService, analyticsService } from '@/services/api';
import { Customer } from '@/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
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
import { Plus, Search, Edit, Trash2, Users as UsersIcon, Star, BarChart3, PieChart } from 'lucide-react';
import { PieChart as RechartsPieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

export const Customers: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'directory' | 'insights' | 'segments'>('directory');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  // Customer insights data
  const [customerData, setCustomerData] = useState<any>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

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
  });

  useEffect(() => {
    if (activeTab === 'directory') {
      loadCustomers();
    } else if (activeTab === 'insights' || activeTab === 'segments') {
      loadCustomerInsights();
    }
  }, [search, activeTab]);

  const loadCustomers = async () => {
    setIsLoading(true);
    try {
      const response = await customerService.getAll({
        search,
        page: 1,
        limit: 100,
      });
      setCustomers(response.data.data);
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
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this customer?')) return;

    try {
      await customerService.delete(id);
      loadCustomers();
      toast.success('Customer deleted');
    } catch (error) {
      toast.error('Failed to delete customer');
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
    });
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
          <h1 className="text-3xl font-bold mb-2">Customers</h1>
          <p className="text-muted-foreground">
            Manage customers, view insights, and track segments
          </p>
        </div>
        {activeTab === 'directory' && (
          <Button variant="primary" onClick={openCreateModal}>
            <Plus className="h-4 w-4 mr-2" />
            Add Customer
          </Button>
        )}
      </div>

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
          <div className="p-12 text-center">
            <UsersIcon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No customers found</h3>
            <p className="text-muted-foreground mb-4">
              {search ? 'Try adjusting your search' : 'Get started by adding your first customer'}
            </p>
            {!search && (
              <Button variant="primary" onClick={openCreateModal}>
                <Plus className="h-4 w-4 mr-2" />
                Add Customer
              </Button>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Loyalty Points</TableHead>
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
                    <div className="flex items-center">
                      <Star className="h-4 w-4 text-yellow-500 mr-1" />
                      <span className="font-medium">{customer.loyaltyPoints}</span>
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
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(customer)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(customer.id)}
                        className="text-destructive"
                      >
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
              <div className="grid grid-cols-4 gap-4">
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
                      <span className="w-3 h-3 bg-green-500 rounded-full"></span>
                      <span>{customerData.segments.byRecency.active.label}</span>
                    </div>
                    <span className="font-bold">{customerData.segments.byRecency.active.count}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 bg-yellow-500 rounded-full"></span>
                      <span>{customerData.segments.byRecency.atRisk.label}</span>
                    </div>
                    <span className="font-bold">{customerData.segments.byRecency.atRisk.count}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 bg-red-500 rounded-full"></span>
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
                      <Star className="w-4 h-4 text-purple-500" />
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
                      <UsersIcon className="w-4 h-4 text-blue-500" />
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

          <div className="grid grid-cols-3 gap-4">
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
    </div>
  );
};
