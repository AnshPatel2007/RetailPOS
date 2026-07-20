/**
 * Product identification for fast catalog onboarding.
 *
 * Given a barcode and/or a photo, return a prefilled product draft:
 *   1. Barcode → Open Food Facts (free, no key) covers most packaged goods
 *   2. Photo → Claude vision reads the label when the barcode database misses
 * Entering 3,000 SKUs is the worst part of switching POS systems — this turns
 * each one into "scan, snap, type the price".
 */

import { Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import { logger } from '../utils/logger';

interface IdentifyResult {
  name: string | null;
  brand: string | null;
  size: string | null;
  category: string | null;
  description: string | null;
  source: string[];
}

/** Open Food Facts v2 lookup — packaged food/drink/household UPCs */
const lookupOpenFoodFacts = async (barcode: string): Promise<Partial<IdentifyResult> | null> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,brands,quantity,categories_tags_en,generic_name`,
      { signal: controller.signal, headers: { 'User-Agent': 'RetailPOS/1.0' } }
    );
    clearTimeout(timer);
    if (!resp.ok) return null;
    const data: any = await resp.json();
    const p = data?.product;
    if (!p || !p.product_name) return null;
    return {
      name: p.product_name || null,
      brand: p.brands ? String(p.brands).split(',')[0].trim() : null,
      size: p.quantity || null,
      category: Array.isArray(p.categories_tags_en) && p.categories_tags_en.length > 0
        ? p.categories_tags_en[p.categories_tags_en.length - 1]
        : null,
      description: p.generic_name || null,
    };
  } catch {
    return null; // network/timeout — fall through to vision
  }
};

/** Claude vision reads the product label from a photo */
const identifyFromPhoto = async (
  imageBase64: string,
  mediaType: string
): Promise<Partial<IdentifyResult> | null> => {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Product name as it would appear on a shelf tag, including brand and size' },
              brand: { type: 'string' },
              size: { type: 'string', description: 'Package size, e.g. "12 oz" — empty string if not visible' },
              category: { type: 'string', description: 'Short retail category, e.g. "Energy Drinks"' },
              description: { type: 'string', description: 'One-line description' },
            },
            required: ['name', 'brand', 'size', 'category', 'description'],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: 'Identify this retail product from the photo. Only report what you can actually read or clearly recognize — use empty strings for anything not visible.',
            },
          ],
        },
      ],
    });

    if (response.stop_reason === 'refusal') return null;
    const text = response.content.find((b) => b.type === 'text');
    if (!text || !('text' in text)) return null;
    const parsed = JSON.parse(text.text);
    return {
      name: parsed.name || null,
      brand: parsed.brand || null,
      size: parsed.size || null,
      category: parsed.category || null,
      description: parsed.description || null,
    };
  } catch (err: any) {
    logger.warn(`Product photo identification failed: ${err?.message || err}`);
    return null;
  }
};

/**
 * Identify a product from a barcode and/or photo
 * POST /api/products/identify  { barcode?, image? (data URL or base64), mediaType? }
 */
export const identifyProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { barcode, image, mediaType } = req.body;

  if (!barcode && !image) {
    throw new AppError('Provide a barcode, a photo, or both', 400);
  }

  const result: IdentifyResult = {
    name: null,
    brand: null,
    size: null,
    category: null,
    description: null,
    source: [],
  };

  // 1. Barcode database first — instant and free
  if (barcode && /^\d{6,14}$/.test(String(barcode))) {
    const off = await lookupOpenFoodFacts(String(barcode));
    if (off) {
      Object.assign(result, off);
      result.source.push('barcode_db');
    }
  }

  // 2. Photo fills whatever the database didn't
  if (image && (!result.name || !result.category)) {
    let data = String(image);
    let type = mediaType || 'image/jpeg';
    const dataUrlMatch = data.match(/^data:(image\/[a-z]+);base64,(.+)$/);
    if (dataUrlMatch) {
      type = dataUrlMatch[1];
      data = dataUrlMatch[2];
    }
    const vision = await identifyFromPhoto(data, type);
    if (vision) {
      // Vision only fills gaps — the barcode database is more precise when it hit
      for (const key of ['name', 'brand', 'size', 'category', 'description'] as const) {
        if (!result[key] && vision[key]) result[key] = vision[key] as string;
      }
      result.source.push('ai_vision');
    }
  }

  if (result.source.length === 0) {
    res.json({
      success: true,
      data: { ...result, found: false },
      message: image
        ? 'Could not identify this product — enter the details manually'
        : 'Barcode not found in the product database — try adding a photo',
    });
    return;
  }

  // Shelf-tag style display name: "Brand Name Size" without duplication
  if (result.name && result.brand && !result.name.toLowerCase().includes(result.brand.toLowerCase())) {
    result.name = `${result.brand} ${result.name}`;
  }
  if (result.name && result.size && !result.name.includes(result.size)) {
    result.name = `${result.name} ${result.size}`;
  }

  logger.info(`Product identified via ${result.source.join('+')}: ${result.name}`);
  res.json({ success: true, data: { ...result, found: true } });
});
