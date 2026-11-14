/**
 * The browser tests run under either look while both exist:
 *   E2E_LOOK=new node scripts/verify-pos.cjs browser <specs> --project=chromium
 * Only what a look deliberately changes is read from here.
 */
export const NEW_LOOK = process.env.E2E_LOOK === 'new';

/** Page titles: 24px in Classic; the New look's band titles are 26px on a phone and 34px from tablet width up. */
export const titleSize = (width: number) => !NEW_LOOK ? '24px' : width >= 640 ? '34px' : '26px';
