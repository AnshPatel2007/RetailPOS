import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/LoadingState';
import { BarcodeLabelPrint } from '@/components/inventory/BarcodeLabelPrint';
import { PendingLabel, productService } from '@/services/api';
import { sessionGeneration } from '@/services/sessionGeneration';
import { Product } from '@/types';

export interface LabelTarget { productId: string; sellingUnitId: string | null }

/**
 * Prints the shelf labels whose price changed since they were last printed
 * (or only `only`, e.g. the prices just applied in Price Review) and, once the
 * person confirms they printed, takes them off the list.
 */
export function ShelfLabelsDialog({ isOpen, onClose, only }: { isOpen: boolean; onClose: () => void; only?: LabelTarget[] }) {
  const [items, setItems] = useState<PendingLabel[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const filter = useRef(only);
  filter.current = only;
  const onlyKey = only ? JSON.stringify(only) : '';

  useEffect(() => {
    if (!isOpen) { setItems(null); setError(''); return; }
    const controller = new AbortController();
    const generation = sessionGeneration();
    setItems(null); setError('');
    productService.pendingLabels(controller.signal).then(response => {
      if (generation !== sessionGeneration()) return;
      const wanted = filter.current;
      setItems(wanted ? response.data.data.items.filter(item => wanted.some(target => target.productId === item.productId && (target.sellingUnitId ?? null) === item.sellingUnitId))
        : response.data.data.items);
    }).catch(failure => {
      if (!controller.signal.aborted && generation === sessionGeneration()) setError((failure as { response?: { data?: { error?: string } } }).response?.data?.error || 'Labels to print did not load.');
    });
    return () => controller.abort();
  }, [isOpen, onlyKey, attempt]);

  // The label sheet takes products; a pack prints with its own name, barcode and price.
  const products = useMemo(() => (items || []).map(item => ({ id: item.id, name: item.name, sku: item.sku, barcode: item.barcode, price: item.price }) as Product), [items]);

  const markPrinted = async (printed: Product[]) => {
    const chosen = (items || []).filter(item => printed.some(product => product.id === item.id));
    await productService.labelsPrinted({
      products: chosen.filter(item => item.kind === 'PRODUCT').map(item => ({ id: item.id, priceChangedAt: item.priceChangedAt })),
      sellingUnits: chosen.filter(item => item.kind === 'PACK').map(item => ({ id: item.id, priceChangedAt: item.priceChangedAt })),
    });
    toast.success(chosen.length === 1 ? 'Label marked printed' : `${chosen.length} labels marked printed`);
    onClose();
  };

  if (!isOpen) return null;
  if (items && items.length) return <BarcodeLabelPrint isOpen onClose={onClose} products={products} onPrinted={markPrinted} />;
  return <Modal isOpen onClose={onClose} title="Labels to print" size="sm">
    {error ? <div role="alert" className="space-y-3"><p className="text-sm">{error}</p><Button variant="outline" onClick={() => setAttempt(n => n + 1)}>Retry</Button></div>
      : !items ? <div className="flex justify-center py-6"><Spinner /></div>
      : <div className="space-y-3"><p className="text-sm text-muted-foreground">Every shelf label shows the current price.</p><div className="flex justify-end"><Button onClick={onClose}>Close</Button></div></div>}
  </Modal>;
}
