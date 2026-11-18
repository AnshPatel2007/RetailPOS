import { assertSeedAllowed } from '../utils/seedGuard';

describe('demo seed guard', () => {
  it('fills an empty database, whatever it is called', () => {
    expect(() => assertSeedAllowed('pos_system', { stores: 0, users: 0 })).not.toThrow();
  });
  it('refuses a database that already has a store or a user', () => {
    expect(() => assertSeedAllowed('pos_system', { stores: 1, users: 4 })).toThrow('Refusing to seed "pos_system": it already holds 1 store and 4 users.');
    expect(() => assertSeedAllowed('neondb', { stores: 0, users: 1 })).toThrow('0 stores and 1 user');
    // A name that merely contains "test" is not a disposable test database.
    expect(() => assertSeedAllowed('pos_test_backup', { stores: 2, users: 9 })).toThrow('Refusing to seed');
  });
  it('still reseeds the disposable test databases', () => {
    for (const name of ['pos_system_reliability_test', 'pos_system_reliability_e2e', 'pos_system_performance_v2_benchmark']) {
      expect(() => assertSeedAllowed(name, { stores: 3, users: 12 })).not.toThrow();
    }
  });
});
