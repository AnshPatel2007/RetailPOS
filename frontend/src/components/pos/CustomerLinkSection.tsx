import React, { useState, useEffect } from 'react';
import { customerService } from '@/services/api';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import {
  X,
  Plus,
  User,
  Phone,
  Star,
  Award,
  DollarSign,
  ShoppingBag,
} from 'lucide-react';
import toast from 'react-hot-toast';

export interface LinkedCustomer {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone: string;
  loyaltyPoints: number;
  totalSpent: number;
  visitCount: number;
}

interface CustomerLinkSectionProps {
  linkedCustomer: LinkedCustomer | null;
  onCustomerChange: (customer: LinkedCustomer | null) => void;
}

export const CustomerLinkSection: React.FC<CustomerLinkSectionProps> = ({
  linkedCustomer,
  onCustomerChange,
}) => {
  const [customerPhone, setCustomerPhone] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCustomerData, setNewCustomerData] = useState({
    firstName: '',
    lastName: '',
    email: '',
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      if (customerPhone.length >= 3) {
        handlePhoneLookup();
      } else if (!linkedCustomer) {
        onCustomerChange(null);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [customerPhone]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePhoneLookup = async () => {
    if (!customerPhone) return;
    setIsSearching(true);
    try {
      const response = await customerService.searchByPhone(customerPhone);
      const customer = response.data.data;
      onCustomerChange(customer ?? null);
    } catch {
      onCustomerChange(null);
    } finally {
      setIsSearching(false);
    }
  };

  const handleClear = () => {
    onCustomerChange(null);
    setCustomerPhone('');
  };

  const handleCreate = async () => {
    try {
      const response = await customerService.create({
        ...newCustomerData,
        phone: customerPhone,
      });
      onCustomerChange(response.data.data);
      setShowCreateModal(false);
      setNewCustomerData({ firstName: '', lastName: '', email: '' });
      toast.success('Customer created successfully!');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to create customer');
    }
  };

  const getLoyaltyTier = (points: number) => {
    if (points >= 2000) return { name: 'Gold', css: 'bg-yellow-500/10 text-yellow-500' };
    if (points >= 500) return { name: 'Silver', css: 'bg-muted text-foreground' };
    return { name: 'Bronze', css: 'bg-amber-500/10 text-amber-500' };
  };

  return (
    <>
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-2">
          <Phone className="h-4 w-4" />
          Customer Phone
        </label>

        {linkedCustomer ? (
          <Card className="p-3 bg-primary/5 border-primary">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" />
                  <p className="font-medium text-sm">
                    {linkedCustomer.firstName} {linkedCustomer.lastName}
                  </p>
                  {(() => {
                    const tier = getLoyaltyTier(linkedCustomer.loyaltyPoints);
                    return (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex items-center gap-0.5 ${tier.css}`}>
                        <Award className="h-2.5 w-2.5" />
                        {tier.name}
                      </span>
                    );
                  })()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{linkedCustomer.phone}</p>
                <div className="flex items-center gap-3 mt-2">
                  <div className="flex items-center gap-1">
                    <Star className="h-3 w-3 text-yellow-500" />
                    <p className="text-xs font-medium">{linkedCustomer.loyaltyPoints} pts</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <DollarSign className="h-3 w-3 text-green-500" />
                    <p className="text-xs text-muted-foreground">{formatCurrency(linkedCustomer.totalSpent)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <ShoppingBag className="h-3 w-3 text-blue-500" />
                    <p className="text-xs text-muted-foreground">{linkedCustomer.visitCount} visits</p>
                  </div>
                </div>
              </div>
              <button
                onClick={handleClear}
                className="p-1 hover:bg-destructive/10 rounded"
              >
                <X className="h-4 w-4 text-destructive" />
              </button>
            </div>
          </Card>
        ) : (
          <>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="tel"
                placeholder="Enter phone number..."
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="pl-10"
              />
              {isSearching && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full"></div>
                </div>
              )}
            </div>
            {customerPhone.length >= 3 && !linkedCustomer && !isSearching && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setShowCreateModal(true)}
              >
                <Plus className="h-4 w-4 mr-1" />
                Create New Customer
              </Button>
            )}
          </>
        )}
      </div>

      {/* Quick Create Customer Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create New Customer"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Create a new customer for phone: <span className="font-medium">{customerPhone}</span>
          </p>
          <Input
            type="text"
            label="First Name"
            placeholder="Enter first name..."
            value={newCustomerData.firstName}
            onChange={(e) => setNewCustomerData({ ...newCustomerData, firstName: e.target.value })}
            required
            autoFocus
          />
          <Input
            type="text"
            label="Last Name"
            placeholder="Enter last name..."
            value={newCustomerData.lastName}
            onChange={(e) => setNewCustomerData({ ...newCustomerData, lastName: e.target.value })}
            required
          />
          <Input
            type="email"
            label="Email (Optional)"
            placeholder="customer@example.com"
            value={newCustomerData.email}
            onChange={(e) => setNewCustomerData({ ...newCustomerData, email: e.target.value })}
          />
          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setShowCreateModal(false);
                setNewCustomerData({ firstName: '', lastName: '', email: '' });
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={handleCreate}
              disabled={!newCustomerData.firstName || !newCustomerData.lastName}
            >
              Create Customer
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
