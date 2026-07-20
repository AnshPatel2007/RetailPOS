/**
 * Price-embedded barcode parsing (in-store scale/deli labels).
 *
 * Convention: barcodes starting with "2" encode an item code and a price —
 *   UPC-A  (12 digits): 2 IIIII PPPPP C
 *   EAN-13 (13 digits): 02 IIIII PPPPP C
 * where IIIII identifies the product (matched against the product's barcode or
 * SKU) and PPPPP is the price in cents. Only products flagged `priceEmbedded`
 * accept the embedded price — the backend enforces the same rule.
 */

export interface EmbeddedBarcode {
  itemCode: string;
  price: number;
}

export const parsePriceEmbeddedBarcode = (barcode: string): EmbeddedBarcode | null => {
  let digits: string | null = null;

  if (/^2\d{11}$/.test(barcode)) {
    digits = barcode; // UPC-A
  } else if (/^02\d{11}$/.test(barcode)) {
    digits = barcode.slice(1); // EAN-13 with leading 0 → same layout
  }
  if (!digits) return null;

  const itemCode = digits.slice(1, 6);
  const cents = parseInt(digits.slice(6, 11), 10);
  if (!Number.isFinite(cents) || cents <= 0) return null;

  return { itemCode, price: Math.round(cents) / 100 };
};
