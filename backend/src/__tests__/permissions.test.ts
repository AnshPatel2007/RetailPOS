import { resolveUserAssignment } from '../utils/userPermissions';
import { getLocationFilter, assertOwnsRecord } from '../utils/locationFilter.util';
import { authenticate } from '../middleware/auth';
import prisma from '../config/database';
import { verifyToken } from '../utils/jwt';
import { AuthRequest } from '../types';

jest.mock('../config/database', () => ({ __esModule: true, default: { user: { findUnique: jest.fn() } } }));
jest.mock('../utils/jwt', () => ({ verifyToken: jest.fn() }));
const actor = (role: string, locationId: string | null = 'store-a') => ({ user: { id: 'actor', role, locationId } } as AuthRequest);

test('managers cannot register admins or assign another store', () => {
  expect(() => resolveUserAssignment(actor('MANAGER'), 'ADMIN', undefined)).toThrow('Only super-admin');
  expect(() => resolveUserAssignment(actor('MANAGER'), 'CASHIER', 'store-b')).toThrow('own location');
  expect(resolveUserAssignment(actor('ADMIN'), 'CASHIER', undefined)).toEqual({ role: 'CASHIER', locationId: 'store-a' });
});
test('store-bound roles require a location even when created by the chain owner', () => {
  expect(() => resolveUserAssignment(actor('SUPER_ADMIN', null), 'ADMIN', null)).toThrow('store assignment');
  expect(() => getLocationFilter(actor('CASHIER', null))).toThrow('store assignment');
  expect(() => assertOwnsRecord(actor('CASHIER', null), null)).toThrow('access');
});
test('a previously issued admin token uses the current cashier role', async () => {
  (verifyToken as jest.Mock).mockReturnValue({ userId: 'actor', role: 'ADMIN', sessionId: 'session' });
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ role: 'CASHIER', locationId: 'store-a', isActive: true, email: 'cashier@example.com', refreshTokens: [{ id: 'session' }] });
  const req = { headers: { authorization: 'Bearer old-token' } } as AuthRequest;
  const next = jest.fn();
  await authenticate(req, {} as any, next);
  expect(next).toHaveBeenCalledWith();
  expect(req.user?.role).toBe('CASHIER');
});
