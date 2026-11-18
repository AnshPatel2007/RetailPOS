import { assertDisposableDatabase } from '../utils/testDatabase';

describe('disposable test database guard', () => {
  it('rejects operational and ambiguous database names', () => {
    for (const name of ['pos_system', 'production', 'test', 'pos_test_backup']) {
      expect(() => assertDisposableDatabase(`postgresql://localhost/${name}`)).toThrow();
    }
  });
  it('rejects the operational target even when its name has a test suffix', () => {
    expect(() => assertDisposableDatabase('postgresql://localhost/pos_test', 'postgresql://localhost:5432/pos_test')).toThrow('identical');
  });
  it('allows explicitly isolated fixture and benchmark databases', () => {
    for (const name of ['pos_test', 'pos_e2e', 'pos_benchmark']) {
      expect(assertDisposableDatabase(`postgresql://localhost/${name}`, 'postgresql://localhost/pos')).toContain(name);
    }
  });
});
