/**
 * API-key authentication for the public /api/v1 surface.
 * Keys are sent as `X-API-Key: pos_…`; only the SHA-256 hash is stored.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import prisma from '../config/database';

export interface ApiKeyRequest extends Request {
  apiKey?: { id: string; name: string };
}

export const hashApiKey = (key: string): string =>
  crypto.createHash('sha256').update(key).digest('hex');

export const authenticateApiKey = async (
  req: ApiKeyRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const key = req.header('x-api-key');
  if (!key || !key.startsWith('pos_')) {
    res.status(401).json({ success: false, error: 'Missing or malformed API key (X-API-Key header)' });
    return;
  }

  const record = await prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(key) } });
  if (!record || !record.isActive) {
    res.status(401).json({ success: false, error: 'Invalid or revoked API key' });
    return;
  }

  req.apiKey = { id: record.id, name: record.name };

  // Best-effort usage timestamp — never block the request on it
  prisma.apiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  next();
};
