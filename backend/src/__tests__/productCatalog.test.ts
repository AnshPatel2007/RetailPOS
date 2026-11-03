import { ProductCatalog, catalogDisplayName, emptyIdentity, identityText, publicImageUrl } from '../services/productCatalog.service';

const barcode = '012345678905';
const secondBarcode = '036000291452';
const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const offProduct = (code = barcode, overrides: Record<string, unknown> = {}) => ({
  status: 1, code,
  product: { code, product_name: 'Coffee', brands: 'Sample, Other', quantity: '12 oz', generic_name: 'Roasted beans',
    categories_tags_en: ['Foods', 'Beverages'], image_front_url: 'https://images.openfoodfacts.org/coffee.jpg',
    price: 99, cost: 50, stockQuantity: 500, minimumAge: 21, ebtEligible: true, ...overrides },
});
const upcProduct = (code = barcode, overrides: Record<string, unknown> = {}) => ({
  code: 'OK', items: [{ upc: code, title: 'Coffee', brand: 'Sample', size: '12 oz', description: 'Roasted beans',
    category: 'Food > Beverages', images: ['http://unsafe.example.com/photo.jpg', 'https://cdn.example.com/coffee.jpg'], ...overrides }],
});
function harness() {
  let now = Date.UTC(2026, 9, 29);
  const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockImplementation(async () => jsonResponse({ code: 'NOT_FOUND' }));
  const catalog = new ProductCatalog({ fetch: fetcher, now: () => now, upcKey: () => undefined, barcodeLookupKey: () => undefined, userAgent: () => 'POSCatalogTest/1.0' });
  return { fetcher, catalog, advance: (ms: number) => { now += ms; }, now: () => now };
}

describe('catalog identity boundaries', () => {
  it('normalizes bounded display text and includes brand and size once', () => {
    expect(identityText('  Coffee\u0000beans\n ', 12)).toBe('Coffee beans');
    expect(identityText(123)).toBeNull();
    expect(identityText('  ')).toBeNull();
    const result = { ...emptyIdentity('found'), found: true, name: 'Coffee', brand: 'Sample', size: '12 oz' };
    expect(catalogDisplayName(result).name).toBe('Sample Coffee 12 oz');
    expect(catalogDisplayName(result).name).toBe('Sample Coffee 12 oz');
  });

  it.each([
    'http://cdn.example.com/a.jpg', 'data:image/png;base64,AAAA', 'file:///tmp/a.png',
    'https://user:secret@cdn.example.com/a.jpg', 'https://127.0.0.1/a.jpg', 'https://[::1]/a.jpg',
    'https://2130706433/a.jpg', 'https://localhost/a.jpg', 'https://printer.internal/a.jpg',
    'https://machine.local/a.jpg', 'https://catalog.example.test/a.jpg', 'https://cdn.example.com:8443/a.jpg',
  ])('does not expose unsafe image suggestion %s', value => expect(publicImageUrl(value)).toBeNull());

  it('allows public HTTPS image suggestions and rejects oversized values', () => {
    expect(publicImageUrl('https://images.openfoodfacts.org/photo.jpg')).toBe('https://images.openfoodfacts.org/photo.jpg');
    expect(publicImageUrl('https://cdn.example.com/' + 'x'.repeat(2048))).toBeNull();
  });
});

