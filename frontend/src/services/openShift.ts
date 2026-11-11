import { db } from './offlineDb';

/**
 * The signed-in cashier's open drawer, remembered on this register. A register
 * that starts while the server is unreachable still needs to know which drawer
 * its offline cash sales belong to. Updated whenever the server reports the
 * drawer (opened, read or closed) and cleared with the other register caches
 * at sign-out. If the drawer was closed elsewhere in the meantime, the queued
 * sale goes to the manager's offline review when it syncs.
 */
const KEY = 'open_shift';
interface Scope { userId: string; locationId: string }

const signedIn = (): Scope | null => {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    return typeof user?.id === 'string' && typeof user?.locationId === 'string' ? { userId: user.id, locationId: user.locationId } : null;
  } catch { return null; }
};

export async function rememberOpenShift(shiftId: string | null): Promise<void> {
  const scope = signedIn();
  if (!scope) return;
  try {
    if (shiftId) await db.settings.put({ key: KEY, value: { ...scope, shiftId, at: Date.now() } });
    else await db.settings.delete(KEY);
  } catch { /* storage is a convenience here; checkout checks it separately */ }
}

export async function recallOpenShift(scope: Scope): Promise<string | null> {
  try {
    const saved = (await db.settings.get(KEY))?.value;
    return saved && saved.userId === scope.userId && saved.locationId === scope.locationId && typeof saved.shiftId === 'string' ? saved.shiftId : null;
  } catch { return null; }
}
