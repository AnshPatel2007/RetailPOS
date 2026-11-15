import { formatDate } from '@/lib/utils';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DialogActions } from '@/components/ui/DialogActions';
import { ShieldAlert, ScanLine, Calendar, Eye, CheckCircle2, XCircle, Camera, CameraOff, Loader2 } from 'lucide-react';
import { ageOn, IdScan, isExpired, readIdBarcode } from '@/lib/idScan';
import { IdCameraReader, useIdCameraSupport } from './IdCameraReader';

export interface AgeVerificationResult {
  method: 'ID_SCAN' | 'MANUAL_DOB' | 'VISUAL';
  birthDate?: string; // ISO yyyy-mm-dd
  verifiedForAge: number;
}

interface AgeVerificationModalProps {
  isOpen: boolean;
  requiredAge: number;
  itemNames: string[];
  onConfirm: (result: AgeVerificationResult) => void;
  onClose: () => void;
  /** What closing without a check does (the register removes the item: "Remove item"). */
  cancelLabel?: string;
}

const toIsoDate = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Keys closer together than this come from a scanner; a pause this long ends the scan. */
const SCANNER_KEY_GAP_MS = 50;
const SCAN_END_MS = 150;

/**
 * Gate for age-restricted sales. Three ways, all logged with the sale: scan the
 * barcode on the back of the ID (a 2D USB scanner, or the camera where the browser
 * can read it), type the date of birth, or confirm visually. Under age, or an
 * expired ID, shows DO NOT SELL.
 */
