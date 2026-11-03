import { AuthRequest } from '../types';
import { AppError } from './errorHandler';
import { can } from '../policies/capabilities';

export function assertPayrollAccess(req: AuthRequest, category: string) {
  if (category === 'PAYROLL' && !can(req.user?.role, 'payroll.manage')) throw new AppError('Payroll records are owner-only', 403);
}

// Apply to individual records and exports, never to operating-cost aggregates.
export function privateExpenseFilter(req: AuthRequest) {
  return can(req.user?.role, 'payroll.manage') ? {} : { NOT: { category: 'PAYROLL' as const } };
}
