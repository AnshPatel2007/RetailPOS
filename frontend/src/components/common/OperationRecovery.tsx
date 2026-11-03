import { Button } from '@/components/ui/Button';
import { useSavedOperation } from '@/hooks/useSavedOperation';
export function OperationRecovery({ operation }: { operation: ReturnType<typeof useSavedOperation> }) {
  if (!operation.pending && !operation.error && !operation.storageError) return null;
  return <div className="rounded-md border p-4 space-y-3">
    {operation.pending && <><p role="status">Saved operation: {operation.pending.label}. Confirm its result before recording another payment or adjustment.</p><Button disabled={operation.busy || operation.storageError} onClick={operation.retry}>{operation.busy ? 'Confirming...' : 'Retry saved operation'}</Button></>}
    {operation.error && <p role="alert" className="text-destructive">{operation.error}</p>}
    {operation.storageError && <Button variant="outline" disabled={operation.busy} onClick={operation.refreshStorage}>Retry recovery storage</Button>}
  </div>;
}
