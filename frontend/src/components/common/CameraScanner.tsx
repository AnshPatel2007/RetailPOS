import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface BarcodeReader { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> }
type BarcodeReaderClass = new () => BarcodeReader;

const readerClass = (): BarcodeReaderClass | null =>
  typeof window !== 'undefined' && 'BarcodeDetector' in window ? (window as unknown as { BarcodeDetector: BarcodeReaderClass }).BarcodeDetector : null;

/** True when this browser can read barcodes from the camera (Chrome on Android, for example). */
export const cameraScanningSupported = () => !!readerClass() && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

/** How long one code must leave the camera's view before it counts again. */
const REPEAT_AFTER_MS = 1500;

/**
 * A barcode field that always works (typing, or a USB scanner aimed while it
 * has focus) plus, where the browser can read barcodes, the phone's rear
 * camera. Holding the camera on one item counts it once; move away and back
 * to count it again.
 */
export function CameraScanner({ onCode, disabled = false, label = 'Barcode' }: { onCode: (code: string) => void; disabled?: boolean; label?: string }) {
  const [code, setCode] = useState('');
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const latest = useRef(onCode);
  latest.current = onCode;
  const supported = cameraScanningSupported();

  useEffect(() => { if (disabled) setActive(false); }, [disabled]);

  useEffect(() => {
    const Reader = readerClass();
    if (!active || !Reader) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: number | undefined;
    let last = { code: '', at: 0 };
    const reader = new Reader();
    const read = async () => {
      if (stopped) return;
      const element = video.current;
      try {
        if (element && element.readyState >= 2) {
          const value = (await reader.detect(element))[0]?.rawValue?.trim();
          const now = Date.now();
          if (value && !stopped) {
            if (value !== last.code || now - last.at > REPEAT_AFTER_MS) {
              try { navigator.vibrate?.(40); } catch { /* vibration is a convenience */ }
              latest.current(value);
            }
            last = { code: value, at: now };
          }
        }
      } catch { /* one unreadable frame; keep looking */ }
      if (!stopped) timer = window.setTimeout(read, 180);
    };
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stopped || !video.current) { stream.getTracks().forEach(track => track.stop()); return; }
        video.current.srcObject = stream;
        await video.current.play();
        setError('');
        void read();
      } catch (failure) {
        if (stopped) return;
        setError((failure as { name?: string }).name === 'NotAllowedError'
          ? 'Camera access was refused. Allow the camera for this site in the browser settings, or type the barcode.'
          : 'The camera did not start. Type the barcode, or use a USB scanner.');
        setActive(false);
      }
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach(track => track.stop());
      if (video.current) video.current.srcObject = null;
    };
  }, [active]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = code.trim();
    if (!value || disabled) return;
    setCode('');
    onCode(value);
  };

  return <div className="space-y-3">
    {active && <div className="relative overflow-hidden rounded-lg border bg-black">
      <video ref={video} className="aspect-[4/3] w-full object-cover" muted playsInline aria-label="Camera view" />
      <div className="pointer-events-none absolute inset-x-[12%] top-1/2 h-1/3 -translate-y-1/2 rounded-md border-2 border-white/80" aria-hidden="true" />
      <p className="absolute inset-x-0 bottom-0 bg-black/60 px-3 py-2 text-center text-xs text-white">Hold the barcode inside the box</p>
    </div>}
    <form onSubmit={submit} className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <Input label={label} value={code} onChange={event => setCode(event.target.value)} disabled={disabled}
          placeholder="Scan or type a barcode" autoComplete="off" autoCapitalize="off" spellCheck={false} enterKeyHint="enter" />
      </div>
      <Button type="submit" variant="outline" disabled={disabled || !code.trim()}>Add</Button>
      {supported && <Button type="button" variant={active ? 'secondary' : 'default'} disabled={disabled} onClick={() => { setError(''); setActive(on => !on); }}
        aria-pressed={active} aria-label={active ? 'Stop the camera' : 'Scan with the camera'}>
        {active ? <CameraOff className="h-4 w-4" aria-hidden="true" /> : <Camera className="h-4 w-4" aria-hidden="true" />}
        <span className="hidden sm:inline">{active ? 'Stop camera' : 'Camera'}</span>
      </Button>}
    </form>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
