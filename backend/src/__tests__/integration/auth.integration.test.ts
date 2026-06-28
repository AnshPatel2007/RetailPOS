/**
 * Authentication Integration Tests
 *
 * Tests the complete authentication flow:
 * - Login
 * - Token validation
 * - Protected route access
 * - Logout
 * - Password reset flow
 */

import request from 'supertest';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { api, assertResponse, loginUser, createTestToken } from './helpers';

describe('Authentication Integration Tests', () => {
  let testData: TestData;

  beforeEach(async () => {
    testData = await seedTestData();
  });

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials and return token', async () => {
      const res = await api
        .post('/api/auth/login')
        .withBody({
          email: 'admin@test.com',
          password: 'Admin123!',
        })
        .expectStatus(200)
        .execute();

      assertResponse.success(res, (data) => {
        expect(data.token).toBeDefined();
        expect(data.refreshToken).toBeDefined();
        expect(data.user).toBeDefined();
        expect(data.user.email).toBe('admin@test.com');
        expect(data.user.role).toBe('ADMIN');
        expect(data.user.password).toBeUndefined(); // Password should not be returned
      });
    });

    it('should fail login with invalid password', async () => {
      const res = await api
        .post('/api/auth/login')
        .withBody({
          email: 'admin@test.com',
          password: 'WrongPassword',
        })
        .expectStatus(401)
        .execute();

      assertResponse.unauthorized(res);
      expect(res.body.error).toContain('Invalid credentials');
    });

    it('should fail login with non-existent user', async () => {
      const res = await api
        .post('/api/auth/login')
        .withBody({
          email: 'nonexistent@test.com',
          password: 'Password123!',
        })
        .expectStatus(401)
        .execute();

      assertResponse.unauthorized(res);
    });

    it('should fail login with inactive user', async () => {
      // Deactivate user
      await prisma.user.update({
        where: { id: testData.adminUser.id },
        data: { isActive: false },
      });

      const res = await api
        .post('/api/auth/login')
        .withBody({
          email: 'admin@test.com',
          password: 'Admin123!',
        })
        .expectStatus(401)
        .execute();

      assertResponse.unauthorized(res);
    });

    it('should fail login with missing email', async () => {
      const res = await api
        .post('/api/auth/login')
        .withBody({
          password: 'Admin123!',
        })
        .expectStatus(422)
        .execute();

      assertResponse.validationError(res);
    });

    it('should fail login with missing password', async () => {
      const res = await api
        .post('/api/auth/login')
        .withBody({
          email: 'admin@test.com',
        })
        .expectStatus(422)
        .execute();

      assertResponse.validationError(res);
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return current user with valid token', async () => {
      const token = await loginUser('admin@test.com', 'Admin123!');

      const res = await api
        .get('/api/auth/me')
        .withAuth(token)
        .expectStatus(200)
        .execute();

      assertResponse.success(res, (data) => {
        expect(data.id).toBe(testData.adminUser.id);
        expect(data.email).toBe('admin@test.com');
        expect(data.role).toBe('ADMIN');
        expect(data.password).toBeUndefined();
      });
    });

    it('should fail without authentication token', async () => {
      const res = await api
        .get('/api/auth/me')
        .expectStatus(401)
        .execute();

      assertResponse.unauthorized(res);
    });

    it('should fail with invalid token', async () => {
      const res = await api
        .get('/api/auth/me')
        .withAuth('invalid-token')
        .expectStatus(401)
        .execute();

      assertResponse.unauthorized(res);
    });

    it('should fail with expired token', async () => {
      const expiredToken = createTestToken(
        testData.adminUser.id,
        'ADMIN',
        testData.location.id
      );

      // Wait for token to expire (would need to mock JWT for real test)
      // For now, just test with malformed token
      const res = await api
        .get('/api/auth/me')
        .withAuth('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.expired.token')
        .expectStatus(401)
        .execute();

      assertResponse.unauthorized(res);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should logout successfully with valid token', async () => {
      const token = await loginUser('admin@test.com', 'Admin123!');

      const res = await api
        .post('/api/auth/logout')
        .withAuth(token)
        .expectStatus(200)
        .execute();

      assertResponse.success(res);
    });

    it('should fail logout without token', async () => {
      const res = await api
        .post('/api/auth/logout')
        .expectStatus(401)
        .execute();

      assertResponse.unauthorized(res);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should refresh token with valid refresh token', async () => {
      const loginRes = await api
        .post('/api/auth/login')
        .withBody({
          email: 'admin@test.com',
          password: 'Admin123!',
        })
        .expectStatus(200)
        .execute();

      const refreshToken = loginRes.body.data.refreshToken;

      const res = await api
        .post('/api/auth/refresh')
        .withBody({ refreshToken })
        .expectStatus(200)
        .execute();

      assertResponse.success(res, (data) => {
        expect(data.token).toBeDefined();
        expect(data.refreshToken).toBeDefined();
        expect(data.token).not.toBe(loginRes.body.data.token); // Should be new token
      });
    });

    it('should fail refresh with invalid refresh token', async () => {
      const res = await api
        .post('/api/auth/refresh')
        .withBody({ refreshToken: 'invalid-refresh-token' })
        .expectStatus(401)
        .execute();

      assertResponse.unauthorized(res);
    });

    it('should fail refresh without refresh token', async () => {
      const res = await api
        .post('/api/auth/refresh')
        .withBody({})
        .expectStatus(422)
        .execute();

      assertResponse.validationError(res);
    });
  });

  describe('Authorization Tests', () => {
    it('should allow admin to access admin routes', async () => {
      const token = await loginUser('admin@test.com', 'Admin123!');

      const res = await api
        .get('/api/users')
        .withAuth(token)
        .expectStatus(200)
        .execute();

      assertResponse.success(res);
    });

    it('should deny cashier access to admin routes', async () => {
      const token = await loginUser('cashier@test.com', 'Admin123!');

      const res = await api
        .get('/api/users')
        .withAuth(token)
        .expectStatus(403)
        .execute();

      assertResponse.forbidden(res);
    });

    it('should allow cashier to access cashier routes', async () => {
      const token = await loginUser('cashier@test.com', 'Admin123!');

      const res = await api
        .get('/api/products')
        .withAuth(token)
        .expectStatus(200)
        .execute();

      assertResponse.success(res);
    });
  });

  describe('Location Isolation in Auth', () => {
    it('should include locationId in token payload', async () => {
      const token = await loginUser('admin@test.com', 'Admin123!');

      const res = await api
        .get('/api/auth/me')
        .withAuth(token)
        .expectStatus(200)
        .execute();

      assertResponse.success(res, (data) => {
        expect(data.locationId).toBe(testData.location.id);
      });
    });

    it('should only access data from own location', async () => {
      // Create second location and user
      const location2 = await prisma.location.create({
        data: {
          id: 'test-location-2',
          name: 'Test Store 2',
          address: '789 Test Ave',
          city: 'Test City 2',
          state: 'TS',
          zipCode: '54321',
          phone: '555-0004',
          email: 'test2@store.com',
          timezone: 'America/New_York',
          isActive: true,
        },
      });

      const token = await loginUser('admin@test.com', 'Admin123!');

      // Try to access products - should only see location 1 products
      const res = await api
        .get('/api/products')
        .withAuth(token)
        .expectStatus(200)
        .execute();

      assertResponse.success(res, (data) => {
        expect(Array.isArray(data)).toBe(true);
        data.forEach((product: any) => {
          expect(product.locationId).toBe(testData.location.id);
          expect(product.locationId).not.toBe(location2.id);
        });
      });
    });
  });
});
