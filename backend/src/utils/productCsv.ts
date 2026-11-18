import { AppError } from './errorHandler';

const aliases: Record<string, string> = { product_name: 'name', productname: 'name', retail_price: 'price', wholesale_cost: 'cost', stockquantity: 'stock', quantity: 'stock', low_stock: 'lowstockalert', category_id: 'categoryid', upc: 'barcode', isactive: 'active' };
const columns = new Set(['name', 'sku', 'barcode', 'price', 'cost', 'stock', 'lowstockalert', 'categoryid', 'active', 'trackinventory', 'istaxable']);

/** RFC-style CSV: commas, escaped quotes, CRLF, BOM and quoted newlines. */
export function parseProductCsv(csv: string) {
  if (Buffer.byteLength(csv, 'utf8') > 1_000_000) throw new AppError('CSV must be at most 1 MB', 400);
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false, closed = false;
  const input = csv.replace(/^\uFEFF/, '');
  const finishField = () => { row.push(field.trim()); field = ''; closed = false; };
  const finishRow = () => { finishField(); if (row.some(Boolean)) rows.push(row); row = []; if (rows.length > 501) throw new AppError('Import at most 500 products at a time', 400); };
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') { if (input[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else field += char;
    } else if (char === ',') finishField();
    else if (char === '\n' || char === '\r') { if (char === '\r' && input[i + 1] === '\n') i++; finishRow(); }
    else if (char === '"') { if (field.trim() || closed) throw new AppError('Invalid CSV quoting', 400); field = ''; quoted = true; }
    else { if (closed && char.trim()) throw new AppError('Unexpected text after a CSV quote', 400); if (!closed) field += char; }
  }
  if (quoted) throw new AppError('CSV contains an unclosed quote', 400);
  if (field || row.length || closed) finishRow();
  if (rows.length < 2) throw new AppError('CSV needs a header and at least one product', 400);
  const headers = rows.shift()!.map(h => aliases[h.toLowerCase()] || h.toLowerCase());
  if (new Set(headers).size !== headers.length || headers.some(h => !columns.has(h))) throw new AppError('CSV has duplicate or unsupported columns', 400);
  if (!headers.includes('sku')) throw new AppError('CSV needs a sku column', 400);
  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new AppError(`Row ${index + 2}: expected ${headers.length} columns, received ${values.length}`, 400);
    return { number: index + 2, values: Object.fromEntries(headers.map((header, i) => [header, values[i]])) };
  });
}
