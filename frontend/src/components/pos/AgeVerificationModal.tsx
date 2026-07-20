import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ShieldAlert, ScanLine, Calendar, Eye, CheckCircle2, XCircle } from 'lucide-react';

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
}

/** Age in whole years as of today */
const ageFrom = (dob: Date): number => {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const beforeBirthday =
    now.getMonth() < dob.getMonth() ||
    (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());
  if (beforeBirthday) age -= 1;
  return age;
};

/**
 * Pull the date of birth out of an AAMVA driver's-license PDF417 payload.
 * The DBB element carries the DOB — MMDDCCYY in US jurisdictions (2000+ spec),
 * CCYYMMDD in some others; both are tried.
 */
const parseLicenseDob = (buffer: string): Date | null => {
  const match = buffer.match(/DBB(\d{8})/);
  if (!match) return null;
  const raw = match[1];

  // MMDDCCYY first (US)
  const mm = parseInt(raw.slice(0, 2), 10);
  const dd = parseInt(raw.slice(2, 4), 10);
  const yyyy = parseInt(raw.slice(4, 8), 10);
  if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 && yyyy > 1900 && yyyy <= new Date().getFullYear()) {
    return new Date(yyyy, mm - 1, dd);
  }

  // CCYYMMDD fallback
  const y2 = parseInt(raw.slice(0, 4), 10);
  const m2 = parseInt(raw.slice(4, 6), 10);
  const d2 = parseInt(raw.slice(6, 8), 10);
  if (m2 >= 1 && m2 <= 12 && d2 >= 1 && d2 <= 31 && y2 > 1900 && y2 <= new Date().getFullYear()) {
    return new Date(y2, m2 - 1, d2);
  }
  return null;
};

const toIsoDate = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * Gate for age-restricted sales. Three paths, all logged server-side with the
 * sale: scan the license barcode (auto-detects the DOB), type the DOB, or
 * visually confirm. An underage result blocks with a DO-NOT-SELL banner.
 */
export const AgeVerificationModal: React.FC<AgeVerificationModalProps> = ({
  isOpen,
  requiredAge,
  itemNames,
  onConfirm,
  onClose,
}) => {
  const [dobInput, setDobInput] = useState('');
  const [scannedDob, setScannedDob] = useState<Date | null>(null);
  const scanBuffer = useRef('');
  const scanTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (isOpen) {
      setDobInput('');
      setScannedDob(null);
      scanBuffer.current = '';
    }
  }, [isOpen]);

  // Capture scanner keystrokes while the modal is open. License PDF417 wedges
  // type the whole AAMVA payload; we buffer and look for the DBB element.
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key.length === 1 || e.key === 'Enter') {
      if (e.key.length === 1) scanBuffer.current += e.key;
      if (scanTimer.current) clearTimeout(scanTimer.current);
      const dob = parseLicenseDob(scanBuffer.current);
      if (dob) {
        setScannedDob(dob);
        scanBuffer.current = '';
        return;
      }
      // Idle reset so slow manual typing doesn't accumulate forever
      scanTimer.current = setTimeout(() => { scanBuffer.current = ''; }, 400);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (scanTimer.current) clearTimeout(scanTimer.current);
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const manualDob = dobInput ? new Date(dobInput + 'T00:00:00') : null;
  const manualAge = manualDob && !isNaN(manualDob.getTime()) ? ageFrom(manualDob) : null;
  const scannedAge = scannedDob ? ageFrom(scannedDob) : null;

  const cutoffYear = new Date().getFullYear() - requiredAge;
  const cutoff = new Date();
  cutoff.setFullYear(cutoffYear);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Age Verification Required" size="md">
      <div className="space-y-4">
        {/* Requirement banner */}
        <div className="flex items-start gap-3 p-3 rounded-lg bg-warning/10 border border-warning/30">
          <ShieldAlert className="h-8 w-8 text-warning shrink-0" />
          <div>
            <p className="font-bold text-lg">Customer must be {requiredAge}+</p>
            <p className="text-xs text-muted-foreground">
              Born on or before{' '}
              <span className="font-semibold text-foreground">
                {cutoff.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </span>
            </p>
            <p className="text-xs text-muted-foreground mt-1 truncate" title={itemNames.join(', ')}>
              Restricted: {itemNames.join(', ')}
            </p>
          </div>
        </div>

        {/* Scanned result */}
        {scannedDob && scannedAge !== null && (
          <div
            className={`p-3 rounded-lg border flex items-center gap-3 ${
              scannedAge >= requiredAge
                ? 'bg-success/10 border-success/40'
                : 'bg-destructive/10 border-destructive/40'
            }`}
          >
            {scannedAge >= requiredAge ? (
              <CheckCircle2 className="h-6 w-6 text-success shrink-0" />
            ) : (
              <XCircle className="h-6 w-6 text-destructive shrink-0" />
            )}
            <div className="flex-1">
              <p className="font-semibold">
                ID scanned — customer is {scannedAge}
              </p>
              <p className="text-xs text-muted-foreground">
                DOB {scannedDob.toLocaleDateString()}
              </p>
            </div>
            {scannedAge >= requiredAge ? (
              <Button
                variant="primary"
                onClick={() =>
                  onConfirm({ method: 'ID_SCAN', birthDate: toIsoDate(scannedDob), verifiedForAge: requiredAge })
                }
              >
                Approve
              </Button>
            ) : (
              <span className="text-sm font-bold text-destructive">DO NOT SELL</span>
            )}
          </div>
        )}

        {/* Scan prompt */}
        {!scannedDob && (
          <div className="p-4 rounded-lg border border-dashed text-center">
            <ScanLine className="h-6 w-6 mx-auto mb-1 text-muted-foreground animate-pulse" />
            <p className="text-sm font-medium">Scan the driver's license barcode</p>
            <p className="text-xs text-muted-foreground">PDF417 on the back of the ID — detected automatically</p>
          </div>
        )}

        {/* Manual DOB */}
        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium mb-1">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            Or enter date of birth
          </label>
          <div className="flex gap-2">
            <Input
              type="date"
              value={dobInput}
              onChange={(e) => setDobInput(e.target.value)}
              className="flex-1"
              max={toIsoDate(new Date())}
            />
            <Button
              variant="primary"
              disabled={manualAge === null || manualAge < requiredAge}
              onClick={() => {
                if (manualDob && manualAge !== null && manualAge >= requiredAge) {
                  onConfirm({ method: 'MANUAL_DOB', birthDate: toIsoDate(manualDob), verifiedForAge: requiredAge });
                }
              }}
            >
              Approve
            </Button>
          </div>
          {manualAge !== null && (
            <p className={`text-xs mt-1 font-medium ${manualAge >= requiredAge ? 'text-success' : 'text-destructive'}`}>
              {manualAge >= requiredAge
                ? `Customer is ${manualAge} — OK to sell`
                : `Customer is ${manualAge} — DO NOT SELL`}
            </p>
          )}
        </div>

        {/* Visual confirmation */}
        <div className="pt-2 border-t">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onConfirm({ method: 'VISUAL', verifiedForAge: requiredAge })}
          >
            <Eye className="h-4 w-4 mr-2" />
            I visually verified the customer is {requiredAge}+
          </Button>
          <p className="text-[11px] text-center text-muted-foreground mt-1.5">
            Every verification is logged with your name, time, and method
          </p>
        </div>
      </div>
    </Modal>
  );
};