describe('public barcode catalog lookup', () => {
  it('returns only identity suggestions from a matching Open Food Facts product', async () => {
    const { catalog, fetcher } = harness();
    fetcher.mockResolvedValueOnce(jsonResponse(offProduct()));
    const result = await catalog.lookup(barcode);
    expect(result).toMatchObject({ found: true, status: 'found', name: 'Sample Coffee 12 oz', brand: 'Sample', size: '12 oz',
      category: 'Beverages', description: 'Roasted beans', image: null, imageStatus: 'community_only', source: ['barcode_db'] });
    expect(result.imageCandidates).toEqual([{ url: 'https://images.openfoodfacts.org/coffee.jpg', source: 'Open Food Facts', kind: 'community' }]);
    for (const key of ['price', 'cost', 'stockQuantity', 'minimumAge', 'ebtEligible', 'locationId']) expect(result).not.toHaveProperty(key);
    expect(result.attributions).toEqual([{ label: 'Open Food Facts', url: `https://world.openfoodfacts.org/product/${barcode}` }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toContain(`/api/v2/product/${barcode}.json?fields=`);
    expect(options).toMatchObject({ headers: { Accept: 'application/json', 'User-Agent': 'POSCatalogTest/1.0' }, redirect: 'error' });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('accepts a zero-padded equivalent GTIN without dropping leading zeros from the request', async () => {
    const { catalog, fetcher } = harness();
    fetcher.mockResolvedValueOnce(jsonResponse(offProduct('0012345678905')));
    expect((await catalog.lookup(barcode)).found).toBe(true);
    expect(String(fetcher.mock.calls[0][0])).toContain('/012345678905.json');
  });

  it('uses a matching UPCitemdb fallback and picks only a safe product image', async () => {
    const { catalog, fetcher } = harness();
    fetcher.mockResolvedValueOnce(jsonResponse({ status: 0 })).mockResolvedValueOnce(jsonResponse(upcProduct()));
    const result = await catalog.lookup(barcode);
    expect(result).toMatchObject({ found: true, status: 'found', name: 'Sample Coffee 12 oz', category: 'Beverages',
      image: 'https://cdn.example.com/coffee.jpg', source: ['upcitemdb'] });
    expect(fetcher.mock.calls[1][0]).toBe(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`);
    expect(fetcher.mock.calls[1][1]?.headers).not.toHaveProperty('user_key');
  });

  it('enriches a name-only primary match from the same exact barcode without overwriting its name', async () => {
    const { catalog, fetcher } = harness();
    fetcher.mockResolvedValueOnce(jsonResponse(offProduct(barcode, {
      product_name: 'Coffee original', brands: '', quantity: '', generic_name: '', categories_tags_en: [], image_front_url: '',
    }))).mockResolvedValueOnce(jsonResponse(upcProduct(barcode, { title: 'Retailer coffee title' })));
    const result = await catalog.lookup(barcode);
    expect(result).toMatchObject({ found: true, name: 'Sample Coffee original 12 oz', description: 'Roasted beans',
      category: 'Beverages', image: 'https://cdn.example.com/coffee.jpg', source: ['barcode_db', 'upcitemdb'], missingFields: [] });
    expect(result.categoryCandidates).toEqual(['Beverages', 'Food']);
    expect(result.attributions).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('reads English identity and selected front images with readable category ancestors', async () => {
    const { catalog, fetcher } = harness();
    fetcher.mockResolvedValueOnce(jsonResponse(offProduct(barcode, {
      product_name: 'Café', product_name_en: 'Coffee', generic_name: 'Grains', generic_name_en: 'Roasted coffee beans',
      categories_tags_en: undefined, categories_hierarchy: ['en:beverages', 'en:hot-beverages', 'en:coffees'], image_front_url: '',
      selected_images: { front: { display: { en: 'https://images.openfoodfacts.org/front.jpg' } },
        nutrition: { display: { en: 'https://images.openfoodfacts.org/nutrition.jpg' } } },
    })));
    const result = await catalog.lookup(barcode);
    expect(result).toMatchObject({ name: 'Sample Coffee 12 oz', description: 'Roasted coffee beans',
      category: 'Coffees', categoryCandidates: ['Coffees', 'Hot beverages', 'Beverages'], image: null, imageStatus: 'community_only' });
    expect(result.imageCandidates?.[0].url).toBe('https://images.openfoodfacts.org/front.jpg');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('uses the reviewed exact Coca-Cola 20 fl oz manufacturer photo instead of community or multipack photos', async () => {
    const { catalog, fetcher } = harness();
    const cokeCode = '049000000443';
    fetcher.mockResolvedValueOnce(jsonResponse(offProduct(cokeCode, {
      product_name: 'Coca-Cola', brands: 'Coca-Cola', quantity: '20 fl oz', generic_name: '', categories_tags_en: undefined,
      categories_hierarchy: ['en:beverages', 'en:non-alcoholic-beverages', 'en:carbonated-drinks', 'en:soft-drinks', 'en:sodas', 'en:colas', 'en:sweetened-beverages'],
      image_front_url: 'https://images.openfoodfacts.org/images/products/004/900/000/0443/front_en.19.400.jpg',
    }))).mockResolvedValueOnce(jsonResponse(upcProduct(cokeCode, {
      title: 'Coca-Cola Bottle 20 fl oz', brand: 'Coca-Cola', size: '20 fl oz',
      description: 'Carbonated water, high fructose corn syrup, caramel color.', category: 'Food, Beverages & Tobacco > Beverages > Soda',
    })));
    const result = await catalog.lookup(cokeCode);
    expect(result).toMatchObject({ name: 'Coca-Cola 20 fl oz', description: 'Carbonated water, high fructose corn syrup, caramel color.',
      image: 'https://www.coca-cola.com/content/dam/onexp/us/en/brands/coca-cola-original/en_coca-cola-original-taste-20-oz_750x750_v1.jpg', missingFields: [] });
    expect(result.imageCandidates?.[0]).toMatchObject({ source: 'Coca-Cola', reviewedBackground: 'white' });
    expect(result.categoryCandidates).toEqual(expect.arrayContaining(['Beverages', 'Colas', 'Soda']));
    expect(result.source).toEqual(['barcode_db', 'upcitemdb']);
  });

  it('does not fill missing fields from another product or a result without a verified barcode', async () => {
    for (const wrongCode of [secondBarcode, undefined]) {
      const { catalog, fetcher } = harness();
      fetcher.mockResolvedValueOnce(jsonResponse(offProduct(barcode, {
        generic_name: '', categories_tags_en: [], image_front_url: '', quantity: '',
      }))).mockResolvedValueOnce(jsonResponse(upcProduct(barcode, { upc: wrongCode })));
      expect(await catalog.lookup(barcode)).toMatchObject({ name: 'Sample Coffee', description: null, image: null, category: null,
        source: ['barcode_db'], missingFields: ['description', 'category', 'image'], enrichmentUnavailable: true });
    }
  });

  it('retains a partial identity during provider backoff, counts down and retries enrichment after the delay', async () => {
    const { catalog, fetcher, advance } = harness();
    const partial = offProduct(barcode, { generic_name: '', categories_tags_en: [], image_front_url: '', quantity: '' });
    fetcher.mockResolvedValueOnce(jsonResponse(partial)).mockResolvedValueOnce(jsonResponse({}, 429, { 'retry-after': '120' }));
    expect(await catalog.lookup(barcode)).toMatchObject({ found: true, name: 'Sample Coffee', enrichmentUnavailable: true, retryAfterSeconds: 120,
      missingFields: ['description', 'category', 'image'] });
    advance(30_000);
    expect(await catalog.lookup(barcode)).toMatchObject({ name: 'Sample Coffee', retryAfterSeconds: 90 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    advance(90_001);
    fetcher.mockResolvedValueOnce(jsonResponse(partial)).mockResolvedValueOnce(jsonResponse(upcProduct()));
    const enriched = await catalog.lookup(barcode);
    expect(enriched).toMatchObject({ found: true, description: 'Roasted beans', image: 'https://cdn.example.com/coffee.jpg', missingFields: [] });
    expect(enriched.enrichmentUnavailable).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('keeps previously verified identity if both providers fail when its partial cache expires', async () => {
    const { catalog, fetcher, advance } = harness();
    fetcher.mockResolvedValueOnce(jsonResponse(offProduct(barcode, { image_front_url: '' })))
      .mockResolvedValueOnce(jsonResponse({ code: 'NOT_FOUND' }));
    expect(await catalog.lookup(barcode)).toMatchObject({ found: true, missingFields: ['image'] });
    advance(10 * 60_000 + 1);
    fetcher.mockResolvedValueOnce(jsonResponse({}, 503)).mockResolvedValueOnce(jsonResponse({}, 503));
    const [first, second] = await Promise.all([catalog.lookup(barcode), catalog.lookup(barcode)]);
    for (const result of [first, second]) expect(result).toMatchObject({ found: true, name: 'Sample Coffee 12 oz', enrichmentUnavailable: true, missingFields: ['image'] });
  });

  it('caches genuinely sparse matches briefly and builds descriptions from supplied facts only', async () => {
    const { catalog, fetcher, advance } = harness();
    const partial = offProduct(barcode, { generic_name: '', image_front_url: '' });
    fetcher.mockResolvedValueOnce(jsonResponse(partial)).mockResolvedValueOnce(jsonResponse({ code: 'NOT_FOUND' }));
    const first = await catalog.lookup(barcode);
    expect(first).toMatchObject({ name: 'Sample Coffee 12 oz', description: 'Sample Coffee 12 oz — Beverages', missingFields: ['image'] });
    expect(first.enrichmentUnavailable).toBeUndefined();
    advance(5 * 60_000);
    await catalog.lookup(barcode);
    expect(fetcher).toHaveBeenCalledTimes(2);
    advance(5 * 60_000 + 1);
    fetcher.mockResolvedValueOnce(jsonResponse(offProduct())).mockResolvedValueOnce(jsonResponse(upcProduct()));
    expect(await catalog.lookup(barcode)).toMatchObject({ missingFields: [] });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('marks a sparse secondary match for retry when the primary provider was unavailable', async () => {
    const { catalog, fetcher, advance } = harness();
    fetcher.mockResolvedValueOnce(jsonResponse({}, 429, { 'retry-after': '90' }))
      .mockResolvedValueOnce(jsonResponse(upcProduct(barcode, { images: [] })));
    expect(await catalog.lookup(barcode)).toMatchObject({ found: true, source: ['upcitemdb'],
      missingFields: ['image'], enrichmentUnavailable: true, retryAfterSeconds: 90 });
    advance(90_001);
    fetcher.mockResolvedValueOnce(jsonResponse(offProduct())).mockResolvedValueOnce(jsonResponse(upcProduct()));
    expect(await catalog.lookup(barcode)).toMatchObject({ found: true, image: 'https://cdn.example.com/coffee.jpg', missingFields: [] });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('does not identify a different product returned for the requested barcode', async () => {
    const { catalog, fetcher } = harness();
    fetcher.mockResolvedValueOnce(jsonResponse(offProduct(secondBarcode))).mockResolvedValueOnce(jsonResponse(upcProduct(secondBarcode)));
    const result = await catalog.lookup(barcode);
    expect(result).toMatchObject({ found: false, status: 'unavailable', name: null, image: null });
  });

  it('distinguishes confirmed not-found responses from provider failures and caches only genuine misses', async () => {
    const { catalog, fetcher, advance } = harness();
    fetcher.mockResolvedValueOnce(jsonResponse({ status: 0 }, 404)).mockResolvedValueOnce(jsonResponse({ code: 'NOT_FOUND', items: [] }, 404));
    expect((await catalog.lookup(barcode)).status).toBe('not_found');
    expect((await catalog.lookup(barcode)).status).toBe('not_found');
    expect(fetcher).toHaveBeenCalledTimes(2);
    advance(10 * 60_000 + 1);
    fetcher.mockResolvedValueOnce(jsonResponse(offProduct()));
    expect((await catalog.lookup(barcode)).status).toBe('found');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('coalesces simultaneous scans, caches identity data and returns independently mutable copies', async () => {
    const { catalog, fetcher, advance } = harness();
    let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = catalog.lookup(barcode);
    const second = catalog.lookup(barcode);
    expect(fetcher).toHaveBeenCalledTimes(1);
    finish(jsonResponse(offProduct()));
    const [one, two] = await Promise.all([first, second]);
    one.name = 'Edited locally'; one.source.push('local'); one.attributions[0].label = 'Changed';
    one.categoryCandidates!.push('Edited'); one.missingFields!.push('image');
    expect(two.name).toBe('Sample Coffee 12 oz');
    const cached = await catalog.lookup(barcode);
    expect(cached.source).toEqual(['barcode_db']);
    expect(cached.attributions[0].label).toBe('Open Food Facts');
    expect(cached.categoryCandidates).toEqual(['Beverages', 'Foods']);
    expect(cached.missingFields).toEqual(['image']);
    one.imageCandidates![0].url = 'https://edited.example.com/changed.jpg';
    expect(cached.imageCandidates?.[0].url).toBe('https://images.openfoodfacts.org/coffee.jpg');
    expect(fetcher).toHaveBeenCalledTimes(2);
    advance(10 * 60_000 + 1);
    fetcher.mockResolvedValueOnce(jsonResponse(offProduct()));
    await catalog.lookup(barcode);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('honors retry-after without refetching while unavailable and retries after backoff', async () => {
    const { catalog, fetcher, advance } = harness();
    fetcher.mockResolvedValueOnce(jsonResponse({}, 429, { 'retry-after': '120' }))
      .mockResolvedValueOnce(jsonResponse({}, 503));
    expect(await catalog.lookup(barcode)).toMatchObject({ found: false, status: 'unavailable', retryAfterSeconds: 120 });
    expect((await catalog.lookup(barcode)).status).toBe('unavailable');
    expect(fetcher).toHaveBeenCalledTimes(2);
    advance(120_001);
    fetcher.mockResolvedValueOnce(jsonResponse(offProduct()));
    expect((await catalog.lookup(barcode)).found).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it.each(['TOO_FAST', 'EXCEED_LIMIT'])('backs off from HTTP 200 provider error %s', async code => {
    const { catalog, fetcher, advance } = harness();
    fetcher.mockResolvedValueOnce(jsonResponse({ status: 0 })).mockResolvedValueOnce(jsonResponse({ code, message: 'Provider limit' }));
    expect(await catalog.lookup(barcode)).toMatchObject({ found: false, status: 'unavailable' });
    advance(11_000); // Past ordinary UPC pacing; the provider error backoff must still hold.
    fetcher.mockResolvedValueOnce(jsonResponse({ status: 0 }));
    expect((await catalog.lookup(barcode)).status).toBe('unavailable');
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('upcitemdb.com'))).toHaveLength(1);
  });

  it('rejects oversized or malformed provider responses without treating them as a missing product', async () => {
    const { catalog, fetcher } = harness();
    fetcher.mockResolvedValueOnce(new Response('x'.repeat(262_145), { headers: { 'content-length': '262145' } }))
      .mockResolvedValueOnce(new Response('not json'));
    expect(await catalog.lookup(barcode)).toMatchObject({ found: false, status: 'unavailable', name: null });
  });

  it.each(['', '123', 'abcd1234', '012345678905\n', '12345678901', '1'.repeat(128)])('rejects unsupported lookup input without external requests (%s)', async value => {
    const { catalog, fetcher } = harness();
    expect(await catalog.lookup(value)).toMatchObject({ found: false, status: 'invalid' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses configured paid credentials only for the UPC provider request', async () => {
    const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    const catalog = new ProductCatalog({ fetch: fetcher, upcKey: () => 'unit-test-provider-key' });
    fetcher.mockResolvedValueOnce(jsonResponse({ status: 0 })).mockResolvedValueOnce(jsonResponse(upcProduct()));
    const result = await catalog.lookup(barcode);
    expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty('user_key');
    expect(fetcher.mock.calls[1][0]).toContain('/prod/v1/lookup');
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({ user_key: 'unit-test-provider-key', key_type: '3scale' });
    expect(JSON.stringify(result)).not.toContain('unit-test-provider-key');
  });
});

describe('additional catalog and photo selection', () => {
  const commercial = (code = barcode, overrides: Record<string, unknown> = {}) => ({ products: [{
    barcode_number: code, title: 'Example Lager 12 oz', brand: 'Example', size: '12 oz', category: 'Beverages > Beer',
    description: 'Lager in a 12 oz can', images: ['https://cdn.example.com/lager.png'], ...overrides,
  }] });

  it('uses the configured additional catalog, verifies its GTIN and never returns its credentials or age_group', async () => {
    const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValueOnce(jsonResponse(commercial('0012345678905', { age_group: '99', price: 100 })));
    const catalog = new ProductCatalog({ fetch: fetcher, barcodeLookupKey: () => 'secret & key', upcKey: () => undefined });
    const result = await catalog.lookup(barcode);
    expect(result).toMatchObject({ found: true, name: 'Example Lager 12 oz', imageStatus: 'catalog', category: 'Beer', source: ['barcodelookup'] });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(`https://api.barcodelookup.com/v3/products?barcode=${barcode}&key=secret%20%26%20key`);
    for (const value of ['secret', 'age_group', 'price', 'minimumAge']) expect(JSON.stringify(result)).not.toContain(value);
    result.imageCandidates![0].url = 'https://changed.example.com/photo.jpg';
    expect((await catalog.lookup(barcode)).imageCandidates?.[0].url).toBe('https://cdn.example.com/lager.png');
  });

  it('never contacts the additional provider unless a key is configured', async () => {
    const { catalog, fetcher } = harness();
    fetcher.mockResolvedValueOnce(jsonResponse(offProduct())).mockResolvedValueOnce(jsonResponse(upcProduct()));
    const result = await catalog.lookup(barcode);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('barcodelookup.com'))).toBe(false);
    expect(result.image).toBe('https://cdn.example.com/coffee.jpg');
    expect(result.imageCandidates?.map(image => image.kind)).toEqual(['catalog', 'community']);
  });

  it('ignores wrong or missing GTINs in the commercial response and uses verified fallback data', async () => {
    for (const wrong of [secondBarcode, undefined]) {
      const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
        .mockResolvedValueOnce(jsonResponse(commercial(barcode, { barcode_number: wrong })))
        .mockResolvedValueOnce(jsonResponse(offProduct())).mockResolvedValueOnce(jsonResponse(upcProduct()));
      const catalog = new ProductCatalog({ fetch: fetcher, barcodeLookupKey: () => 'key', upcKey: () => undefined });
      const result = await catalog.lookup(barcode);
      expect(result.name).toBe('Sample Coffee 12 oz');
      expect(result.source).not.toContain('barcodelookup');
      expect(result.imageCandidates?.some(image => image.url.includes('lager'))).toBe(false);
    }
  });

  it('keeps community-only photos out of automatic image filling and bounds safe catalog alternatives', async () => {
    const { catalog, fetcher } = harness();
    fetcher.mockResolvedValueOnce(jsonResponse(offProduct())).mockResolvedValueOnce(jsonResponse({ code: 'NOT_FOUND' }));
    expect(await catalog.lookup(barcode)).toMatchObject({ image: null, imageStatus: 'community_only', missingFields: ['image'] });
    const otherFetch = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValueOnce(jsonResponse(commercial(barcode, {
      images: ['http://insecure.example.com/photo.jpg', 'https://localhost/x.png', ...Array.from({ length: 20 }, (_, index) => `https://cdn.example.com/${index}.png`)],
    })));
    const other = new ProductCatalog({ fetch: otherFetch, barcodeLookupKey: () => 'key' });
    const result = await other.lookup(barcode);
    expect(result.imageCandidates).toHaveLength(8);
    expect(result.image).toBe('https://cdn.example.com/0.png');
  });

  it('respects additional-provider retry delays without losing usable fallback identity', async () => {
    let now = 0;
    const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockImplementation(async url => {
      if (String(url).includes('barcodelookup.com')) return jsonResponse({}, 429, { 'retry-after': '120' });
      if (String(url).includes('openfoodfacts')) return jsonResponse({ status: 0 });
      return jsonResponse({ code: 'NOT_FOUND' });
    });
    const catalog = new ProductCatalog({ fetch: fetcher, now: () => now, barcodeLookupKey: () => 'key', upcKey: () => undefined });
    expect(await catalog.lookup(barcode)).toMatchObject({ status: 'unavailable', retryAfterSeconds: 120 });
    now = 20_000;
    await catalog.lookup(secondBarcode);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('barcodelookup.com'))).toHaveLength(1);
    now = 120_001;
    await catalog.lookup(barcode);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('barcodelookup.com'))).toHaveLength(2);
  });

  it.each(['daily', 'monthly'])('limits additional-provider %s calls and leaves the fallback providers available', async limit => {
    let now = 0;
    const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockImplementation(async url => {
      if (String(url).includes('barcodelookup.com')) return jsonResponse(commercial(new URL(String(url)).searchParams.get('barcode')!));
      if (String(url).includes('openfoodfacts')) return jsonResponse({ status: 0 });
      return jsonResponse({ code: 'NOT_FOUND' });
    });
    const catalog = new ProductCatalog({ fetch: fetcher, now: () => now, barcodeLookupKey: () => 'key', upcKey: () => undefined,
      barcodeLookupDailyLimit: () => limit === 'daily' ? 1 : 250,
      barcodeLookupMonthlyLimit: () => limit === 'monthly' ? 1 : 5000 });
    expect((await catalog.lookup(barcode)).found).toBe(true);
    now = 60_000;
    expect((await catalog.lookup(secondBarcode)).status).toBe('unavailable');
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('barcodelookup.com'))).toHaveLength(1);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('openfoodfacts'))).toBe(true);
    now = (limit === 'daily' ? 1 : 31) * 24 * 60 * 60_000 + 1;
    expect((await catalog.lookup(secondBarcode)).found).toBe(true);
  });
});
