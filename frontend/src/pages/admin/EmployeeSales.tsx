import React, { useState, useEffect, useCallback } from 'react';
import { reportService, locationService, saleService } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { formatCurrency } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
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
import { Users, DollarSign, ShoppingCart, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';

interface EmployeeData {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
  };
  totalRevenue: number;
  transactionCount: number;
  avgTransaction: number;
}

interface LocationOption {
  id: string;
  name: string;
}

interface SaleDetail {
  id: string;
  saleNumber: string;
  total: number;
  paymentMethod: string;
  status: string;
  createdAt: string;
  customer?: { firstName: string; lastName: string } | null;
}

export const EmployeeSales: React.FC = () => {
  const { user } = useAuthStore();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const [employees, setEmployees] = useState<EmployeeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Location selector for SUPER_ADMIN
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [selectedLocation, setSelectedLocation] = useState('');

  // Drill-down modal
  const [showDrillDown, setShowDrillDown] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeData | null>(null);
  const [employeeSales, setEmployeeSales] = useState<SaleDetail[]>([]);
  const [salesLoading, setSalesLoading] = useState(false);
  const [salesPage, setSalesPage] = useState(1);
  const [salesTotalPages, setSalesTotalPages] = useState(1);

  // Fetch locations for super admin
  useEffect(() => {
    if (isSuperAdmin) {
      locationService.getAll().then(res => {
        const locs = res.data.data.map((l: any) => ({ id: l.id, name: l.name }));
        setLocations(locs);
        if (locs.length > 0 && !selectedLocation) {
          setSelectedLocation(locs[0].id);
        }
      }).catch(() => {});
    }
  }, [isSuperAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchEmployeeSales = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { startDate, endDate };
      if (isSuperAdmin && selectedLocation) {
        params.locationId = selectedLocation;
      }
      const res = await reportService.getEmployeeSales(params);
      setEmployees(res.data.data);
    } catch {
      toast.error('Failed to load employee sales');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, selectedLocation, isSuperAdmin]);

  useEffect(() => {
    if (!isSuperAdmin || selectedLocation) {
      fetchEmployeeSales();
    }
  }, [fetchEmployeeSales, isSuperAdmin, selectedLocation]);

  const openDrillDown = async (emp: EmployeeData) => {
    setSelectedEmployee(emp);
    setShowDrillDown(true);
    setSalesPage(1);
    await fetchEmployeeSalesDetail(emp.user.id, 1);
  };

  const fetchEmployeeSalesDetail = async (userId: string, page: number) => {
    setSalesLoading(true);
    try {
      const res = await saleService.getAll({
        userId,
        startDate,
        endDate,
        page,
        limit: 20,
        status: 'COMPLETED',
      });
      setEmployeeSales(res.data.data);
      setSalesTotalPages(res.data.pagination?.totalPages || 1);
    } catch {
      toast.error('Failed to load sales details');
    } finally {
      setSalesLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    setSalesPage(newPage);
    if (selectedEmployee) {
      fetchEmployeeSalesDetail(selectedEmployee.user.id, newPage);
    }
  };

  const totalRevenue = employees.reduce((sum, e) => sum + e.totalRevenue, 0);
  const totalTransactions = employees.reduce((sum, e) => sum + e.transactionCount, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Employee Sales</h1>
        <p className="text-muted-foreground">Sales performance breakdown by employee</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        {isSuperAdmin && locations.length > 0 && (
          <div>
            <label className="block text-sm font-medium mb-1">Store</label>
            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className="px-3 py-2 rounded-md border border-input bg-background text-sm"
            >
              {locations.map(loc => (
                <option key={loc.id} value={loc.id}>{loc.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium mb-1">From</label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-40"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">To</label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-40"
          />
        </div>
        <Button variant="outline" size="sm" onClick={fetchEmployeeSales}>
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Users className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Employees</p>
              <p className="text-xl font-bold">{employees.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <DollarSign className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Revenue</p>
              <p className="text-xl font-bold">{formatCurrency(totalRevenue)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <ShoppingCart className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Transactions</p>
              <p className="text-xl font-bold">{totalTransactions}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Employee table */}
      <Card>
        <CardHeader>
          <CardTitle>Sales by Employee</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : employees.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No sales data found for this period
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Transactions</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Avg Transaction</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((emp, idx) => (
                  <TableRow key={emp.user.id}>
                    <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell className="font-medium">
                      {emp.user.firstName} {emp.user.lastName}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {emp.user.role.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{emp.transactionCount}</TableCell>
                    <TableCell className="text-right font-medium text-green-600">
                      {formatCurrency(emp.totalRevenue)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(emp.avgTransaction)}
                    </TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" onClick={() => openDrillDown(emp)}>
                        View Sales
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Drill-down modal */}
      <Modal
        isOpen={showDrillDown}
        onClose={() => { setShowDrillDown(false); setSelectedEmployee(null); }}
        title={`Sales — ${selectedEmployee?.user.firstName} ${selectedEmployee?.user.lastName}`}
        size="lg"
      >
        <div className="space-y-3">
          <div className="flex gap-4 p-3 bg-muted/50 rounded-lg text-sm">
            <div>
              <span className="text-muted-foreground">Total Revenue: </span>
              <span className="font-bold text-green-600">{selectedEmployee && formatCurrency(selectedEmployee.totalRevenue)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Transactions: </span>
              <span className="font-bold">{selectedEmployee?.transactionCount}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Avg: </span>
              <span className="font-bold">{selectedEmployee && formatCurrency(selectedEmployee.avgTransaction)}</span>
            </div>
          </div>

          {salesLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Sale #</th>
                    <th className="text-left px-3 py-2 font-medium">Customer</th>
                    <th className="text-left px-3 py-2 font-medium">Payment</th>
                    <th className="text-right px-3 py-2 font-medium">Total</th>
                    <th className="text-left px-3 py-2 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {employeeSales.map((sale) => (
                    <tr key={sale.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono text-xs">{sale.saleNumber}</td>
                      <td className="px-3 py-2">
                        {sale.customer ? `${sale.customer.firstName} ${sale.customer.lastName}` : '-'}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="secondary" className="text-xs">
                          {sale.paymentMethod.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right font-medium">{formatCurrency(sale.total)}</td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">
                        {new Date(sale.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                  {employeeSales.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-6 text-muted-foreground">No sales found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {salesTotalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-muted-foreground">Page {salesPage} of {salesTotalPages}</p>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" onClick={() => handlePageChange(salesPage - 1)} disabled={salesPage <= 1}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => handlePageChange(salesPage + 1)} disabled={salesPage >= salesTotalPages}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
