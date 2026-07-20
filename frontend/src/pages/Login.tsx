import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { authService } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { ShoppingCart, ShieldCheck, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';

type LoginStep = 'credentials' | 'twoFactor' | 'forgot';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const { login, error, isLoading, clearError } = useAuthStore();

  const [step, setStep] = useState<LoginStep>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const redirectAfterLogin = () => {
    const user = useAuthStore.getState().user;
    // Redirect SUPER_ADMIN to admin panel, others to dashboard
    if (user?.role === 'SUPER_ADMIN') {
      navigate('/admin');
    } else {
      navigate('/dashboard');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    try {
      const result = await login(email, password);
      if (result.requiresTwoFactor) {
        setStep('twoFactor');
        return;
      }
      redirectAfterLogin();
    } catch (err) {
      // Error is handled in the store
    }
  };

  const handleTwoFactorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    try {
      const result = await login(email, password, twoFactorCode.trim());
      if (result.requiresTwoFactor) {
        // Shouldn't happen when a code is sent, but stay on this step
        return;
      }
      redirectAfterLogin();
    } catch (err) {
      // Error is handled in the store
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotSubmitting(true);
    try {
      await authService.forgotPassword(forgotEmail);
      setForgotSent(true);
    } catch (err: any) {
      const message =
        err.code === 'ECONNABORTED'
          ? 'The request timed out. The email server may be unreachable — please try again shortly.'
          : err.response?.data?.error || 'Failed to send reset email';
      toast.error(message);
    } finally {
      setForgotSubmitting(false);
    }
  };

  const backToCredentials = () => {
    clearError();
    setTwoFactorCode('');
    setForgotSent(false);
    setStep('credentials');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4 shadow-lg">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-primary rounded-full">
              {step === 'twoFactor' ? (
                <ShieldCheck className="h-8 w-8 text-primary-foreground" />
              ) : (
                <ShoppingCart className="h-8 w-8 text-primary-foreground" />
              )}
            </div>
          </div>
          <CardTitle className="text-3xl">POS System</CardTitle>
          <p className="text-muted-foreground mt-2">
            {step === 'credentials' && 'Sign in to your account'}
            {step === 'twoFactor' && 'Two-factor authentication'}
            {step === 'forgot' && 'Reset your password'}
          </p>
        </CardHeader>

        <CardContent>
          {error && (
            <div className="p-3 mb-4 bg-destructive/10 border border-destructive rounded-md">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {step === 'credentials' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                type="email"
                label="Email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />

              <Input
                type="password"
                label="Password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={isLoading}
              >
                {isLoading ? 'Signing in...' : 'Sign In'}
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  className="text-sm text-primary hover:underline"
                  onClick={() => {
                    clearError();
                    setForgotEmail(email);
                    setStep('forgot');
                  }}
                >
                  Forgot password?
                </button>
              </div>
            </form>
          )}

          {step === 'twoFactor' && (
            <form onSubmit={handleTwoFactorSubmit} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Enter the 6-digit code from your authenticator app, or one of
                your 8-character backup codes.
              </p>

              <Input
                type="text"
                label="Verification code"
                placeholder="123456"
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value)}
                autoComplete="one-time-code"
                inputMode="text"
                maxLength={8}
                required
                autoFocus
              />

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={isLoading || twoFactorCode.trim().length < 6}
              >
                {isLoading ? 'Verifying...' : 'Verify'}
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1"
                  onClick={backToCredentials}
                >
                  <ArrowLeft className="h-3 w-3" />
                  Back to sign in
                </button>
              </div>
            </form>
          )}

          {step === 'forgot' && (
            <div className="space-y-4">
              {forgotSent ? (
                <div className="p-3 bg-muted rounded-md">
                  <p className="text-sm text-foreground">
                    If an account exists for <span className="font-medium">{forgotEmail}</span>,
                    a password reset link has been sent. Check your inbox.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleForgotSubmit} className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Enter your account email and we'll send you a link to reset
                    your password.
                  </p>

                  <Input
                    type="email"
                    label="Email"
                    placeholder="you@example.com"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    required
                    autoFocus
                  />

                  <Button
                    type="submit"
                    variant="primary"
                    className="w-full"
                    disabled={forgotSubmitting}
                  >
                    {forgotSubmitting ? 'Sending...' : 'Send reset link'}
                  </Button>
                </form>
              )}

              <div className="text-center">
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1"
                  onClick={backToCredentials}
                >
                  <ArrowLeft className="h-3 w-3" />
                  Back to sign in
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
