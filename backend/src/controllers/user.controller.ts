import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import bcrypt from 'bcryptjs';
import { invalidateUserCache } from '../middleware/auth';
import { asyncHandler, AppError } from '../utils/errorHandler';

// Get all users (super-admin sees all, admin sees their location)
export const getAllUsers = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { locationId, role, isActive, search } = req.query;

  const where: any = {};

  // Filter by location
  if (locationId) {
    where.locationId = locationId;
  } else if (req.user?.role !== 'SUPER_ADMIN') {
    // Non-super-admins can only see users from their location
    where.locationId = req.user?.locationId;
  }

  // Filter by role
  if (role) {
    where.role = role;
  }

  // Filter by active status
  if (isActive !== undefined) {
    where.isActive = isActive === 'true';
  }

  // Search
  if (search) {
    where.OR = [
      { firstName: { contains: search as string, mode: 'insensitive' } },
      { lastName: { contains: search as string, mode: 'insensitive' } },
      { email: { contains: search as string, mode: 'insensitive' } },
    ];
  }

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      isActive: true,
      locationId: true,
      createdAt: true,
      lastLoginAt: true,
      location: {
        select: {
          id: true,
          name: true,
        },
      },
      _count: {
        select: {
          sales: true,
          shifts: true,
        },
      },
    },
    orderBy: [{ isActive: 'desc' }, { lastName: 'asc' }],
  });

  res.json({ success: true, data: users });
});

// Create new user
export const createUser = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { firstName, lastName, email, password, role, locationId } = req.body;

  // Validate required fields
  if (!firstName || !lastName || !email || !password) {
    throw new AppError('Missing required fields: firstName, lastName, email, password', 400);
  }

  // Check password length
  if (password.length < 6) {
    throw new AppError('Password must be at least 6 characters', 400);
  }

  // Check if email already exists
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new AppError('Email already in use', 400);
  }

  // Only super-admin can create users for any location
  // Admin can only create users for their own location
  if (req.user?.role !== 'SUPER_ADMIN') {
    if (locationId && locationId !== req.user?.locationId) {
      throw new AppError('You can only create users for your own location', 403);
    }
  }

  // Only super-admin can create super-admin or admin users
  if ((role === 'SUPER_ADMIN' || role === 'ADMIN') && req.user?.role !== 'SUPER_ADMIN') {
    throw new AppError('Only super-admin can create admin users', 403);
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      firstName,
      lastName,
      email,
      password: hashedPassword,
      role: role || 'CASHIER',
      locationId: locationId || req.user?.locationId || null,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      isActive: true,
      locationId: true,
      location: {
        select: { name: true },
      },
    },
  });

  res.status(201).json({ success: true, data: user });
});

// Get user by ID
export const getUserById = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      isActive: true,
      locationId: true,
      createdAt: true,
      lastLoginAt: true,
      location: {
        select: {
          id: true,
          name: true,
        },
      },
      _count: {
        select: {
          sales: true,
          shifts: true,
        },
      },
    },
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Non-super-admins can only view users from their location
  if (req.user?.role !== 'SUPER_ADMIN' && user.locationId !== req.user?.locationId) {
    throw new AppError('Access denied', 403);
  }

  // Get additional stats
  const [salesStats, recentSales, recentShifts] = await Promise.all([
    prisma.sale.aggregate({
      where: { userId: id },
      _sum: { total: true },
      _count: true,
    }),
    prisma.sale.findMany({
      where: { userId: id },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        saleNumber: true,
        total: true,
        createdAt: true,
      },
    }),
    prisma.shift.findMany({
      where: { userId: id },
      take: 5,
      orderBy: { clockInAt: 'desc' },
      select: {
        id: true,
        clockInAt: true,
        clockOutAt: true,
        totalSales: true,
      },
    }),
  ]);

  res.json({
    success: true,
    data: {
      ...user,
      totalSales: salesStats._sum.total || 0,
      transactionCount: salesStats._count,
      recentSales,
      recentShifts,
    },
  });
});

// Update user
export const updateUser = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { firstName, lastName, email, role, locationId, isActive } = req.body;

  // Check if user exists
  const existingUser = await prisma.user.findUnique({ where: { id } });
  if (!existingUser) {
    throw new AppError('User not found', 404);
  }

  // Non-super-admins can only update users from their location
  if (req.user?.role !== 'SUPER_ADMIN' && existingUser.locationId !== req.user?.locationId) {
    throw new AppError('Access denied', 403);
  }

  // Prevent changing super-admin role unless you're a super-admin
  if (existingUser.role === 'SUPER_ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
    throw new AppError('Cannot modify super-admin', 403);
  }

  // Check if email is taken by another user
  if (email && email !== existingUser.email) {
    const emailExists = await prisma.user.findUnique({ where: { email } });
    if (emailExists) {
      throw new AppError('Email already in use', 400);
    }
  }

  const user = await prisma.user.update({
    where: { id },
    data: {
      firstName,
      lastName,
      email,
      role,
      locationId,
      isActive,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      isActive: true,
      locationId: true,
      location: {
        select: { name: true },
      },
    },
  });

  invalidateUserCache(id);
  res.json({ success: true, data: user });
});

