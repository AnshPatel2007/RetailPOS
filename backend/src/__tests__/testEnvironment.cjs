require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'isolated-test-secret-at-least-32-characters';
process.env.JWT_EXPIRES_IN = '1h';
if (!process.env.DATABASE_URL_TEST) {
  const url = new URL(process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/pos');
  url.pathname += '_test';
  process.env.DATABASE_URL_TEST = url.toString();
}
// Bound each test client's pool independently of the host CPU count. The API
// and fixture client both connect, alongside the isolated browser test server.
const testDatabase = new URL(process.env.DATABASE_URL_TEST);
if (!testDatabase.searchParams.has('connection_limit')) testDatabase.searchParams.set('connection_limit', '5');
process.env.DATABASE_URL_TEST = testDatabase.toString();
