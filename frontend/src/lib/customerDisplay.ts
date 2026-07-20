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
  /** Set after checkout completes so the display can thank the customer */
  completed?: { total: number; change: number } | null;
}

const CHANNEL = 'pos-customer-display';

export const publishDisplayState = (state: DisplayState): void => {
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage(state);
    ch.close();
  } catch {
    // BroadcastChannel unsupported — customer display simply won't update
  }
};

export const subscribeDisplayState = (
  onState: (state: DisplayState) => void
): (() => void) => {
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e) => onState(e.data as DisplayState);
    return () => ch.close();
  } catch {
    return () => {};
  }
};
