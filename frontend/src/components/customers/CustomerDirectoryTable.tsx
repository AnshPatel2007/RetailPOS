import { Edit, Trash2 } from 'lucide-react';
import type { Customer } from '@/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from '@/components/ui/Table';

export function CustomerDirectoryTable({ customers, canDelete, canEdit = true, onView, onEdit, onDelete }: {
  customers: Customer[];
  canDelete: boolean;
  /** Read-only views (platform preview, no edit permission) hide editing. */
  canEdit?: boolean;
  onView: (customer: Customer) => void;
  onEdit: (customer: Customer) => void;
  onDelete: (customer: Customer) => void;
}) {
  return <div className="customer-directory-table"><Table aria-label="Customers">
    <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Contact</TableHead><TableHead>Loyalty</TableHead><TableHead className="text-right">Total Spent</TableHead><TableHead className="text-right">Visits</TableHead><TableHead>Last Visit</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
    <TableBody>{customers.map(customer => {
      const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ');
      return <TableRow key={customer.id} className="customer-directory-row">
        <TableCell className="customer-name-cell"><p className="font-medium">{name}</p>{!!customer.tags?.length && <p className="customer-tags" title={customer.tags.join(', ')}>{customer.tags.slice(0, 3).join(' · ')}{customer.tags.length > 3 && ` +${customer.tags.length - 3}`}</p>}</TableCell>
        <TableCell className="customer-contact-cell"><div>{customer.phone && <p>{customer.phone}</p>}{customer.email && <p className="text-muted-foreground">{customer.email}</p>}{!customer.phone && !customer.email && <span className="text-muted-foreground">No contact details</span>}</div></TableCell>
        <TableCell className="customer-loyalty-cell"><span className="customer-mobile-label" aria-hidden="true">Loyalty</span><span className="tabular-nums">{customer.loyaltyPoints} points</span>{customer.loyaltyTier && <p className="text-xs text-muted-foreground">{customer.loyaltyTier.charAt(0).toUpperCase() + customer.loyaltyTier.slice(1).toLowerCase()}</p>}</TableCell>
        <TableCell className="customer-spend-cell text-right font-medium tabular-nums"><span className="customer-mobile-label" aria-hidden="true">Total spent</span>{formatCurrency(customer.totalSpent)}</TableCell>
        <TableCell className="customer-visits-cell text-right tabular-nums"><span className="customer-mobile-label" aria-hidden="true">Visits</span>{customer.visitCount}</TableCell>
        <TableCell className="customer-last-visit-cell text-muted-foreground"><span className="customer-mobile-label" aria-hidden="true">Last visit</span>{customer.lastVisitAt ? formatDate(customer.lastVisitAt) : 'Never'}</TableCell>
        <TableCell className="customer-actions-cell"><div className="customer-row-actions"><Button variant="ghost" size="sm" onClick={() => onView(customer)} title="View Details" aria-label={`View ${name}`}>View</Button><ActionMenu iconOnly label={`More actions for ${name}`} items={[
          ...(canEdit ? [{ id: 'edit', label: 'Edit customer', icon: <Edit size={16} />, onAction: () => onEdit(customer) }] : []),
          ...(canDelete ? [{ id: 'delete', label: 'Delete customer', icon: <Trash2 size={16} />, destructive: true, onAction: () => onDelete(customer) }] : []),
        ]} /></div></TableCell>
      </TableRow>;
    })}</TableBody>
  </Table></div>;
}
