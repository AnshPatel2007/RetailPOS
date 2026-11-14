import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { DialogActions } from '@/components/ui/DialogActions';
import { ImportReview } from './ImportReview';
import { useInventoryImport } from '@/hooks/useInventoryImport';

interface Props { isOpen: boolean; onClose: () => void; onImportComplete: () => void }
export function CSVImportModal({ isOpen, onClose, onImportComplete }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const workflow = useInventoryImport('CSV', onImportComplete, isOpen);
  const close = () => { if (!workflow.busy) { setFile(null); setFileError(''); onClose(); } };
  const review = async () => {
    if (!file) return;
    try { await workflow.review({ csv: await file.text() }); }
    catch { setFileError('This file could not be read. Select it again.'); }
  };
  // The footer's main button follows the steps: review the file, then apply the reviewed import.
  const footer = workflow.pending
    ? <DialogActions onCancel={close} confirmLabel="Retry saved import" onConfirm={() => void workflow.commit()} loading={workflow.busy} />
    : workflow.result
      ? <DialogActions confirmLabel="Done" onConfirm={close} />
      : <DialogActions onCancel={close} loading={workflow.busy}
        {...(workflow.preview?.id
          ? { confirmLabel: 'Apply reviewed import', onConfirm: () => void workflow.commit() }
          : { confirmLabel: 'Review import', onConfirm: () => void review(), disabled: !file })}>
        {workflow.preview?.id && <Button disabled={!file || workflow.busy} onClick={() => void review()}>Review import</Button>}
      </DialogActions>;
  return <Modal isOpen={isOpen} onClose={close} title="Import Products from CSV" size="xl" footer={footer}>
    <div className="space-y-4">
      {(fileError || workflow.error) && <p role="alert" className="text-sm text-destructive">{fileError || workflow.error}</p>}
      {workflow.pending ? <p>A saved import needs confirmation. Retrying retrieves the original result if it already completed.</p>
        : workflow.result ? <p role="status">Import complete: {workflow.result.created} created, {workflow.result.updated} updated.</p>
        : <>
          <label className="block text-sm font-medium">CSV file (up to 1 MB, 500 products)
            <input aria-label="CSV file" className="mt-2 block w-full" type="file" accept=".csv,text/csv" disabled={workflow.busy} onChange={event => {
              const selected = event.target.files?.[0]; workflow.resetPreview(); setFileError('');
              if (selected && (!selected.name.toLowerCase().endsWith('.csv') || selected.size > 1_000_000)) { setFile(null); setFileError('Select a CSV file up to 1 MB.'); return; }
              setFile(selected || null);
            }} />
          </label>
          <p className="text-sm text-muted-foreground">Match products by exact SKU within this store. New products require name and price. Optional columns: barcode, cost, stock, lowstockalert, categoryid, active, trackinventory, istaxable. Use true/false for switches.</p>
          {workflow.preview && <ImportReview preview={workflow.preview} />}
        </>}
    </div>
  </Modal>;
}
