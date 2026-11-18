import { isIP } from 'net';

export interface ProductImageCandidate {
  url: string;
  source: 'UPCitemdb' | 'Barcode Lookup' | 'Open Food Facts' | 'Coca-Cola';
  kind: 'catalog' | 'community';
  reviewedBackground?: 'white';
}

export interface ProductIdentity {
  name: string | null;
  brand: string | null;
  size: string | null;
  category: string | null;
  description: string | null;
  image: string | null;
  source: string[];
  attributions: { label: string; url: string }[];
  status: 'found' | 'not_found' | 'unavailable' | 'invalid';
  found: boolean;
  existingProductId?: string;
  categoryCandidates?: string[];
  missingFields?: ('name' | 'description' | 'category' | 'image')[];
  enrichmentUnavailable?: boolean;
  retryAfterSeconds?: number;
  imageCandidates?: ProductImageCandidate[];
  imageStatus?: 'catalog' | 'community_only' | 'missing';
}

export const emptyIdentity = (status: ProductIdentity['status'] = 'not_found'): ProductIdentity => ({
  name: null, brand: null, size: null, category: null, description: null, image: null,
  source: [], attributions: [], status, found: false,
});

export const identityText = (value: unknown, max = 250): string | null =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) || null : null;

/** External suggestions are never data/file URLs, credential URLs, IPs, or local hostnames. */
export function publicImageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
      || isIP(hostname) || hostname.includes(':')
      || /(?:^|\.)(localhost|local|internal|lan|home|test|invalid|example)$/.test(hostname)
      || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(hostname)) return null;
    return url.href;
  } catch { return null; }
}

export function catalogDisplayName(result: ProductIdentity): ProductIdentity {
  if (result.name && result.brand && !result.name.toLowerCase().includes(result.brand.toLowerCase())) {
    result.name = `${result.brand} ${result.name}`;
  }
  if (result.name && result.size && !result.name.toLowerCase().includes(result.size.toLowerCase())) {
    result.name = `${result.name} ${result.size}`;
  }
  result.name = identityText(result.name);
  return result;
}

/** UPC-A and its zero-prefixed EAN/GTIN representation identify the same item. */
const isGtin = (value: unknown): value is string => typeof value === 'string' && [8, 12, 13, 14].includes(value.length) && !/\D/.test(value);
function matchesBarcode(value: unknown, barcode: string): boolean {
  return isGtin(value)
    && value.padStart(14, '0') === barcode.padStart(14, '0');
}

/** Providers return broad-to-specific hierarchies; store matching needs every level. */
function categories(...hierarchies: unknown[][]): string[] {
  const result: string[] = [];
  for (const hierarchy of hierarchies) {
    for (const value of [...hierarchy].reverse()) {
      const text = identityText(value)?.replace(/^[a-z]{2,3}:/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!text || result.some(item => item.toLowerCase() === text.toLowerCase())) continue;
      result.push(text.charAt(0).toUpperCase() + text.slice(1));
      if (result.length >= 32) return result;
    }
  }
  return result;
}

export function catalogMissingFields(result: ProductIdentity): NonNullable<ProductIdentity['missingFields']> {
  return (['name', 'description', 'category', 'image'] as const).filter(field => !result[field]);
}

function imageCandidates(source: ProductImageCandidate['source'], values: unknown[]): ProductImageCandidate[] {
  const candidates: ProductImageCandidate[] = [];
  // These describe provenance, not a guarantee about the image's background or quality.
  for (const value of values.slice(0, 32)) {
    const url = publicImageUrl(value);
    if (!url || candidates.some(item => item.url === url)) continue;
    candidates.push({ url, source, kind: source === 'Open Food Facts' ? 'community' : 'catalog' });
    if (candidates.length >= 8) break;
  }
  return candidates;
}

function selectCatalogImage(result: ProductIdentity): ProductIdentity {
  result.imageCandidates = (result.imageCandidates || []).filter((item, index, items) =>
    items.findIndex(candidate => candidate.url === item.url) === index)
    .sort((first, second) => Number(first.kind === 'community') - Number(second.kind === 'community')).slice(0, 8);
  result.image = result.imageCandidates.find(item => item.kind === 'catalog')?.url || null;
  result.imageStatus = result.image ? 'catalog' : result.imageCandidates.length ? 'community_only' : 'missing';
  return result;
}

