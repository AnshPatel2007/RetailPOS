import { useState } from 'react';
import { ImageOff, Package } from 'lucide-react';

/** Small reference image; an unavailable image never obscures product identity. */
export function ProductImage({ src, name, preview = false }: { src?: string | null; name: string; preview?: boolean }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const failed = !!src && failedSource === src;
  return <div className={preview ? 'product-image product-image-preview' : 'product-image'}>
    {src && !failed
      ? <img src={src} alt={preview ? `${name || 'Product'} preview` : ''} loading="lazy" onError={() => setFailedSource(src)} />
      : failed ? <ImageOff aria-label={preview ? 'Image unavailable' : undefined} aria-hidden={!preview} size={20} /> : <Package aria-hidden="true" size={20} />}
  </div>;
}
