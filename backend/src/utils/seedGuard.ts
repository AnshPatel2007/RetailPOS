import { assertDisposableDatabase } from './testDatabase';

const count = (value: number, one: string) => `${value} ${value === 1 ? one : one + 's'}`;

/**
 * The demo seed (prisma/seed.ts) adds a store and four accounts whose passwords
 * are printed in SETUP.md. It may only fill an empty database, or a disposable
 * test database (a name ending in _test, _e2e or _benchmark).
 *
 * backend/.env points at the store's own database: without this check,
 * `npm run db:seed` would add a platform administrator with a known password
 * to the store's records.
 */
export function assertSeedAllowed(databaseName: string, existing: { stores: number; users: number }): void {
  if (existing.stores === 0 && existing.users === 0) return;
  try {
    assertDisposableDatabase('postgresql://localhost/' + encodeURIComponent(databaseName));
    return;
  } catch { /* not a disposable test database: refuse below */ }
  throw new Error(`Refusing to seed "${databaseName}": it already holds ${count(existing.stores, 'store')} and ${count(existing.users, 'user')}. `
    + 'Demo data, with its published passwords, only goes into an empty database or a disposable test database (a name ending in _test, _e2e or _benchmark).');
}