export const AgeVerificationModal: React.FC<AgeVerificationModalProps> = ({
  isOpen,
  requiredAge,
  itemNames,
  onConfirm,
  onClose,
  cancelLabel,
}) => {
  const [dobInput, setDobInput] = useState('');
  const [scan, setScan] = useState<IdScan | null>(null);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const cameraSupported = useIdCameraSupport();
  const buffer = useRef('');
  const keyCount = useRef(0);
  const fastCount = useRef(0);
  const lastKeyAt = useRef(0);
  const endTimer = useRef<number>();

  useEffect(() => {
    if (isOpen) {
      setDobInput(''); setScan(null); setReading(false); setProblem(''); setCameraOn(false);
      buffer.current = '';
    }
  }, [isOpen]);

  const accept = useCallback((raw: string) => {
    const result = readIdBarcode(raw);
    // A license has two barcodes on the back; the small one at the top holds no details.
    if (!result) { setScan(null); setProblem('That barcode does not hold the ID\'s details. On the back of the license, scan the larger barcode (usually the lower one), not the small one at the top.'); return; }
    if (!result.birthDate) { setScan(null); setProblem('This ID\'s barcode has no date of birth that can be read. Type the date of birth instead.'); return; }
    setScan(result); setProblem(''); setDobInput(''); setCameraOn(false);
  }, []);

  // A USB or Bluetooth scanner types the ID's barcode as one fast burst of keys. Listen
  // before any field or button does, so a focused date box cannot swallow the burst and
  // an Enter inside it cannot press a button.
  useEffect(() => {
    if (!isOpen) return;
    const finish = () => {
      const text = buffer.current, keys = keyCount.current, fast = fastCount.current;
      buffer.current = ''; keyCount.current = 0; fastCount.current = 0;
      setReading(false);
      // A scanner types nearly every key fast; a person typing the date of birth does not.
      // Any scan is answered, so the small barcode at the top of a license says so.
      if (fast >= 5 && fast >= (keys - 1) * 0.8) accept(text);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.length === 1 ? event.key : event.key === 'Enter' || event.key === 'Tab' ? '\n' : null;
      if (key === null) return;
      const now = performance.now();
      const fromScanner = now - lastKeyAt.current < SCANNER_KEY_GAP_MS;
      lastKeyAt.current = now;
      // One scan lasts until a pause of SCAN_END_MS (a Bluetooth scanner may hesitate mid-way).
      buffer.current += key;
      keyCount.current += 1;
      if (fromScanner) fastCount.current += 1;
      if (fromScanner) {
        event.preventDefault();
        event.stopPropagation();
        if (buffer.current.length > 8) setReading(true);
      }
      window.clearTimeout(endTimer.current);
      endTimer.current = window.setTimeout(finish, SCAN_END_MS);
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.clearTimeout(endTimer.current);
    };
  }, [isOpen, accept]);

  if (!isOpen) return null;

  const manualDob = dobInput ? new Date(dobInput + 'T00:00:00') : null;
  const manualAge = manualDob && !isNaN(manualDob.getTime()) ? ageOn(manualDob) : null;
  const scannedAge = scan?.birthDate ? ageOn(scan.birthDate) : null;
  const expired = !!scan && isExpired(scan.expires);

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - requiredAge);

  // One Approve, in the footer: from the scanned ID when it shows the customer is old enough, otherwise from the typed date.
  const scanOk = !!scan?.birthDate && scannedAge !== null && scannedAge >= requiredAge && !expired;
  const manualOk = manualDob !== null && manualAge !== null && manualAge >= requiredAge;
  const approve = () => {
    if (scanOk && scan?.birthDate) onConfirm({ method: 'ID_SCAN', birthDate: toIsoDate(scan.birthDate), verifiedForAge: requiredAge });
    else if (manualOk && manualDob) onConfirm({ method: 'MANUAL_DOB', birthDate: toIsoDate(manualDob), verifiedForAge: requiredAge });
  };
  // What the cashier compares with the card and the customer (never stored).
  const place = scan ? [scan.city, scan.state].filter(Boolean).join(', ') : '';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Age Verification Required" size="md"
      footer={<DialogActions confirmLabel="Approve" onConfirm={approve} disabled={!scanOk && !manualOk} onCancel={onClose} cancelLabel={cancelLabel} />}>
      <div className="space-y-4">
        {/* Requirement banner */}
        <div className="flex items-start gap-3 p-3 rounded-lg bg-warning/10 border border-warning/30">
          <ShieldAlert className="h-8 w-8 text-warning shrink-0" />
          <div className="min-w-0">
            <p className="font-bold text-lg">Customer must be {requiredAge}+</p>
            <p className="text-xs text-muted-foreground">
              Born on or before{' '}
              <span className="font-semibold text-foreground">{formatDate(cutoff)}</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1 truncate" title={itemNames.join(', ')}>
              Restricted: {itemNames.join(', ')}
            </p>
          </div>
        </div>

        {/* Scanned result */}
        {scan?.birthDate && scannedAge !== null && (
          <div role="status" className={`p-3 rounded-lg border flex items-center gap-3 ${scanOk ? 'bg-success/10 border-success/40' : 'bg-destructive/10 border-destructive/40'}`}>
            {scanOk ? <CheckCircle2 className="h-6 w-6 text-success shrink-0" /> : <XCircle className="h-6 w-6 text-destructive shrink-0" />}
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{scan.name ?? 'Customer'} · {scannedAge} years old</p>
              <p className="text-xs text-muted-foreground">
                {[place, `Born ${formatDate(scan.birthDate)}`, scan.expires ? `${expired ? 'Expired' : 'Valid until'} ${formatDate(scan.expires)}` : ''].filter(Boolean).join(' · ')}
              </p>
              {expired
                ? <p className="text-xs font-medium text-destructive">This ID has expired. Ask for a valid ID.</p>
                : <p className="text-xs">Check that the {scan.name ? 'name, ' : ''}photo{place ? ' and city' : ''} on the card match the customer.</p>}
            </div>
            <span className={`text-sm font-bold ${scanOk ? 'text-success' : 'text-destructive'}`}>{scanOk ? 'OK to sell' : 'DO NOT SELL'}</span>
          </div>
        )}

        {/* Scan prompt */}
        {!scan && (cameraOn
          ? <div className="space-y-2">
            <IdCameraReader onRead={accept} onError={message => { setCameraOn(false); setProblem(message); }} />
            <Button type="button" variant="outline" className="w-full" onClick={() => setCameraOn(false)}><CameraOff className="h-4 w-4 mr-2" aria-hidden="true" />Stop camera</Button>
          </div>
          : <div className="p-4 rounded-lg border border-dashed text-center space-y-1">
            {reading ? <Loader2 className="h-6 w-6 mx-auto text-muted-foreground animate-spin" aria-hidden="true" />
              : <ScanLine className="h-6 w-6 mx-auto text-muted-foreground animate-pulse" aria-hidden="true" />}
            <p className="text-sm font-medium" role="status">{reading ? 'Reading the ID…' : 'Scan the barcode on the back of the driver\'s license or ID'}</p>
            <p className="text-xs text-muted-foreground">If the scanner does not beep on the ID, it cannot read ID barcodes: type the date of birth below.</p>
            {cameraSupported && <Button type="button" variant="outline" className="mt-2" onClick={() => { setProblem(''); setCameraOn(true); }}>
              <Camera className="h-4 w-4 mr-2" aria-hidden="true" />Scan with camera</Button>}
          </div>)}
        {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
        {scan && <Button type="button" variant="ghost" onClick={() => { setScan(null); setProblem(''); }}>Scan another ID</Button>}

        {/* Manual DOB */}
        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium mb-1">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            Or enter date of birth
          </label>
          <Input
            type="date"
            value={dobInput}
            onChange={(e) => setDobInput(e.target.value)}
            max={toIsoDate(new Date())}
          />
          {manualAge !== null && (
            <p className={`text-xs mt-1 font-medium ${manualAge >= requiredAge ? 'text-success' : 'text-destructive'}`}>
              {manualAge >= requiredAge
                ? `Customer is ${manualAge} — OK to sell`
                : `Customer is ${manualAge} — DO NOT SELL`}
            </p>
          )}
        </div>

        {/* Visual confirmation: the other way to approve, without an ID */}
        <div className="pt-2 border-t">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onConfirm({ method: 'VISUAL', verifiedForAge: requiredAge })}
          >
            <Eye className="h-4 w-4 mr-2" />
            I visually verified the customer is {requiredAge}+
          </Button>
          <p className="text-xs text-center text-muted-foreground mt-1.5">
            Every verification is logged with your name, time, and method
          </p>
        </div>
      </div>
    </Modal>
  );
};
