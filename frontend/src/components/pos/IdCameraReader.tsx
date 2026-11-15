import { useEffect, useRef, useState } from 'react';

interface Reader { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> }
interface ReaderClass { new (options?: { formats: string[] }): Reader; getSupportedFormats?: () => Promise<string[]> }

const readerClass = (): ReaderClass | null =>
  typeof window !== 'undefined' && 'BarcodeDetector' in window ? (window as unknown as { BarcodeDetector: ReaderClass }).BarcodeDetector : null;

/**
 * Whether this browser can read an ID card's barcode (PDF417) from the camera: Chrome on
 * Android and on a Mac can; Windows computers and iPhones cannot, so there the ID is
 * scanned with a 2D USB scanner or its date of birth is typed.
 */
export function useIdCameraSupport() {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    const Reader = readerClass();
    if (!Reader || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
    let live = true;
    Promise.resolve<string[]>(Reader.getSupportedFormats?.() ?? [])
      .then(formats => { if (live) setSupported(formats.includes('pdf417')); })
      .catch(() => { /* no camera reading here */ });
    return () => { live = false; };
  }, []);
  return supported;
}

/** The rear camera, reading the barcode on the back of an ID card until it finds one. */
export function IdCameraReader({ onRead, onError }: { onRead: (raw: string) => void; onError: (message: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const handlers = useRef({ onRead, onError });
  handlers.current = { onRead, onError };

  useEffect(() => {
    const Reader = readerClass();
    if (!Reader) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: number | undefined;
    const reader = new Reader({ formats: ['pdf417'] });
    const read = async () => {
      if (stopped) return;
      const element = video.current;
      try {
        if (element && element.readyState >= 2) {
          const value = (await reader.detect(element))[0]?.rawValue;
          if (value && !stopped) { handlers.current.onRead(value); return; }
        }
      } catch { /* one unreadable frame; keep looking */ }
      if (!stopped) timer = window.setTimeout(read, 200);
    };
    (async () => {
      try {
        // An ID barcode is wide and dense: ask for a sharp picture.
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false });
        if (stopped || !video.current) { stream.getTracks().forEach(track => track.stop()); return; }
        video.current.srcObject = stream;
        await video.current.play();
        void read();
      } catch (failure) {
        if (stopped) return;
        handlers.current.onError((failure as { name?: string }).name === 'NotAllowedError'
          ? 'Camera access was refused. Allow the camera for this site in the browser settings, or type the date of birth.'
          : 'The camera did not start. Type the date of birth instead.');
      }
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach(track => track.stop());
      if (video.current) video.current.srcObject = null;
    };
  }, []);

  return <div className="relative overflow-hidden rounded-lg border bg-black">
    <video ref={video} className="aspect-[4/3] w-full object-cover" muted playsInline aria-label="Camera view" />
    <div className="pointer-events-none absolute inset-x-[6%] top-1/2 h-2/5 -translate-y-1/2 rounded-md border-2 border-white/80" aria-hidden="true" />
    <p className="absolute inset-x-0 bottom-0 bg-black/60 px-3 py-2 text-center text-xs text-white">Hold the barcode on the back of the ID inside the box</p>
  </div>;
}
