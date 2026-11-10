/**
 * Register → customer-display sync over a BroadcastChannel.
 *
 * The POS page broadcasts the cart on every change; the /customer-display route
 * (opened in a second window, dragged to the customer-facing monitor) renders
 * it. Same-origin browser windows only — no backend involved.
 */

export interface DisplayLine {
  name: string;
  quantity: number;
  lineTotal: number;
  promoName?: string;
}

export interface DisplayState {
  storeName: string;
  lines: DisplayLine[];
  subtotal: number;
  tax: number;
  total: number;
  promoSavings: number;
  /** While paying: card surcharge, points redeemed, and what has been paid so far. */
  payment?: { surcharge: number; pointsDiscount: number; due: number; paid: number } | null;
  /** Set after checkout completes so the display can thank the customer */
  completed?: { total: number; change: number } | null;
}

const CHANNEL = 'pos-customer-display';
const REQUEST = 'pos-customer-display:request';

// The register remembers what it last showed, so a display opened mid-sale
// asks for it and is current at once.
let lastPublished: DisplayState | null = null;
let responder: BroadcastChannel | null = null;
const post = (message: unknown) => {
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage(message);
    ch.close();
  } catch {
    // BroadcastChannel unsupported — customer display simply won't update
  }
};
const answerRequests = () => {
  if (responder) return;
  try {
    responder = new BroadcastChannel(CHANNEL);
    responder.onmessage = (e) => { if (e.data === REQUEST && lastPublished) post(lastPublished); };
  } catch { /* unsupported */ }
};

export const publishDisplayState = (state: DisplayState): void => {
  lastPublished = state;
  answerRequests();
  post(state);
};

/** Add or clear the payment progress on what the display already shows. */
export const publishDisplayPayment = (payment: DisplayState['payment']): void => {
  if (!lastPublished || lastPublished.completed) return;
  publishDisplayState({ ...lastPublished, payment });
};

export const subscribeDisplayState = (
  onState: (state: DisplayState) => void
): (() => void) => {
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e) => { if (e.data !== REQUEST) onState(e.data as DisplayState); };
    ch.postMessage(REQUEST);
    return () => ch.close();
  } catch {
    return () => {};
  }
};
