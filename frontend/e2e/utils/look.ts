/**
 * The browser tests run under either look while both exist:
 *   E2E_LOOK=new node scripts/verify-pos.cjs browser <specs> --project=chromium
 * Only what a look deliberately changes is read from here.
 */
export const NEW_LOOK = process.env.E2E_LOOK === 'new';

/** Page titles: 24px in Classic; the New look uses 30px from tablet width up. */
export const titleSize = (width: number) => NEW_LOOK && width >= 640 ? '30px' : '24px';
