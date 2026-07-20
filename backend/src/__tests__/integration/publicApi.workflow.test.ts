/**
 * Public API & Webhooks Integration Tests
 *
 * API-key lifecycle (create → use → revoke), read-only v1 endpoints, webhook
 * CRUD + signature helper, and sale resilience when a webhook endpoint is dead.
 */

import { randomUUID } from 'crypto';
import crypto from 'crypto';
import request from 'supertest';
import app from '../../server';
import { seedTestData, TestData } from './setup';
import { api, loginUser } from './helpers';
import { signWebhookPayload } from '../../services/webhook.service';

describe('Public API & Webhooks Integration Tests', () => {
  let testData: TestData;
  let adminToken: string;
  let cashierToken: string;

  beforeEach(async () => {
    testData = await seedTestData();
    adminToken = await loginUser('admin@test.com', 'Admin123!');
    cashierToken = await loginUser('cashier@test.com', 'Admin123!');
  });

  const createKey = async (): Promise<string> => {
    const res = await api
      .post('/api/developer/api-keys')
      .withAuth(adminToken)
      .withBody({ name: 'Test integration' })
      .expectStatus(201)
      .execute();
    return res.body.data.key;
  };

  describe('API keys', () => {
    it('should authenticate v1 requests with a valid key', async () => {
      const key = await createKey();

      const res = await request(app)
        .get('/api/v1/products')
        .set('X-API-Key', key)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.find((p: any) => p.id === testData.product.id)).toBeDefined();
      // Public surface must not leak internal fields
      expect(res.body.data[0].locationId).toBeUndefined();
    });

    it('should reject missing and invalid keys', async () => {
      await request(app).get('/api/v1/products').expect(401);
      await request(app).get('/api/v1/products').set('X-API-Key', 'pos_deadbeef').expect(401);
    });

    it('should reject revoked keys', async () => {
      const key = await createKey();
      const list = await api.get('/api/developer/api-keys').withAuth(adminToken).expectStatus(200).execute();
      const id = list.body.data[0].id;

      await api.delete(`/api/developer/api-keys/${id}`).withAuth(adminToken).expectStatus(200).execute();
      await request(app).get('/api/v1/products').set('X-API-Key', key).expect(401);
    });

    it('should keep key management admin-only', async () => {
      await api
        .post('/api/developer/api-keys')
        .withAuth(cashierToken)
        .withBody({ name: 'Nope' })
        .expectStatus(403)
        .execute();
    });

    it('should serve the summary endpoint', async () => {
      const key = await createKey();
      const res = await request(app).get('/api/v1/summary').set('X-API-Key', key).expect(200);
      expect(res.body.data).toHaveProperty('netRevenue');
      expect(res.body.data).toHaveProperty('transactions');
      expect(res.body.data).toHaveProperty('lowStockProducts');
    });
  });

  describe('Webhooks', () => {
    it('should create, list, and validate endpoints', async () => {
      const created = await api
        .post('/api/developer/webhooks')
        .withAuth(adminToken)
        .withBody({ url: 'https://example.com/hook', events: ['sale.completed'] })
        .expectStatus(201)
        .execute();
      expect(created.body.data.secret).toMatch(/^whsec_/);

      const bad = await api
        .post('/api/developer/webhooks')
        .withAuth(adminToken)
        .withBody({ url: 'https://example.com/hook', events: ['not.an.event'] })
        .expectStatus(400)
        .execute();
      expect(bad.body.success).toBe(false);

      const list = await api.get('/api/developer/webhooks').withAuth(adminToken).expectStatus(200).execute();
      expect(list.body.data).toHaveLength(1);
      // Secrets are never returned after creation
      expect(list.body.data[0].secret).toBeUndefined();
      expect(list.body.availableEvents).toContain('product.low_stock');
    });

    it('should produce verifiable HMAC signatures', () => {
      const secret = 'whsec_testsecret';
      const body = JSON.stringify({ event: 'sale.completed', data: { total: 21.99 } });
      const signature = signWebhookPayload(secret, body);

      const expected =
        'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
      expect(signature).toBe(expected);
      expect(signWebhookPayload('whsec_other', body)).not.toBe(signature);
    });

    it('should not break sales when a webhook endpoint is unreachable', async () => {
      // Dead endpoint on a closed local port
      await api
        .post('/api/developer/webhooks')
        .withAuth(adminToken)
        .withBody({ url: 'http://127.0.0.1:59999/hook', events: ['sale.completed'] })
        .expectStatus(201)
        .execute();

      await api
        .post('/api/shifts/clock-in')
        .withAuth(cashierToken)
        .withBody({ startingCash: 100 })
        .expectStatus(201)
        .execute();

      // The sale must succeed regardless of webhook delivery failing
      await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody({
          idempotencyKey: randomUUID(),
          items: [{ productId: testData.product.id, quantity: 1, price: 19.99 }],
          paymentMethod: 'CASH',
          amountPaid: 25,
        })
        .expectStatus(201)
        .execute();
    });
  });
});
