import { PrismaClient } from '@prisma/client';
import { assertDisposableDatabase } from '../utils/testDatabase';

/**
 * Resolve the database URL. Under NODE_ENV=test the app must NEVER touch the
 * real database (integration tests truncate tables), so we use
 * DATABASE_URL_TEST or derive "<dbname>_test" from DATABASE_URL.
 */
export const resolveDatabaseUrl = (): string | undefined => {
  if (process.env.NODE_ENV === 'test') {
    if (process.env.DATABASE_URL_TEST) return assertDisposableDatabase(process.env.DATABASE_URL_TEST, process.env.DATABASE_URL);
    if (process.env.DATABASE_URL) {
      const url = new URL(process.env.DATABASE_URL);
      url.pathname += '_test';
      return assertDisposableDatabase(url.toString(), process.env.DATABASE_URL);
    }
    throw new Error('Tests require DATABASE_URL_TEST or a development DATABASE_URL');
  }
  return process.env.DATABASE_URL;
};

// Create a singleton instance of PrismaClient
const prisma = new PrismaClient({
  datasources: { db: { url: resolveDatabaseUrl() } },
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// Handle cleanup on shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export default prisma;
