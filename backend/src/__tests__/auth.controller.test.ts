import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import * as authController from '../controllers/auth.controller';
import prisma from '../config/database';
import { generateToken } from '../utils/jwt';
import { AuthRequest } from '../types';

// Mock Prisma
jest.mock('../config/database', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    activityLog: {
      create: jest.fn(),
    },
  },
}));

// Mock bcrypt
jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

// Mock JWT
jest.mock('../utils/jwt', () => ({
  generateToken: jest.fn(),
  generateRefreshToken: jest.fn(),
  verifyRefreshToken: jest.fn(),
}));

// Mock 2FA verification
jest.mock('../controllers/twoFactor.controller', () => ({
  verifyTOTPCode: jest.fn(),
}));

describe('Auth Controller', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockRequest = {
      body: {},
      params: {},
      headers: {},
      ip: '127.0.0.1',
      cookies: {},
    };

    mockResponse = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      cookie: jest.fn().mockReturnThis(),
      clearCookie: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('login', () => {
    const mockUser = {
      id: '123',
      email: 'test@example.com',
      password: 'hashedPassword',
      firstName: 'Test',
      lastName: 'User',
      role: 'CASHIER',
      isActive: true,
      twoFactorEnabled: false,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      location: null,
    };

    it('should login successfully with valid credentials', async () => {
      mockRequest.body = {
        email: 'test@example.com',
        password: 'password123',
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (generateToken as jest.Mock).mockReturnValue('access-token');
      (require('../utils/jwt').generateRefreshToken as jest.Mock).mockReturnValue('refresh-token');

      await authController.login(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
        include: { location: true },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith('password123', 'hashedPassword');
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            token: 'access-token',
            user: expect.objectContaining({
              email: 'test@example.com',
            }),
          }),
        })
      );
    });

    it('should return error for invalid email', async () => {
      mockRequest.body = {
        email: 'wrong@example.com',
        password: 'password123',
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await authController.login(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );
      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invalid credentials' })
      );
    });

    it('should return error for invalid password', async () => {
      mockRequest.body = {
        email: 'test@example.com',
        password: 'wrongpassword',
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await authController.login(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );
      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invalid credentials' })
      );
    });

    it('should return error for inactive user', async () => {
      mockRequest.body = {
        email: 'test@example.com',
        password: 'password123',
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        ...mockUser,
        isActive: false,
      });

      await authController.login(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );
      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invalid credentials' })
      );
    });

    it('should return error for locked account', async () => {
      mockRequest.body = {
        email: 'test@example.com',
        password: 'password123',
      };

      const lockedUser = {
        ...mockUser,
        lockoutUntil: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes from now
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(lockedUser);

      await authController.login(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );
      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringMatching(/Account is temporarily locked/) })
      );
    });

    it('should require 2FA code when 2FA is enabled', async () => {
      mockRequest.body = {
        email: 'test@example.com',
        password: 'password123',
      };

      const userWith2FA = {
        ...mockUser,
        twoFactorEnabled: true,
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(userWith2FA);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await authController.login(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          requiresTwoFactor: true,
        })
      );
    });
  });

  describe('getCurrentUser', () => {
    const mockUser = {
      id: '123',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      role: 'CASHIER',
      isActive: true,
      twoFactorEnabled: false,
      location: null,
      createdAt: new Date(),
      lastLoginAt: new Date(),
    };

    it('should return current user data', async () => {
      const authRequest = {
        ...mockRequest,
        user: { id: '123', email: 'test@example.com', role: 'CASHIER', locationId: null },
      } as AuthRequest;

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await authController.getCurrentUser(
        authRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            email: 'test@example.com',
          }),
        })
      );
    });

    it('should return error if user not authenticated', async () => {
      const authRequest = {
        ...mockRequest,
        user: undefined,
      } as AuthRequest;

      await authController.getCurrentUser(
          authRequest,
          mockResponse as Response,
          mockNext
        );
      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'User not authenticated' })
      );
    });
  });

  describe('register', () => {
    it('should register new user with valid data', async () => {
      mockRequest.body = {
        email: 'new@example.com',
        password: 'SecurePass123!',
        firstName: 'New',
        lastName: 'User',
        role: 'CASHIER',
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword');
      (prisma.user.create as jest.Mock).mockResolvedValue({
        id: '456',
        email: 'new@example.com',
        firstName: 'New',
        lastName: 'User',
        role: 'CASHIER',
        createdAt: new Date(),
      });

      await authController.register(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'User registered successfully',
        })
      );
    });

    it('should return error if user already exists', async () => {
      mockRequest.body = {
        email: 'existing@example.com',
        password: 'SecurePass123!',
        firstName: 'Existing',
        lastName: 'User',
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: '123' });

      await authController.register(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );
      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'User with this email already exists' })
      );
    });

    it('should validate password strength', async () => {
      mockRequest.body = {
        email: 'new@example.com',
        password: 'weak',
        firstName: 'New',
        lastName: 'User',
      };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await authController.register(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );
      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Password must be at least 8 characters long' })
      );
    });
  });

  describe('logout', () => {
    it('should logout successfully', async () => {
      const authRequest = {
        ...mockRequest,
        user: { id: '123', email: 'test@example.com', role: 'CASHIER', locationId: null },
        cookies: { refreshToken: 'refresh-token' },
      } as AuthRequest;

      (prisma.refreshToken.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.activityLog.create as jest.Mock).mockResolvedValue({});

      await authController.logout(
        authRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.clearCookie).toHaveBeenCalledWith('refreshToken');
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Logged out successfully',
        })
      );
    });
  });

  describe('logoutAll', () => {
    it('should logout from all devices', async () => {
      const authRequest = {
        ...mockRequest,
        user: { id: '123', email: 'test@example.com', role: 'CASHIER', locationId: null },
      } as AuthRequest;

      (prisma.refreshToken.updateMany as jest.Mock).mockResolvedValue({ count: 3 });
      (prisma.activityLog.create as jest.Mock).mockResolvedValue({});

      await authController.logoutAll(
        authRequest,
        mockResponse as Response,
        mockNext
      );

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: '123' },
        data: { isRevoked: true },
      });
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Logged out from all devices successfully',
        })
      );
    });
  });

  describe('forgotPassword', () => {
    it('should send password reset email', async () => {
      mockRequest.body = { email: 'test@example.com' };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: '123',
        email: 'test@example.com',
        firstName: 'Test',
      });
      (prisma.user.update as jest.Mock).mockResolvedValue({});

      await authController.forgotPassword(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'If an account exists with this email, a password reset link has been sent.',
        })
      );
    });

    it('should not reveal if email does not exist', async () => {
      mockRequest.body = { email: 'nonexistent@example.com' };

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await authController.forgotPassword(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Should return same message to prevent email enumeration
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'If an account exists with this email, a password reset link has been sent.',
        })
      );
    });
  });

  describe('changePassword', () => {
    it('should change password successfully', async () => {
      const authRequest = {
        ...mockRequest,
        user: { id: '123', email: 'test@example.com', role: 'CASHIER', locationId: null },
        body: {
          currentPassword: 'OldPass123!',
          newPassword: 'NewPass456!',
        },
      } as AuthRequest;

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: '123',
        email: 'test@example.com',
        password: 'hashedOldPassword',
      });
      (bcrypt.compare as jest.Mock)
        .mockResolvedValueOnce(true)  // Current password matches
        .mockResolvedValueOnce(false); // New password is different
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashedNewPassword');
      (prisma.user.update as jest.Mock).mockResolvedValue({});
      (prisma.activityLog.create as jest.Mock).mockResolvedValue({});

      await authController.changePassword(
        authRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Password changed successfully',
        })
      );
    });

    it('should reject if current password is incorrect', async () => {
      const authRequest = {
        ...mockRequest,
        user: { id: '123', email: 'test@example.com', role: 'CASHIER', locationId: null },
        body: {
          currentPassword: 'WrongPass123!',
          newPassword: 'NewPass456!',
        },
      } as AuthRequest;

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: '123',
        password: 'hashedOldPassword',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await authController.changePassword(
          authRequest,
          mockResponse as Response,
          mockNext
        );
      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Current password is incorrect' })
      );
    });
  });
});
