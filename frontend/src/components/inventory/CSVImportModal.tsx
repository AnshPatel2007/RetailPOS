import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
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
  return <Modal isOpen={isOpen} onClose={close} title="Import Products from CSV" size="xl">
    <div className="space-y-4">
      {(fileError || workflow.error) && <p role="alert" className="text-sm text-destructive">{fileError || workflow.error}</p>}
      {workflow.pending ? <div className="space-y-3"><p>A saved import needs confirmation. Retrying retrieves the original result if it already completed.</p><Button disabled={workflow.busy} onClick={workflow.commit}>Retry saved import</Button></div>
        : workflow.result ? <div role="status"><p>Import complete: {workflow.result.created} created, {workflow.result.updated} updated.</p><Button className="mt-3" onClick={close}>Done</Button></div>
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
          <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={workflow.busy} onClick={close}>Cancel</Button>
            <Button variant="outline" disabled={!file || workflow.busy} onClick={review}>{workflow.busy ? 'Working...' : 'Review import'}</Button>
            {workflow.preview?.id && <Button disabled={workflow.busy} onClick={workflow.commit}>Apply reviewed import</Button>}
          </div>
        </>}
    </div>
  </Modal>;
}
