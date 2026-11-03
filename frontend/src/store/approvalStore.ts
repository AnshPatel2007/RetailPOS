import { create } from 'zustand';

export interface ApprovalRequest { method: 'POST'; path: string; body: Record<string, unknown>; }
interface ApprovalState {
  request: ApprovalRequest | null;
  finish: ((token: string | null) => void) | null;
}
export const useApprovalStore = create<ApprovalState>(() => ({ request: null, finish: null }));
export const cancelApproval = () => useApprovalStore.getState().finish?.(null);
export function requestManagerApproval(request: ApprovalRequest): Promise<string> {
  if (useApprovalStore.getState().request) return Promise.reject(new Error('Finish the current manager approval first'));
  return new Promise((resolve, reject) => useApprovalStore.setState({ request, finish: token => {
    useApprovalStore.setState({ request: null, finish: null });
    if (token) resolve(token); else reject(new Error('Manager approval cancelled. No changes were made.'));
  } }));
}
