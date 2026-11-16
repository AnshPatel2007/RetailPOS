/**
 * Request budgets: one per signed-in person (several registers behind a store's
 * router must not share one), and the caller's real address behind a hosting proxy.
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import request from 'supertest';
import { Request } from 'express';
import { requestBudgetKey, signInAttemptKey, trustProxySetting } from '../middleware/rateLimitKeys';
import { generateToken } from '../utils/jwt';

const call = (authorization: string | undefined, ip = '203.0.113.7') =>
  requestBudgetKey({ headers: authorization ? { authorization } : {}, ip } as unknown as Request);
const token = (userId: string) => generateToken({ userId, sessionId: 'session-' + userId, email: userId + '@test.com', role: 'CASHIER' });

describe('request budget keys', () => {
  it('gives each signed-in person their own budget, whatever address they share', () => {
    const first = call('Bearer ' + token('cashier-1')), second = call('Bearer ' + token('cashier-2'));
    expect(first).toBe('user:cashier-1');
    expect(second).toBe('user:cashier-2');
    // The same person on another register (another address) is still one budget.
    expect(call('Bearer ' + token('cashier-1'), '198.51.100.9')).toBe(first);
  });

  it('falls back to the address for signed-out callers and tokens this server did not sign', () => {
    expect(call(undefined)).toBe('ip:203.0.113.7');
    expect(call('Bearer not-a-real-token')).toBe('ip:203.0.113.7');
    expect(call('Basic abc')).toBe('ip:203.0.113.7');
    // A forged token cannot buy a fresh budget.
    const forged = token('cashier-1').slice(0, -4) + 'AAAA';
    expect(call('Bearer ' + forged)).toBe('ip:203.0.113.7');
  });

  it('trusts one proxy hop in production, none elsewhere, and honours TRUST_PROXY', () => {
    expect(trustProxySetting(undefined, 'production')).toBe(1);
    expect(trustProxySetting('', 'production')).toBe(1);
    expect(trustProxySetting(undefined, 'development')).toBe(false);
    expect(trustProxySetting(undefined, 'test')).toBe(false);
    expect(trustProxySetting('2', 'production')).toBe(2);
    expect(trustProxySetting('false', 'production')).toBe(false);
    expect(trustProxySetting('true', 'development')).toBe(true);
    expect(trustProxySetting('loopback', 'development')).toBe('loopback');
  });

  it('reads the forwarded address only when the proxy is trusted', async () => {
    const build = (setting: number | boolean | string) => {
      const app = express();
      app.set('trust proxy', setting);
      app.get('/key', (req, res) => { res.json({ key: requestBudgetKey(req) }); });
      return app;
    };
    const behindProxy = await request(build(trustProxySetting(undefined, 'production'))).get('/key').set('X-Forwarded-For', '203.0.113.50');
    expect(behindProxy.body.key).toBe('ip:203.0.113.50');
    // Without a trusted proxy the header is ignored: a caller cannot pick their own address.
    const direct = await request(build(trustProxySetting(undefined, 'development'))).get('/key').set('X-Forwarded-For', '203.0.113.50');
    expect(direct.body.key).not.toBe('ip:203.0.113.50');
  });

  it('limits each person and each signed-out address separately behind one proxy, without limiter warnings', async () => {
    const warnings = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = express();
    app.set('trust proxy', trustProxySetting(undefined, 'production'));
    app.use(rateLimit({ windowMs: 60_000, max: 2, keyGenerator: requestBudgetKey, standardHeaders: true, legacyHeaders: false }));
    app.get('/ping', (_req, res) => { res.json({ ok: true }); });
    const as = (userId: string) => request(app).get('/ping').set('Authorization', 'Bearer ' + token(userId)).set('X-Forwarded-For', '203.0.113.50');
    // Two registers in one store (one public address): each cashier has a budget of their own.
    expect((await as('cashier-1')).status).toBe(200);
    expect((await as('cashier-1')).status).toBe(200);
    expect((await as('cashier-1')).status).toBe(429);
    expect((await as('cashier-2')).status).toBe(200);
    // Signed-out callers are limited by their own forwarded address, not the proxy's.
    const from = (address: string) => request(app).get('/ping').set('X-Forwarded-For', address);
    expect((await from('198.51.100.1')).status).toBe(200);
    expect((await from('198.51.100.1')).status).toBe(200);
    expect((await from('198.51.100.1')).status).toBe(429);
    expect((await from('198.51.100.2')).status).toBe(200);
    expect(warnings).not.toHaveBeenCalled();
    warnings.mockRestore();
  });

  it('counts wrong passwords per person at an address, so one person does not lock the whole store out', async () => {
    const warnings = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = express();
    app.set('trust proxy', trustProxySetting(undefined, 'production'));
    // As in server.ts: the sign-in body is read before the limiter that counts per person.
    app.use('/login', express.json({ limit: '10kb' }), rateLimit({ windowMs: 60_000, max: 2, keyGenerator: signInAttemptKey, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false }));
    app.post('/login', (req, res) => { res.status(req.body.password === 'right' ? 200 : 401).json({}); });
    const signIn = (email: string, password = 'wrong', address = '203.0.113.50') =>
      request(app).post('/login').set('X-Forwarded-For', address).send({ email, password });
    expect((await signIn('sam@store.test')).status).toBe(401);
    expect((await signIn(' Sam@Store.Test ')).status).toBe(401); // the same person, however the email is typed
    expect((await signIn('sam@store.test')).status).toBe(429);
    // A co-worker at the same store address still signs in, and a right password is never counted.
    expect((await signIn('maria@store.test', 'right')).status).toBe(200);
    expect((await signIn('maria@store.test', 'right')).status).toBe(200);
    expect((await signIn('maria@store.test', 'right')).status).toBe(200);
    // The same email from somewhere else has its own count.
    expect((await signIn('sam@store.test', 'wrong', '198.51.100.9')).status).toBe(401);
    expect(warnings).not.toHaveBeenCalled();
    warnings.mockRestore();
  });
});