/** A reviewed manufacturer packshot for the reported UPC, never a generic cola photo. */
function reviewedManufacturerImage(barcode: string, result: ProductIdentity): ProductIdentity {
  const codes = [...new Set([barcode, barcode.padStart(13, '0'), barcode.padStart(14, '0')])];
  const hasPackQuantity = /\b\d+\s*[- ]?(?:pack|pk|count|ct)\b/i.test(`${result.size || ''} ${result.name || ''}`);
  const score = (candidate: ProductImageCandidate) => {
    const path = candidate.url.toLowerCase();
    let value = candidate.kind === 'community' ? -100 : 0;
    if (codes.some(code => path.includes(code))) value += 10;
    // This only demotes explicit multipack URL labels for a single-item identity.
    // Opaque retailer filenames cannot establish the pictured package size.
    if (!hasPackQuantity && /(?:\b|[_/-])(?:[2-9]|\d{2,3})[-_ ]?(?:pack|pk|count|ct)(?:\b|[_/.-])/i.test(path)) value -= 20;
    return value;
  };
  result.imageCandidates = [...(result.imageCandidates || [])].sort((first, second) => score(second) - score(first));
  selectCatalogImage(result);
  if (!matchesBarcode('049000000443', barcode)
    || !/coca[\s-]*cola/i.test(`${result.brand || ''} ${result.name || ''}`)
    || !/\b20\s*(?:fl\.?\s*)?oz\b/i.test(`${result.size || ''} ${result.name || ''}`)) return result;
  const candidate: ProductImageCandidate = {
    url: 'https://www.coca-cola.com/content/dam/onexp/us/en/brands/coca-cola-original/en_coca-cola-original-taste-20-oz_750x750_v1.jpg',
    source: 'Coca-Cola', kind: 'catalog', reviewedBackground: 'white',
  };
  result.imageCandidates = [candidate, ...(result.imageCandidates || [])];
  result.attributions = [...result.attributions, { label: 'Coca-Cola product image', url: 'https://www.coca-cola.com/us/en/brands/coca-cola/products/original' }];
  return selectCatalogImage(result);
}

/** Never replace a provider's confirmed identity with a different provider's wording. */
function mergeIdentity(primary: ProductIdentity, supplement: ProductIdentity): ProductIdentity {
  const result = { ...primary };
  for (const field of ['name', 'brand', 'size', 'category', 'description', 'image'] as const) {
    result[field] = primary[field] || supplement[field];
  }
  result.categoryCandidates = [];
  const firstCategories = primary.categoryCandidates || [], secondCategories = supplement.categoryCandidates || [];
  for (let index = 0; index < Math.max(firstCategories.length, secondCategories.length); index++) {
    for (const category of [firstCategories[index], secondCategories[index]]) {
      if (category && !result.categoryCandidates.some(item => item.toLowerCase() === category.toLowerCase())) result.categoryCandidates.push(category);
    }
  }
  result.source = [...new Set([...primary.source, ...supplement.source])];
  result.attributions = [...primary.attributions, ...supplement.attributions.filter(item => !primary.attributions.some(existing => existing.url === item.url))];
  result.imageCandidates = [...(primary.imageCandidates || []), ...(supplement.imageCandidates || [])];
  return selectCatalogImage(result);
}

function finishIdentity(result: ProductIdentity): ProductIdentity {
  catalogDisplayName(result);
  // A brief factual summary is useful when a catalog has no written description.
  // Only describe supplied identity facts; never infer ingredients or marketing claims.
  if (!result.description && result.name && (result.size || result.category)) {
    result.description = identityText(result.category && !result.name.toLowerCase().includes(result.category.toLowerCase())
      ? `${result.name} — ${result.category}` : result.name, 1000);
  }
  result.missingFields = catalogMissingFields(result);
  return result;
}

type Provider = 'off' | 'upc' | 'barcodeLookup';
interface ProviderState { calls: number[]; blockedUntil: number; active: number }
interface CatalogOptions {
  fetch?: typeof fetch;
  now?: () => number;
  upcKey?: () => string | undefined;
  barcodeLookupKey?: () => string | undefined;
  barcodeLookupDailyLimit?: () => number;
  barcodeLookupMonthlyLimit?: () => number;
  userAgent?: () => string;
}

/** Public identity cache only. Store-owned products never enter this shared cache. */
export class ProductCatalog {
  private cache = new Map<string, { expires: number; result: ProductIdentity }>();
  private inflight = new Map<string, Promise<ProductIdentity>>();
  private states: Record<Provider, ProviderState> = {
    off: { calls: [], blockedUntil: 0, active: 0 }, upc: { calls: [], blockedUntil: 0, active: 0 },
    barcodeLookup: { calls: [], blockedUntil: 0, active: 0 },
  };
  private fetcher: typeof fetch;
  private now: () => number;
  private upcKey: () => string | undefined;
  private barcodeLookupKey: () => string | undefined;
  private barcodeLookupDailyLimit: () => number;
  private barcodeLookupMonthlyLimit: () => number;
  private userAgent: () => string;

