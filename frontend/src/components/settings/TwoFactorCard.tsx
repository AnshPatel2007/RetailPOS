import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { twoFactorService } from '@/services/api';
import { ShieldCheck, ShieldOff, Copy, Download } from 'lucide-react';
import toast from 'react-hot-toast';

type Phase = 'loading' | 'disabled' | 'setup' | 'backupCodes' | 'enabled';

export const TwoFactorCard: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('loading');
  const [backupCodesRemaining, setBackupCodesRemaining] = useState(0);

  // Setup flow state
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Disable / regenerate state
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [showDisableForm, setShowDisableForm] = useState(false);
  const [showRegenerateForm, setShowRegenerateForm] = useState(false);
  const [regeneratePassword, setRegeneratePassword] = useState('');

  const loadStatus = async () => {
    try {
      const { data } = await twoFactorService.getStatus();
      setBackupCodesRemaining(data.data.backupCodesRemaining);
      setPhase(data.data.enabled ? 'enabled' : 'disabled');
    } catch {
      toast.error('Failed to load two-factor authentication status');
      setPhase('disabled');
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleStartSetup = async () => {
    setSubmitting(true);
    try {
      const { data } = await twoFactorService.setup();
      setQrCode(data.data.qrCode);
      setSecret(data.data.secret);
      setVerifyCode('');
      setPhase('setup');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to start 2FA setup');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data } = await twoFactorService.verify(verifyCode.trim());
      setBackupCodes(data.data.backupCodes);
      setPhase('backupCodes');
      toast.success('Two-factor authentication enabled');
    } catch (err: any) {
      const resp = err.response?.data;
      toast.error(resp?.errors?.[0]?.message || resp?.error || 'Invalid verification code');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await twoFactorService.disable(disablePassword, disableCode.trim() || undefined);
      toast.success('Two-factor authentication disabled');
      setShowDisableForm(false);
      setDisablePassword('');
      setDisableCode('');
      await loadStatus();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to disable 2FA');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data } = await twoFactorService.regenerateBackupCodes(regeneratePassword);
      setBackupCodes(data.data.backupCodes);
      setShowRegenerateForm(false);
      setRegeneratePassword('');
      setPhase('backupCodes');
      toast.success('New backup codes generated');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to regenerate backup codes');
    } finally {
      setSubmitting(false);
    }
  };

  const copyBackupCodes = () => {
    navigator.clipboard.writeText(backupCodes.join('\n'));
    toast.success('Backup codes copied to clipboard');
  };

  const downloadBackupCodes = () => {
    const blob = new Blob(
      [`POS System 2FA backup codes\n\n${backupCodes.join('\n')}\n`],
      { type: 'text/plain' }
    );
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'pos-backup-codes.txt');
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center">
          <ShieldCheck className="h-5 w-5 mr-2" />
          Two-Factor Authentication
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {phase === 'loading' && (
          <p className="text-sm text-muted-foreground">Loading...</p>
        )}

        {phase === 'disabled' && (
          <>
            <p className="text-sm text-muted-foreground">
              Add an extra layer of security to your account. After enabling,
              signing in requires a code from your authenticator app.
            </p>
            <Button variant="primary" onClick={handleStartSetup} disabled={submitting}>
              {submitting ? 'Preparing...' : 'Enable Two-Factor Authentication'}
            </Button>
          </>
        )}

        {phase === 'setup' && (
          <form onSubmit={handleVerify} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              1. Scan this QR code with your authenticator app (Google
              Authenticator, Authy, 1Password, etc.):
            </p>
            <div className="flex justify-center">
              <img
                src={qrCode}
                alt="2FA QR code"
                className="w-44 h-44 rounded-md border border-border bg-white p-1"
              />
            </div>
            <p className="text-xs text-muted-foreground break-all">
              Can't scan? Enter this key manually:{' '}
              <span className="font-mono text-foreground">{secret}</span>
            </p>
            <p className="text-sm text-muted-foreground">
              2. Enter the 6-digit code from the app to confirm:
            </p>
            <div className="max-w-xs">
              <Input
                label="Verification code"
                placeholder="123456"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
                autoComplete="one-time-code"
                maxLength={6}
                required
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="primary"
                disabled={submitting || verifyCode.trim().length !== 6}
              >
                {submitting ? 'Verifying...' : 'Verify & Enable'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setPhase('disabled')}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {phase === 'backupCodes' && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-foreground">
              Save these backup codes now — they won't be shown again.
            </p>
            <p className="text-sm text-muted-foreground">
              Each code can be used once to sign in if you lose access to your
              authenticator app.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-4 bg-muted rounded-md font-mono text-sm">
              {backupCodes.map((code) => (
                <span key={code}>{code}</span>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={copyBackupCodes}>
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </Button>
              <Button variant="outline" onClick={downloadBackupCodes}>
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
              <Button variant="primary" onClick={() => { setBackupCodes([]); loadStatus(); }}>
                I've saved my codes
              </Button>
            </div>
          </div>
        )}

        {phase === 'enabled' && (
          <>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary text-sm font-medium">
                <ShieldCheck className="h-4 w-4" />
                Enabled
              </span>
              <span className="text-sm text-muted-foreground">
                {backupCodesRemaining} backup {backupCodesRemaining === 1 ? 'code' : 'codes'} remaining
              </span>
            </div>

            {!showDisableForm && !showRegenerateForm && (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowRegenerateForm(true)}>
                  Regenerate Backup Codes
                </Button>
                <Button variant="outline" onClick={() => setShowDisableForm(true)}>
                  <ShieldOff className="h-4 w-4 mr-2" />
                  Disable
                </Button>
              </div>
            )}

            {showRegenerateForm && (
              <form onSubmit={handleRegenerate} className="space-y-4 max-w-sm">
                <p className="text-sm text-muted-foreground">
                  This replaces all existing backup codes. Confirm your password
                  to continue.
                </p>
                <Input
                  label="Password"
                  type="password"
                  value={regeneratePassword}
                  onChange={(e) => setRegeneratePassword(e.target.value)}
                  required
                />
                <div className="flex gap-2">
                  <Button type="submit" variant="primary" disabled={submitting || !regeneratePassword}>
                    {submitting ? 'Generating...' : 'Generate New Codes'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { setShowRegenerateForm(false); setRegeneratePassword(''); }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}

            {showDisableForm && (
              <form onSubmit={handleDisable} className="space-y-4 max-w-sm">
                <p className="text-sm text-muted-foreground">
                  Confirm your password (and optionally a current 2FA code) to
                  turn off two-factor authentication.
                </p>
                <Input
                  label="Password"
                  type="password"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  required
                />
                <Input
                  label="2FA code (optional)"
                  placeholder="123456"
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value)}
                  maxLength={6}
                />
                <div className="flex gap-2">
                  <Button type="submit" variant="destructive" disabled={submitting || !disablePassword}>
                    {submitting ? 'Disabling...' : 'Disable 2FA'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { setShowDisableForm(false); setDisablePassword(''); setDisableCode(''); }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
