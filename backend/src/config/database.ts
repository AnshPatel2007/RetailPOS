import { PrismaClient } from '@prisma/client';

/**
 * Resolve the database URL. Under NODE_ENV=test the app must NEVER touch the
 * real database (integration tests truncate tables), so we use
 * DATABASE_URL_TEST or derive "<dbname>_test" from DATABASE_URL.
 */
export const resolveDatabaseUrl = (): string | undefined => {
  if (process.env.NODE_ENV === 'test') {
    if (process.env.DATABASE_URL_TEST) return process.env.DATABASE_URL_TEST;
    if (process.env.DATABASE_URL) {
      return process.env.DATABASE_URL.replace(/\/([^/?]+)(\?|$)/, '/$1_test$2');
    }
    return undefined;
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