  constructor(options: CatalogOptions = {}) {
    this.fetcher = options.fetch || ((...args) => fetch(...args));
    this.now = options.now || Date.now;
    this.upcKey = options.upcKey || (() => process.env.UPCITEMDB_API_KEY);
    this.barcodeLookupKey = options.barcodeLookupKey || (() => process.env.BARCODELOOKUP_API_KEY);
    this.barcodeLookupDailyLimit = options.barcodeLookupDailyLimit || (() => Number(process.env.BARCODELOOKUP_DAILY_LIMIT || 250));
    this.barcodeLookupMonthlyLimit = options.barcodeLookupMonthlyLimit || (() => Number(process.env.BARCODELOOKUP_MONTHLY_LIMIT || 5000));
    this.userAgent = options.userAgent || (() => process.env.PRODUCT_CATALOG_USER_AGENT || 'RetailPOS/1.0');
  }

  async lookup(barcode: string): Promise<ProductIdentity> {
    if (!isGtin(barcode)) return emptyIdentity('invalid');
    const cached = this.cache.get(barcode);
    if (cached && cached.expires > this.now()) {
      const result = this.copy(cached.result);
      if (result.enrichmentUnavailable) result.retryAfterSeconds = Math.max(1, Math.ceil((cached.expires - this.now()) / 1000));
      return result;
    }
    this.cache.delete(barcode);
    const pending = this.inflight.get(barcode);
    if (pending) return this.copy(await pending);
    if (this.inflight.size >= 32) return { ...emptyIdentity('unavailable'), retryAfterSeconds: 10 };
    const request = this.lookupProviders(barcode).then(resolved => {
      let result = resolved;
      if (cached?.result.found && result.status === 'unavailable') {
        result = { ...this.copy(cached.result), enrichmentUnavailable: true, retryAfterSeconds: result.retryAfterSeconds };
      }
      // A verified partial match remains useful during provider outages. Retry that
      // enrichment promptly instead of pinning a name-only result for a full day.
      if (result.status === 'found' || result.status === 'not_found') {
        const lifetime = result.enrichmentUnavailable ? Math.max(1, result.retryAfterSeconds || 15) * 1000
          : result.found && !result.missingFields?.length ? 24 * 60 * 60_000 : 10 * 60_000;
        while (this.cache.size >= 500) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(barcode, { result: this.copy(result), expires: this.now() + lifetime });
      }
      return result;
    });
    this.inflight.set(barcode, request);
    try { return this.copy(await request); }
    finally { this.inflight.delete(barcode); }
  }

  private copy(result: ProductIdentity): ProductIdentity {
    return { ...result, source: [...result.source], attributions: result.attributions.map(item => ({ ...item })),
      ...(result.categoryCandidates ? { categoryCandidates: [...result.categoryCandidates] } : {}),
      ...(result.imageCandidates ? { imageCandidates: result.imageCandidates.map(item => ({ ...item })) } : {}),
      ...(result.missingFields ? { missingFields: [...result.missingFields] } : {}) };
  }

  private reserve(provider: Provider): number {
    const state = this.states[provider];
    const now = this.now();
    const paid = Boolean(this.upcKey());
    const window = provider === 'off' ? 60_000 : (provider === 'barcodeLookup' ? 31 : 1) * 24 * 60 * 60_000;
    state.calls = state.calls.filter(time => time > now - window);
    let next = state.blockedUntil;
    if (provider === 'off' && state.calls.length >= 15) next = Math.max(next, state.calls[0] + 60_000);
    if (provider === 'upc') {
      const limit = paid ? 20_000 : 100;
      if (state.calls.length >= limit) next = Math.max(next, state.calls[0] + window);
      const last = state.calls[state.calls.length - 1];
      if (last !== undefined) next = Math.max(next, last + (paid ? 2000 : 10_000));
      if (state.active) next = Math.max(next, now + 2_000);
    }
    if (provider === 'barcodeLookup') {
      const configured = this.barcodeLookupDailyLimit();
      const limit = Number.isFinite(configured) ? Math.max(1, Math.min(5000, Math.floor(configured))) : 250;
      const daily = state.calls.filter(time => time > now - 24 * 60 * 60_000);
      if (daily.length >= limit) next = Math.max(next, daily[daily.length - limit] + 24 * 60 * 60_000);
      const monthlyConfigured = this.barcodeLookupMonthlyLimit();
      const monthlyLimit = Number.isFinite(monthlyConfigured) ? Math.max(1, Math.min(100_000, Math.floor(monthlyConfigured))) : 5000;
      if (state.calls.length >= monthlyLimit) next = Math.max(next, state.calls[state.calls.length - monthlyLimit] + window);
      const recent = state.calls.filter(time => time > now - 60_000);
      if (recent.length >= 60) next = Math.max(next, recent[recent.length - 60] + 60_000);
      if (state.active >= 4) next = Math.max(next, now + 2_000);
    }
    if (next > now) return Math.max(1, Math.ceil((next - now) / 1000));
    state.calls.push(now);
    state.active++;
    return 0;
  }

