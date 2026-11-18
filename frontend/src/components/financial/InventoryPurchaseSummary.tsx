import { formatCurrency } from '@/lib/utils';

/** Receipt value and purchase expense entries may describe the same acquisition. */
export function InventoryPurchaseSummary({ received, purchaseEntries }: { received?: number | null; purchaseEntries?: number }) {
  return <div className="border-t pt-4 text-sm text-muted-foreground space-y-2">
    <div className="flex justify-between gap-4 font-medium">
      <span>Inventory received at cost</span>
      <span className="whitespace-nowrap">{received == null ? 'Unavailable' : formatCurrency(received)}</span>
    </div>
    <p>Purchases enter inventory when received. Their cost reduces profit as goods sell.</p>
    {!!purchaseEntries && <>
      <div className="flex justify-between gap-4"><span>Inventory purchase expense entries</span><span className="whitespace-nowrap">{formatCurrency(purchaseEntries)}</span></div>
      <p className="text-xs">These entries may cover the same deliveries. They are excluded from operating expenses.</p>
    </>}
  </div>;
}
