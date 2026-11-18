/**
 * Phone photos of an invoice are 4000+ pixels and several megabytes; the
 * reader needs about 2000. Shrinking on the phone keeps sending quick on a
 * store's connection and under the server's 5 MB a photo. PDFs pass through.
 */
export const MAX_INVOICE_PHOTO_SIDE = 2000;
export const MAX_INVOICE_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_INVOICE_PDF_BYTES = 15 * 1024 * 1024;

/** The size that fits within `max` pixels on the long side, never enlarged. */
export function fitWithin(width: number, height: number, max = MAX_INVOICE_PHOTO_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export class PhotoError extends Error {}

/** A photo ready to send: JPEG at most 2000 px on its long side (quality 0.85), or the PDF as it is. */
export async function prepareInvoicePage(file: File): Promise<{ blob: Blob; name: string }> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_INVOICE_PDF_BYTES) throw new PhotoError(`${file.name} is larger than 15 MB.`);
    return { blob: file, name: file.name || 'invoice.pdf' };
  }
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // A format this browser cannot draw: send it only when the server can read it as it is.
    if (/^image\/(jpeg|png|gif|webp)$/.test(file.type) && file.size <= MAX_INVOICE_PHOTO_BYTES) return { blob: file, name: file.name || 'invoice.jpg' };
    throw new PhotoError('This photo could not be opened. Take it with the camera here, or save it as a JPEG.');
  }
  try {
    const size = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new PhotoError('This photo could not be prepared. Try again.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new PhotoError('This photo could not be prepared. Try again.');
    const base = (file.name || 'invoice').replace(/\.[^.]+$/, '');
    return { blob, name: `${base}.jpg` };
  } finally {
    bitmap.close();
  }
}
