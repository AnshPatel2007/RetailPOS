import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';

/** Code 128 supports ordinary 1D scanners. Long legacy references retain QR. */
export function receiptBarcodeSvg(reference: string): string {
  if (!reference || reference.length > 24) return '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  JsBarcode(svg, reference, { format: 'CODE128', width: 2, height: 64, margin: 20, displayValue: false });
  svg.setAttribute('width', '100%'); svg.setAttribute('height', 'auto');
  svg.setAttribute('style', 'width:100%;height:auto');
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Receipt barcode ' + reference);
  svg.setAttribute('data-receipt-reference', reference);
  return svg.outerHTML;
}

export async function receiptCodeMarkup(reference: string): Promise<string> {
  const barcode = receiptBarcodeSvg(reference);
  if (barcode) return barcode;
  const image = await QRCode.toDataURL(reference, { margin: 4, width: 160 });
  return `<img src="${image}" width="120" height="120" alt="Receipt QR code" />`;
}
