import { Request } from 'express';
import { verifyToken } from '../utils/jwt';

/**
 * How many proxies sit between the internet and this server, for Express's
 * `trust proxy` setting. Behind a hosting proxy (Render) every request arrives
 * from the proxy's address; unless Express is told to read the forwarded
 * address, every store and every register shares one rate-limit budget and five
 * wrong passwords anywhere pause sign-in for everyone.
 *
 * TRUST_PROXY: a number of proxy hops, `true`/`false`, or an Express value such
 * as `loopback`. Unset: one hop in production, none in development and tests.
 */
export function trustProxySetting(value: string | undefined, nodeEnv: string): number | boolean | string {
  const setting = (value ?? '').trim();
  if (!setting) return nodeEnv === 'production' ? 1 : false;
  if (/^\d+$/.test(setting)) return Number(setting);
  if (setting === 'true') return true;
  if (setting === 'false') return false;
  return setting;
}

/**
 * The general API budget belongs to the signed-in person, not to an address:
 * several registers behind one store router no longer share (and exhaust) one
 * budget. Only a token this server signed counts; anything else falls back to
 * the caller's address, so a made-up token cannot buy a fresh budget.
 */
export function requestBudgetKey(req: Request): string {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try { return 'user:' + verifyToken(header.slice(7)).userId; } catch { /* not ours or expired: use the address */ }
  }
  return 'ip:' + (req.ip || 'unknown');
}
