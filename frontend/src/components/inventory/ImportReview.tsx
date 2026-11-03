import { ImportPreview } from '@/hooks/useInventoryImport';

const display = (value: unknown) => value == null ? 'New' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value);
const fieldLabels: Record<string, string> = { name: 'Name', barcode: 'Barcode', price: 'Retail price', cost: 'Unit cost', stockQuantity: 'Stock', lowStockAlert: 'Low-stock alert', categoryId: 'Category', isActive: 'Active', trackInventory: 'Track stock', isTaxable: 'Taxable' };
export function ImportReview({ preview }: { preview: ImportPreview }) {
  return <div className="space-y-3">
    <p>{preview.total} rows: {preview.created} new products, {preview.updated} existing products.</p>
    <p className="text-sm text-muted-foreground">Review every change before applying. Blank optional CSV fields keep existing values. If a product changes after this preview, refresh the review before applying.</p>
    {preview.errors.length > 0 && <div role="alert" className="max-h-40 overflow-y-auto rounded border border-destructive p-3 text-sm">
      {preview.errors.map((error, i) => <p key={i}>{error}</p>)}
    </div>}
    <div className="max-h-80 overflow-auto rounded border">
      <table className="w-full text-sm"><thead className="sticky top-0 bg-background"><tr><th className="p-2 text-left">Row / SKU</th><th className="p-2 text-left">Changes</th><th className="p-2 text-right">Stock</th></tr></thead>
        <tbody>{preview.rows.map(row => <tr key={row.number} className="border-t">
          <td className="p-2 align-top">{row.number}: {row.data.sku}<p className="text-muted-foreground">{row.data.name}</p></td>
          <td className="p-2">{row.changes.length ? row.changes.map(change => <p key={change.field}>{fieldLabels[change.field] || change.field}: {display(change.before)} → {display(change.after)}</p>) : 'No field changes'}</td>
          <td className="p-2 text-right align-top tabular-nums whitespace-nowrap">{row.previousStock} → {row.nextStock}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
