export interface CheckoutAttempt {
  fingerprint: string;
  key: string;
  createdAt: number;
}

/** Reuse one identifier when the response is lost, including after a page reload. */
export function checkoutIdentity(storage: Pick<Storage, 'getItem' | 'setItem'>, fingerprint: string, uuid: () => string, now: number): CheckoutAttempt {
  try {
    const previous = JSON.parse(storage.getItem('pos-checkout-attempt') || 'null');
    if (previous?.fingerprint === fingerprint && typeof previous.key === 'string') {
      return { ...previous, createdAt: previous.createdAt || now };
    }
  } catch { /* Replace missing or invalid saved state. */ }
  const next = { fingerprint, key: uuid(), createdAt: now };
  storage.setItem('pos-checkout-attempt', JSON.stringify(next));
  return next;
}
