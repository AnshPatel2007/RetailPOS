import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';

export const ResetPassword: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setSubmitting(true);
    try {
      await authService.resetPassword(token, password);
      toast.success('Password reset successfully. Please sign in.');
      navigate('/login');
    } catch (err: any) {
      const data = err.response?.data;
      // Validation errors come back as { errors: [{ message }] }, others as { error }
      setError(
        data?.errors?.[0]?.message || data?.error || 'Failed to reset password'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4 shadow-lg">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-primary rounded-full">
              <KeyRound className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-3xl">Reset Password</CardTitle>
          <p className="text-muted-foreground mt-2">Choose a new password for your account</p>
        </CardHeader>

        <CardContent>
          {!token ? (
            <div className="space-y-4">
              <div className="p-3 bg-destructive/10 border border-destructive rounded-md">
                <p className="text-sm text-destructive">
                  This reset link is invalid or incomplete. Please request a new one.
                </p>
              </div>
              <div className="text-center">
                <Link to="/login" className="text-sm text-primary hover:underline">
                  Back to sign in
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 bg-destructive/10 border border-destructive rounded-md">
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}

              <Input
                type="password"
                label="New password"
                placeholder="Enter new password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />

              <Input
                type="password"
                label="Confirm new password"
                placeholder="Re-enter new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />

              <p className="text-xs text-muted-foreground">
                Must be at least 8 characters and include an uppercase letter, a
                lowercase letter, a number, and a special character.
              </p>

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={submitting}
              >
                {submitting ? 'Resetting...' : 'Reset Password'}
              </Button>

              <div className="text-center">
                <Link to="/login" className="text-sm text-muted-foreground hover:underline">
                  Back to sign in
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
