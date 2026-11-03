import { Prisma } from '@prisma/client';
import { AuthRequest } from '../types';
import { getLocationFilter } from '../utils/locationFilter.util';

export function auditScope(req: AuthRequest): Prisma.ActivityLogWhereInput {
  const requested = typeof req.query.locationId === 'string' ? req.query.locationId : undefined;
  const scope = req.user?.role === 'SUPER_ADMIN' && !requested ? {} : getLocationFilter(req, requested);
  if (req.user?.role === 'ADMIN') return scope;
  const terms = ['PAYROLL', 'HOURLY', 'SALARY', 'WAGE', 'EMAIL_DELIVERY'];
  return { ...scope, AND: [
    { NOT: { OR: terms.map(term => ({ action: { contains: term, mode: 'insensitive' as const } })) } },
    { OR: [{ entity: null }, { NOT: { OR: ['Payroll', 'Wage', 'Salary', 'EmailDelivery'].map(term => ({ entity: { contains: term, mode: 'insensitive' as const } })) } }] },
  ] };
}

/** Also protects older generic update events containing nested sensitive fields. */
export function auditDetails(value: Prisma.JsonValue | null, owner: boolean, depth = 0): Prisma.JsonValue | null {
  if (depth > 20) return '[Redacted]';
  if (Array.isArray(value)) return value.map(item => auditDetails(item, owner, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const context = String(value.category || value.entity || '').toUpperCase();
  if (!owner && /PAYROLL|WAGE|SALARY/.test(context)) return '[Restricted payroll details]';
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const secret = /password|secret|token|authorization|apikey|cardnumber|recoverycode|backupcode|^(fullpan|cvv|cvc|pin)$/.test(normalized);
    const wage = /hourlyrate|wage|salary|grosspay|netpay|earnings|payroll/.test(normalized);
    return [key, secret || (!owner && wage) ? '[Redacted]' : auditDetails(item ?? null, owner, depth + 1)];
  }));
}
