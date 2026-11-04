import { useCallback, useEffect, useState } from 'react';
import { productService } from '@/services/api';
import type { ProductPackaging } from '@/types';

/** A supplier case: how the product is bought (e.g. 24 cans for $36). */
export interface SupplierCase {
  supplierId: string; supplierName: string; supplierSku: string | null;
  packSize: number; packCost: number | null; cost: number | null; minOrder: number | null;
}
export type PackagingView = ProductPackaging & { name: string; cost: number; suppliers?: SupplierCase[] };

/** One item's packs (e.g. its carton) and supplier cases, shared by the product form's sections. */
export function useProductPackaging(productId: string | null | undefined) {
  const [data, setData] = useState<PackagingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!productId) { setData(null); return; }
    try {
      const res = await productService.getSellingUnits(productId);
      setData(res.data.data); setError(null);
    } catch (err: any) { setError(err.response?.data?.error || 'Could not load packs'); }
  }, [productId]);
  useEffect(() => { setData(null); void reload(); }, [reload]);
  return { data, error, reload };
}
