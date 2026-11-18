// Requests from an earlier login must never update or sign out a newer session.
let generation = 0;
export const sessionGeneration = () => generation;
export const changeSessionGeneration = () => ++generation;

/**
 * A cashier switch on a register ends the previous person's session on the server
 * before the new one reaches this browser. A request the previous person still had in
 * flight then fails to renew; it must wait for the switch instead of signing out.
 */
let pendingSignIn: Promise<void> | null = null;
export function trackSignIn<T>(work: Promise<T>): Promise<T> {
  const settled = work.then(() => undefined, () => undefined);
  pendingSignIn = settled;
  void settled.then(() => { if (pendingSignIn === settled) pendingSignIn = null; });
  return work;
}
export const signInSettled = (): Promise<void> => pendingSignIn ?? Promise.resolve();
