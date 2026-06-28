import React from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatCurrency } from '@/lib/utils';
import { X, PauseCircle, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import { CartItem, Customer } from '@/types';

interface HeldSale {
  id: string;
  items: CartItem[];
  customer: Customer | null;
  discount: number;
  notes: string;
  heldAt: string;
}

interface HeldSalesModalProps {
  isOpen: boolean;
  onClose: () => void;
  heldSales: HeldSale[];
  onRestore: (id: string) => void;
  onDiscard: (id: string) => void;
}

export const HeldSalesModal: React.FC<HeldSalesModalProps> = ({
  isOpen,
  onClose,
  heldSales,
  onRestore,
  onDiscard,
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Held Sales" size="md">
      <div className="space-y-3">
        {heldSales.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <PauseCircle className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p>No sales on hold</p>
            <p className="text-sm mt-1">Press F5 or click Hold to park a sale</p>
          </div>
        ) : (
          heldSales.map((held) => {
            const total = held.items.reduce(
              (sum, i) => sum + i.product.price * i.quantity - i.discount,
              0
            );
            const itemCount = held.items.reduce((c, i) => c + i.quantity, 0);
            const elapsed = Math.round((Date.now() - new Date(held.heldAt).getTime()) / 60000);
            return (
              <Card key={held.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-sm truncate">
                        {held.customer
                          ? `${held.customer.firstName} ${held.customer.lastName}`
                          : 'Walk-in Customer'}
                      </p>
                      <span className="text-xs text-muted-foreground flex items-center gap-0.5 shrink-0">
                        <Clock className="h-3 w-3" />
                        {elapsed}m ago
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {itemCount} item{itemCount !== 1 ? 's' : ''} · {formatCurrency(total)}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {held.items.map((i) => i.product.name).join(', ')}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        onDiscard(held.id);
                        toast.success('Held sale discarded');
                      }}
                      className="text-destructive border-destructive/30 hover:bg-destructive/10"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => onRestore(held.id)}
                    >
                      Restore
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </Modal>
  );
};
