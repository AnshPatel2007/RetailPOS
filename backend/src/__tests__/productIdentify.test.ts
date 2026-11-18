import { Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { emptyIdentity, productCatalog } from '../services/productCatalog.service';
import { identifyProduct, parseIdentificationInput } from '../controllers/productIdentify.controller';
import { authorize } from '../middleware/auth';

jest.mock('../config/database', () => ({ __esModule: true, default: { product: { findFirst: jest.fn() } } }));
jest.mock('@anthropic-ai/sdk', () => ({ __esModule: true, default: jest.fn() }));

const barcode = '012345678905';
const photo = 'data:image/png;base64,aW1hZ2U=';
const providerKey = process.env.ANTHROPIC_API_KEY;
const visionCreate = jest.fn();
function request(body: unknown, locationId: string | null = 'store-a'): AuthRequest {
  return { body, params: {}, query: {}, user: { id: 'owner-a', email: 'owner@example.test', role: 'ADMIN', locationId } } as AuthRequest;
}
async function invoke(req: AuthRequest) {
  const json = jest.fn();
  const next = jest.fn();
  await identifyProduct(req, { json } as unknown as Response, next);
  return { body: json.mock.calls[0]?.[0], next, json };
}

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  (prisma.product.findFirst as jest.Mock).mockResolvedValue(null);
  (Anthropic as unknown as jest.Mock).mockImplementation(() => ({ messages: { create: visionCreate } }));
});
afterAll(() => {
  if (providerKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = providerKey;
});

describe('identification input validation', () => {
  it('preserves leading zeros, trims scanner whitespace and keeps custom store barcodes', () => {
    expect(parseIdentificationInput({ barcode: '  012345678905  ' })).toEqual({ barcode, photo: undefined });
    expect(parseIdentificationInput({ barcode: 'STORE-SKU-1' }).barcode).toBe('STORE-SKU-1');
    expect(parseIdentificationInput({ image: photo }).photo).toEqual({ data: 'aW1hZ2U=', type: 'image/png' });
  });
  it.each([
    null, [], {}, { barcode: 12345678 }, { barcode: true }, { barcode: ' ' },
    { barcode: '1'.repeat(129) }, { barcode: 'ABC\u0000DEF' }, { barcode: 'ABC\nDEF' },
    { image: 12 }, { image: 'https://example.com/photo.png' }, { image: 'data:image/svg+xml;base64,aW1hZ2U=' },
    { image: 'aW1hZ2U=', mediaType: 'text/plain' }, { image: 'abc' }, { image: '!!!!' },
  ])('rejects invalid input before any provider is contacted (case %#)', body => {
    expect(() => parseIdentificationInput(body)).toThrow();
  });
  it('rejects unbounded uploads', () => {
    expect(() => parseIdentificationInput({ image: 'A'.repeat(7_000_104) })).toThrow(/5 MB/);
  });
});

describe('store-scoped identity controller', () => {
  it('derives a 21+ suggestion from verified alcohol categories rather than accepting arbitrary provider age fields', async () => {
    jest.spyOn(productCatalog, 'lookup').mockResolvedValue({ ...emptyIdentity('found'), found: true,
      name: 'Example Lager', category: 'Beers', categoryCandidates: ['Beers', 'Alcoholic beverages', 'Beverages'] });
    expect((await invoke(request({ barcode }))).body.data.ageRestriction).toMatchObject({ status: 'restricted', minimumAge: 21 });
  });

  it('keeps broad categories and uncertain alcohol-like products pending review', async () => {
    const lookup = jest.spyOn(productCatalog, 'lookup').mockResolvedValue({ ...emptyIdentity('found'), found: true,
      name: 'Root Beer', category: 'Food, Beverages & Tobacco' });
    expect((await invoke(request({ barcode }))).body.data.ageRestriction).toMatchObject({ status: 'unknown', minimumAge: null });
    lookup.mockResolvedValue({ ...emptyIdentity('found'), found: true, name: 'Example Non-Alcoholic Beer', category: 'Beers' });
    expect((await invoke(request({ barcode }))).body.data.ageRestriction).toMatchObject({ status: 'review', minimumAge: null });
  });

  it('offers new catalog images for a saved product while preserving its existing image', async () => {
    (prisma.product.findFirst as jest.Mock).mockResolvedValue({ id: 'product-a', name: 'My product', description: 'My description',
      image: 'https://store.example.com/mine.jpg', category: { name: 'Drinks' } });
    jest.spyOn(productCatalog, 'lookup').mockResolvedValue({ ...emptyIdentity('found'), found: true,
      name: 'Public product', image: 'https://cdn.example.com/new.jpg', imageStatus: 'catalog',
      imageCandidates: [{ url: 'https://cdn.example.com/new.jpg', source: 'UPCitemdb', kind: 'catalog' }] });
    const { body } = await invoke(request({ barcode }));
    expect(body.data.image).toBe('https://store.example.com/mine.jpg');
    expect(body.data.imageCandidates).toHaveLength(1);
  });
  it('reads only the authenticated store and returns identity without cost, price, stock or supplier fields', async () => {
    const lookup = jest.spyOn(productCatalog, 'lookup').mockResolvedValue(emptyIdentity('not_found'));
    (prisma.product.findFirst as jest.Mock).mockResolvedValue({ id: 'product-a', name: 'My coffee', description: 'Store label',
      image: 'https://cdn.example.com/coffee.jpg', category: { name: 'Beverages' }, cost: 4, price: 8, stockQuantity: 100,
      supplierId: 'supplier-secret', minimumAge: 21, ebtEligible: true, locationId: 'store-a' });
    const req = request({ barcode, locationId: 'store-b', price: 99 });
    req.query = { locationId: 'store-b' };
    const { body, next } = await invoke(req);
    expect(next).not.toHaveBeenCalled();
    expect(prisma.product.findFirst).toHaveBeenCalledWith({ where: { locationId: 'store-a', barcode },
      select: { id: true, name: true, description: true, image: true, category: { select: { name: true } } } });
    expect(body.data).toMatchObject({ found: true, status: 'found', existingProductId: 'product-a', name: 'My coffee', source: ['local_catalog'] });
    expect(body.message).toContain('already belongs');
    for (const key of ['cost', 'price', 'stockQuantity', 'supplierId', 'minimumAge', 'ebtEligible', 'locationId']) expect(body.data).not.toHaveProperty(key);
    expect(lookup).toHaveBeenCalledWith(barcode);
    expect(Anthropic).not.toHaveBeenCalled();
  });

  it('looks up the same barcode separately within each store without sharing local identities', async () => {
    const lookup = jest.spyOn(productCatalog, 'lookup').mockResolvedValue(emptyIdentity('not_found'));
    (prisma.product.findFirst as jest.Mock).mockImplementation(({ where }) => Promise.resolve(where.locationId === 'store-a'
      ? { id: 'product-a', name: 'Private store label', description: null, image: null, category: null } : null));
    expect((await invoke(request({ barcode }, 'store-a'))).body.data.name).toBe('Private store label');
    const second = await invoke(request({ barcode }, 'store-b'));
    expect(second.body.data).toMatchObject({ found: false, status: 'not_found', name: null });
    expect(second.body.data).not.toHaveProperty('existingProductId');
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('enriches missing local details without replacing the store name or exposing a record to another store', async () => {
    (prisma.product.findFirst as jest.Mock).mockResolvedValue({ id: 'local-a', name: 'My shelf name', description: null, image: null, category: null });
    jest.spyOn(productCatalog, 'lookup').mockResolvedValue({ ...emptyIdentity('found'), found: true,
      name: 'Public catalog name', brand: 'Public brand', size: '20 oz', description: 'Catalog description',
      image: 'https://cdn.example.com/cola.jpg', category: 'Soda', categoryCandidates: ['Soda', 'Beverages'], source: ['upcitemdb'] });
    const { body } = await invoke(request({ barcode }));
    expect(body.data).toMatchObject({ existingProductId: 'local-a', name: 'My shelf name', description: 'Catalog description',
      image: 'https://cdn.example.com/cola.jpg', category: 'Soda', missingFields: [], source: ['local_catalog', 'upcitemdb'] });
    expect(body.data.brand).toBeNull();
    expect(prisma.product.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { barcode, locationId: 'store-a' } }));
  });

  it('keeps local identity usable when missing-detail enrichment is unavailable', async () => {
    (prisma.product.findFirst as jest.Mock).mockResolvedValue({ id: 'local-a', name: 'My shelf name', description: null, image: null, category: null });
    jest.spyOn(productCatalog, 'lookup').mockResolvedValue({ ...emptyIdentity('unavailable'), retryAfterSeconds: 45 });
    const { body } = await invoke(request({ barcode }));
    expect(body.data).toMatchObject({ found: true, name: 'My shelf name', existingProductId: 'local-a', enrichmentUnavailable: true,
      retryAfterSeconds: 45, missingFields: ['description', 'category', 'image'] });
  });

  it('does not call paid vision for barcode-only misses even when a provider key exists', async () => {
    process.env.ANTHROPIC_API_KEY = 'unit-test-key';
    const lookup = jest.spyOn(productCatalog, 'lookup').mockResolvedValue(emptyIdentity('not_found'));
    const { body } = await invoke(request({ barcode }));
    expect(lookup).toHaveBeenCalledWith(barcode);
    expect(body.data.status).toBe('not_found');
    expect(body.message).toMatch(/manually/);
    expect(Anthropic).not.toHaveBeenCalled();
    expect(visionCreate).not.toHaveBeenCalled();
  });

  it('reports unavailable providers with their retry delay and retains the manual path', async () => {
    jest.spyOn(productCatalog, 'lookup').mockResolvedValue({ ...emptyIdentity('unavailable'), retryAfterSeconds: 60 });
    const { body, next } = await invoke(request({ barcode }));
    expect(next).not.toHaveBeenCalled();
    expect(body).toMatchObject({ success: true, data: { found: false, status: 'unavailable', retryAfterSeconds: 60 } });
    expect(body.message).toMatch(/manually/);
  });

  it('returns the existing local product for a custom barcode without external requests', async () => {
    const lookup = jest.spyOn(productCatalog, 'lookup');
    (prisma.product.findFirst as jest.Mock).mockResolvedValue({ id: 'local-a', name: 'House product', description: null, image: null, category: null });
    const { body } = await invoke(request({ barcode: 'HOUSE-001' }));
    expect(body.data.name).toBe('House product');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('requires an authenticated store assignment before local or public lookup', async () => {
    const lookup = jest.spyOn(productCatalog, 'lookup');
    const { json, next } = await invoke(request({ barcode }, null));
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(json).not.toHaveBeenCalled();
    expect(prisma.product.findFirst).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects malformed barcode input before database access', async () => {
    const { json, next } = await invoke(request({ barcode: 12345678 }));
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(json).not.toHaveBeenCalled();
    expect(prisma.product.findFirst).not.toHaveBeenCalled();
  });

  it('uses explicit photo identification without accepting monetary or authorization suggestions', async () => {
    process.env.ANTHROPIC_API_KEY = 'unit-test-key';
    visionCreate.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({
      name: 'Coffee', brand: 'Sample', size: '12 oz', category: 'Beverages', description: 'Roasted beans',
      price: 100, cost: 2, minimumAge: 0, ebtEligible: true, image: 'https://malicious.example.com/pixel.jpg',
    }) }] });
    const { body, next } = await invoke(request({ image: photo }));
    expect(next).not.toHaveBeenCalled();
    expect(body.data).toMatchObject({ name: 'Sample Coffee 12 oz', status: 'found', source: ['ai_vision'], image: null });
    for (const key of ['price', 'cost', 'minimumAge', 'ebtEligible']) expect(body.data).not.toHaveProperty(key);
    expect(visionCreate).toHaveBeenCalledTimes(1);
    expect(visionCreate.mock.calls[0][0].messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } });
    expect(prisma.product.findFirst).not.toHaveBeenCalled();
  });

  it('handles a failed explicit photo provider as unavailable rather than an invented result', async () => {
    process.env.ANTHROPIC_API_KEY = 'unit-test-key';
    visionCreate.mockRejectedValue(new Error('Provider unavailable'));
    const { body, next } = await invoke(request({ image: photo }));
    expect(next).not.toHaveBeenCalled();
    expect(body.data).toMatchObject({ found: false, status: 'unavailable', name: null, image: null });
  });

  it.each(['CASHIER', 'SUPER_ADMIN'] as const)('keeps %s out of management lookup permissions', role => {
    const req = request({ barcode }); req.user!.role = role;
    const next = jest.fn();
    authorize('ADMIN', 'MANAGER')(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
});