// Reset user password
export const resetUserPassword = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 6) {
    throw new AppError('Password must be at least 6 characters', 400);
  }

  // Check if user exists
  const existingUser = await prisma.user.findUnique({ where: { id } });
  if (!existingUser) {
    throw new AppError('User not found', 404);
  }

  // Non-super-admins can only reset passwords for their location
  if (req.user?.role !== 'SUPER_ADMIN' && existingUser.locationId !== req.user?.locationId) {
    throw new AppError('Access denied', 403);
  }

  // Prevent resetting super-admin password unless you're a super-admin
  if (existingUser.role === 'SUPER_ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
    throw new AppError('Cannot modify super-admin', 403);
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  await prisma.user.update({
    where: { id },
    data: { password: hashedPassword },
  });

  res.json({ success: true, message: 'Password reset successfully' });
});

// Delete (deactivate) user
export const deleteUser = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  // Check if user exists
  const existingUser = await prisma.user.findUnique({ where: { id } });
  if (!existingUser) {
    throw new AppError('User not found', 404);
  }

  // Cannot delete yourself
  if (id === req.user?.id) {
    throw new AppError('Cannot delete yourself', 400);
  }

  // Non-super-admins can only delete users from their location
  if (req.user?.role !== 'SUPER_ADMIN' && existingUser.locationId !== req.user?.locationId) {
    throw new AppError('Access denied', 403);
  }

  // Prevent deleting super-admin unless you're a super-admin
  if (existingUser.role === 'SUPER_ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
    throw new AppError('Cannot delete super-admin', 403);
  }

  // Check for active shift
  const activeShift = await prisma.shift.findFirst({
    where: { userId: id, clockOutAt: null },
  });

  if (activeShift) {
    throw new AppError('User has an active shift. Clock out first.', 400);
  }

  // Soft delete
  await prisma.user.update({
    where: { id },
    data: { isActive: false },
  });

  invalidateUserCache(id);
  res.json({ success: true, message: 'User deactivated' });
});

// Get user performance stats
export const getUserPerformance = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { period = '30' } = req.query;

  const daysAgo = new Date();
  daysAgo.setDate(daysAgo.getDate() - parseInt(period as string));

  const [salesByDay, shiftsStats] = await Promise.all([
    // Sales by day
    prisma.sale.groupBy({
      by: ['createdAt'],
      where: {
        userId: id,
        createdAt: { gte: daysAgo },
      },
      _sum: { total: true },
      _count: true,
    }),
    // Shift stats
    prisma.shift.aggregate({
      where: {
        userId: id,
        clockInAt: { gte: daysAgo },
      },
      _sum: { totalSales: true },
      _count: true,
    }),
  ]);

  res.json({
    success: true,
    data: {
      salesByDay,
      totalShifts: shiftsStats._count,
      totalSalesInShifts: shiftsStats._sum.totalSales || 0,
    },
  });
});

// Get current user's profile
export const getProfile = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    throw new AppError('Unauthorized', 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      locationId: true,
      isActive: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  res.json({ success: true, data: user });
});

// Update current user's profile
export const updateProfile = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { firstName, lastName, email } = req.body;

  if (!userId) {
    throw new AppError('Unauthorized', 401);
  }

  // Validation
  if (!firstName || !lastName || !email) {
    throw new AppError('First name, last name, and email are required', 400);
  }

  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new AppError('Invalid email format', 400);
  }

  // Check if email is already in use by another user
  if (email !== req.user?.email) {
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser && existingUser.id !== userId) {
      throw new AppError('Email is already in use', 400);
    }
  }

  // Update user
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      firstName,
      lastName,
      email,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      locationId: true,
      isActive: true,
      createdAt: true,
    },
  });

  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: updatedUser,
  });
});

// Change current user's password
export const changePassword = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { currentPassword, newPassword, confirmPassword } = req.body;

  if (!userId) {
    throw new AppError('Unauthorized', 401);
  }

  // Validation
  if (!currentPassword || !newPassword || !confirmPassword) {
    throw new AppError('All password fields are required', 400);
  }

  if (newPassword !== confirmPassword) {
    throw new AppError('New passwords do not match', 400);
  }

  if (newPassword.length < 6) {
    throw new AppError('Password must be at least 6 characters', 400);
  }

  // Get current user with password
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Verify current password
  const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
  if (!isPasswordValid) {
    throw new AppError('Current password is incorrect', 400);
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, 10);

  // Update password
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashedPassword },
  });

  res.json({
    success: true,
    message: 'Password changed successfully',
  });
});
