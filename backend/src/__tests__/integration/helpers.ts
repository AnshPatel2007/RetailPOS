/**
 * Integration Test Helpers
 *
 * Helper utilities for integration testing:
 * - API request helpers
 * - Authentication helpers
 * - Response assertion helpers
 */

import request from 'supertest';
import app from '../../server';
import jwt from 'jsonwebtoken';
import { config } from '../../config';

/**
 * Create JWT token for testing
 */
export function createTestToken(userId: string, role: string, locationId: string): string {
  return jwt.sign(
    {
      userId,
      role,
      locationId,
    },
    config.jwtSecret,
    { expiresIn: '1h' }
  );
}

/**
 * API Request Builder
 * Provides fluent interface for making authenticated API requests
 */
export class ApiRequest {
  private req: request.Test;

  constructor(method: 'get' | 'post' | 'put' | 'delete' | 'patch', path: string) {
    this.req = request(app)[method](path);
  }

  /**
   * Add authentication token
   */
  withAuth(token: string): this {
    this.req = this.req.set('Authorization', `Bearer ${token}`);
    return this;
  }

  /**
   * Add request body
   */
  withBody(body: any): this {
    this.req = this.req.send(body);
    return this;
  }

  /**
   * Add query parameters
   */
  withQuery(query: any): this {
    this.req = this.req.query(query);
    return this;
  }

  /**
   * Expect specific status code
   */
  expectStatus(status: number): this {
    this.req = this.req.expect(status);
    return this;
  }

  /**
   * Execute request and return response
   */
  async execute(): Promise<request.Response> {
    return await this.req;
  }

  /**
   * Execute and expect success
   */
  async expectSuccess(): Promise<request.Response> {
    const res = await this.req.expect(200);
    expect(res.body.success).toBe(true);
    return res;
  }

  /**
   * Execute and expect error
   */
  async expectError(status: number): Promise<request.Response> {
    const res = await this.req.expect(status);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    return res;
  }
}

/**
 * Helper functions for common request patterns
 */
export const api = {
  get: (path: string) => new ApiRequest('get', path),
  post: (path: string) => new ApiRequest('post', path),
  put: (path: string) => new ApiRequest('put', path),
  delete: (path: string) => new ApiRequest('delete', path),
  patch: (path: string) => new ApiRequest('patch', path),
};

/**
 * Login helper - performs login and returns token
 */
export async function loginUser(email: string, password: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);

  expect(res.body.success).toBe(true);
  expect(res.body.data.token).toBeDefined();

  return res.body.data.token;
}

/**
 * Response assertion helpers
 */
export const assertResponse = {
  /**
   * Assert successful response with data
   */
  success: (res: request.Response, dataChecks?: (data: any) => void) => {
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    if (dataChecks) {
      dataChecks(res.body.data);
    }
  },

  /**
   * Assert error response
   */
  error: (res: request.Response, expectedMessage?: string) => {
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    if (expectedMessage) {
      expect(res.body.error).toContain(expectedMessage);
    }
  },

  /**
   * Assert validation error
   */
  validationError: (res: request.Response) => {
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    expect(res.body.errors).toBeDefined();
    expect(Array.isArray(res.body.errors)).toBe(true);
  },

  /**
   * Assert unauthorized
   */
  unauthorized: (res: request.Response) => {
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  },

  /**
   * Assert forbidden
   */
  forbidden: (res: request.Response) => {
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  },

  /**
   * Assert not found
   */
  notFound: (res: request.Response) => {
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  },

  /**
   * Assert pagination response
   */
  paginated: (res: request.Response, checks?: {
    minItems?: number;
    maxItems?: number;
    hasData?: boolean;
  }) => {
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);

    if (checks?.minItems !== undefined) {
      expect(res.body.data.length).toBeGreaterThanOrEqual(checks.minItems);
    }

    if (checks?.maxItems !== undefined) {
      expect(res.body.data.length).toBeLessThanOrEqual(checks.maxItems);
    }

    if (checks?.hasData) {
      expect(res.body.data.length).toBeGreaterThan(0);
    }
  },
};

/**
 * Database assertion helpers
 */
export const assertDatabase = {
  /**
   * Assert record exists
   */
  exists: async (model: any, where: any) => {
    const record = await model.findFirst({ where });
    expect(record).toBeDefined();
    expect(record).not.toBeNull();
    return record;
  },

  /**
   * Assert record does not exist
   */
  notExists: async (model: any, where: any) => {
    const record = await model.findFirst({ where });
    expect(record).toBeNull();
  },

  /**
   * Assert record count
   */
  count: async (model: any, where: any, expectedCount: number) => {
    const count = await model.count({ where });
    expect(count).toBe(expectedCount);
  },
};