  private async request(provider: Provider, url: string, headers: Record<string, string>): Promise<{ data?: any; retryAfterSeconds?: number; unavailable?: boolean }> {
    const delay = this.reserve(provider);
    if (delay) return { unavailable: true, retryAfterSeconds: delay };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await this.fetcher(url, { headers, signal: controller.signal, redirect: 'error' });
      if (!response.ok) {
        const retryHeader = response.headers.get('retry-after');
        const retry = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) * 1000
          : retryHeader ? Date.parse(retryHeader) - this.now() : 0;
        const backoff = Math.max(response.status === 429 ? 60_000 : 15_000, Number.isFinite(retry) ? retry : 0);
        this.states[provider].blockedUntil = this.now() + backoff;
        // OFF represents a genuine miss as a JSON status=0, occasionally with HTTP404.
        if (provider === 'off' && response.status === 404) {
          this.states[provider].blockedUntil = 0;
          return { data: { status: 0 } };
        }
        if (provider === 'upc' && response.status === 404) {
          this.states[provider].blockedUntil = 0;
          return { data: { code: 'NOT_FOUND' } };
        }
        if (provider === 'barcodeLookup' && response.status === 404) {
          this.states[provider].blockedUntil = 0;
          return { data: { products: [] } };
        }
        return { unavailable: true, retryAfterSeconds: Math.ceil(backoff / 1000) };
      }
      const length = Number(response.headers.get('content-length') || 0);
      if (length > 262_144) throw new Error('Catalog response too large');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty catalog response');
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 262_144) { await reader.cancel(); throw new Error('Catalog response too large'); }
        chunks.push(value);
      }
      return { data: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
    } catch {
      this.states[provider].blockedUntil = Math.max(this.states[provider].blockedUntil, this.now() + 15_000);
      return { unavailable: true, retryAfterSeconds: 15 };
    } finally {
      clearTimeout(timeout);
      this.states[provider].active--;
    }
  }

  private async lookupProviders(barcode: string): Promise<ProductIdentity> {
    let result: ProductIdentity | undefined;
    const unavailable: number[] = [];
    const commonHeaders = { Accept: 'application/json', 'User-Agent': this.userAgent() };
    const finish = () => {
      if (!result) return unavailable.length
        ? { ...emptyIdentity('unavailable'), retryAfterSeconds: Math.max(...unavailable) }
        : emptyIdentity('not_found');
      const complete = finishIdentity(reviewedManufacturerImage(barcode, result));
      if (complete.missingFields?.length && unavailable.length) {
        complete.enrichmentUnavailable = true;
        complete.retryAfterSeconds = Math.max(...unavailable);
      }
      return complete;
    };
    const lookupKey = this.barcodeLookupKey()?.trim();
    if (lookupKey) {
      const response = await this.request('barcodeLookup',
        `https://api.barcodelookup.com/v3/products?barcode=${encodeURIComponent(barcode)}&key=${encodeURIComponent(lookupKey)}`, commonHeaders);
      const item = Array.isArray(response.data?.products) ? response.data.products.find((entry: any) =>
        matchesBarcode(entry?.barcode_number, barcode) && identityText(entry?.title)) : undefined;
      if (item) {
        const categoryCandidates = categories(typeof item.category === 'string' ? item.category.split(/\s*>\s*/) : []);
        result = selectCatalogImage({ ...emptyIdentity('found'), found: true,
          name: identityText(item.title), brand: identityText(item.brand), size: identityText(item.size, 80),
          description: identityText(item.description, 1000), category: categoryCandidates[0] || null, categoryCandidates,
          imageCandidates: imageCandidates('Barcode Lookup', Array.isArray(item.images) ? item.images : []),
          source: ['barcodelookup'], attributions: [{ label: 'Barcode Lookup', url: `https://www.barcodelookup.com/${barcode}` }],
        });
        if (!catalogMissingFields(result).length) return finish();
      } else if (!Array.isArray(response.data?.products) || response.data.products.length !== 0) {
        // Error payloads (including quota failures) never count as a confirmed miss.
        const seconds = response.retryAfterSeconds || 60;
        this.states.barcodeLookup.blockedUntil = Math.max(this.states.barcodeLookup.blockedUntil, this.now() + seconds * 1000);
        unavailable.push(seconds);
      }
    }
    const off = await this.request('off',
      `https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=code,product_name,product_name_en,brands,quantity,categories_tags_en,categories_hierarchy,generic_name,generic_name_en,image_front_url,image_url,selected_images`,
      commonHeaders);
    const product = off.data?.product;
    const offName = identityText(product?.product_name_en) || identityText(product?.product_name);
    if (product && matchesBarcode(product.code || off.data?.code, barcode) && offName) {
      const categoryCandidates = categories(Array.isArray(product.categories_tags_en) ? product.categories_tags_en : [],
        Array.isArray(product.categories_hierarchy) ? product.categories_hierarchy : []);
      const frontImages = product.selected_images?.front?.display;
      const supplement: ProductIdentity = selectCatalogImage({ ...emptyIdentity('found'), found: true,
        name: offName, brand: identityText(typeof product.brands === 'string' ? product.brands.split(',')[0] : null),
        size: identityText(product.quantity, 80), description: identityText(product.generic_name_en, 1000) || identityText(product.generic_name, 1000),
        category: categoryCandidates[0] || null, categoryCandidates,
        imageCandidates: imageCandidates('Open Food Facts', [frontImages?.en, product.image_front_url, product.image_url,
          ...(frontImages && typeof frontImages === 'object' ? Object.values(frontImages).slice(0, 16) : [])]),
        source: ['barcode_db'], attributions: [{ label: 'Open Food Facts', url: `https://world.openfoodfacts.org/product/${barcode}` }],
      });
      result = result ? mergeIdentity(result, supplement) : supplement;
      if (!catalogMissingFields(result).length) return finish();
    } else if (!(off.data?.status === 0 || (off.data?.status === 1 && product && !offName))) {
      unavailable.push(Math.max(off.retryAfterSeconds || 0, 15));
    }
    const key = this.upcKey();
    const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': this.userAgent() };
    if (key) { headers.user_key = key; headers.key_type = '3scale'; }
    const upc = await this.request('upc', `https://api.upcitemdb.com/prod/${key ? 'v1' : 'trial'}/lookup?upc=${barcode}`, headers);
    const item = Array.isArray(upc.data?.items) ? upc.data.items.find((entry: any) =>
      [entry?.upc, entry?.ean, entry?.gtin].some(code => matchesBarcode(code, barcode)) && identityText(entry?.title)) : undefined;
    if (upc.data?.code === 'OK' && item) {
      const categoryCandidates = categories(typeof item.category === 'string' ? item.category.split(/\s*>\s*/) : []);
      const supplement: ProductIdentity = selectCatalogImage({ ...emptyIdentity('found'), found: true,
        name: identityText(item.title), brand: identityText(item.brand), size: identityText(item.size, 80),
        description: identityText(item.description, 1000), category: categoryCandidates[0] || null, categoryCandidates,
        imageCandidates: imageCandidates('UPCitemdb', Array.isArray(item.images) ? item.images : []),
        source: ['upcitemdb'], attributions: [{ label: 'UPCitemdb', url: `https://www.upcitemdb.com/upc/${barcode}` }],
      });
      result = result ? mergeIdentity(result, supplement) : supplement;
      return finish();
    }
    const upcMiss = upc.data?.code === 'NOT_FOUND' || (upc.data?.code === 'OK' && Array.isArray(upc.data?.items) && upc.data.items.length === 0);
    if (['TOO_FAST', 'EXCEED_LIMIT'].includes(upc.data?.code)) {
      const seconds = upc.data.code === 'EXCEED_LIMIT' ? 24 * 60 * 60 : 60;
      this.states.upc.blockedUntil = Math.max(this.states.upc.blockedUntil, this.now() + seconds * 1000);
      upc.retryAfterSeconds = seconds;
    }
    if (!upcMiss) unavailable.push(Math.max(upc.retryAfterSeconds || 0, 15));
    return finish();
  }
}

export const productCatalog = new ProductCatalog();
