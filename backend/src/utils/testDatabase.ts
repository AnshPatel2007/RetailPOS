/** Refuse destructive fixtures unless their target is explicitly disposable. */
export function assertDisposableDatabase(url: string | undefined, operationalUrl?: string): string {
  if (!url) throw new Error('A dedicated test database URL is required');
  const target = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(target.protocol)) throw new Error('Tests require PostgreSQL');
  const name = decodeURIComponent(target.pathname.slice(1));
  if (!/^[a-zA-Z0-9_]+_(test|e2e|benchmark)$/.test(name)) {
    throw new Error('Refusing database cleanup: database name must end in _test, _e2e, or _benchmark');
  }
  if (operationalUrl) {
    const operational = new URL(operationalUrl);
    if (target.hostname === operational.hostname && (target.port || '5432') === (operational.port || '5432') && target.pathname === operational.pathname) {
      throw new Error('Refusing database cleanup: test and operational databases are identical');
    }
  }
  return target.toString();
}
