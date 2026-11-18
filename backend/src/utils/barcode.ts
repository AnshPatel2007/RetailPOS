/**
 * Barcode identity shared by the register (on-device lookup) and the server.
 *
 * UPC-A, EAN-13 and GTIN-14 forms of one item differ only by leading zeros:
 * "049000000443", "0049000000443" and "00049000000443" are the same can, and a
 * scanner may send any of them. Codes of other lengths, or with letters, are a
 * store's own codes and match exactly.
 */
const GTIN_LENGTHS = [8, 12, 13, 14];

export const isGtin = (code: string) => /^\d+$/.test(code) && GTIN_LENGTHS.includes(code.length);

/** One lookup key per item: a GTIN as its 14-digit form, anything else as typed (trimmed). */
export function barcodeKey(code: string): string {
  const value = code.trim();
  return isGtin(value) ? value.padStart(14, '0') : value;
}

/** Every stored form that identifies the same item, for database lookups. */
export function barcodeVariants(code: string): string[] {
  const value = code.trim();
  if (!value) return [];
  if (!isGtin(value)) return [value];
  const digits = value.replace(/^0+/, '') || '0';
  const variants = new Set([value]);
  for (const length of GTIN_LENGTHS) if (digits.length <= length) variants.add(digits.padStart(length, '0'));
  return [...variants];
}
