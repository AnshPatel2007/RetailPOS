import { PrismaClient } from '@prisma/client';
import { assertDisposableDatabase } from '../utils/testDatabase';

// Create a test prisma client
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: assertDisposableDatabase(process.env.DATABASE_URL_TEST, process.env.DATABASE_URL),
    },
  },
});

// Mock logger to prevent console output during tests
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock email utility to prevent actual emails
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  send2FAEnabledEmail: jest.fn().mockResolvedValue(undefined),
  sendAccountLockoutEmail: jest.fn().mockResolvedValue(undefined),
}));

// Global setup
beforeAll(async () => {
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-key-for-jwt-min-32-chars';
  process.env.JWT_EXPIRES_IN = '1h';
});

// Cleanup after all tests
afterAll(async () => {
  await prisma.$disconnect();
});

// Export for use in tests
export { prisma };
