"use client";

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Network, Lock, Loader2, CheckCircle, XCircle, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from '@/components/ui/input-otp';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get?.('token') ?? '';
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingToken, setCheckingToken] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);

  // Check if token is valid and if MFA is required
  useEffect(() => {
    if (!token) {
      setCheckingToken(false);
      return;
    }

    const checkToken = async () => {
      try {
        const res = await fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        
        if (res.ok && data.valid) {
          setTokenValid(true);
          setMfaRequired(data.mfaRequired);
        } else {
          setTokenValid(false);
        }
      } catch {
        setTokenValid(false);
      } finally {
        setCheckingToken(false);
      }
    };

    checkToken();
  }, [token]);

  if (checkingToken) {
    return (
      <Card className="shadow-xl">
        <CardHeader className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin" />
          <CardDescription>Validating reset link...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!token || !tokenValid) {
    return (
      <Card className="shadow-xl">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <div className="p-3 rounded-full bg-red-500/10">
              <XCircle className="h-8 w-8 text-red-500" />
            </div>
          </div>
          <CardTitle className="text-2xl">Invalid Link</CardTitle>
          <CardDescription>
            This password reset link is invalid or has expired.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild className="w-full">
            <Link href="/forgot-password">Request New Link</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e?.preventDefault?.();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if ((password?.length ?? 0) < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (mfaRequired && !mfaToken) {
      setError('Please enter your MFA code');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          token, 
          password,
          mfaToken: mfaRequired ? mfaToken : undefined,
        }),
      });

      const data = await res?.json?.();

      if (!res?.ok) {
        if (data?.error === 'MFA_REQUIRED') {
          setMfaRequired(true);
          setError('MFA verification is required');
        } else {
          setError(data?.error ?? 'Reset failed');
        }
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        router?.push?.('/login');
      }, 3000);
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <Card className="shadow-xl">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <div className="p-3 rounded-full bg-green-500/10">
              <CheckCircle className="h-8 w-8 text-green-500" />
            </div>
          </div>
          <CardTitle className="text-2xl">Password Reset</CardTitle>
          <CardDescription>
            Your password has been reset successfully. Redirecting to sign in...
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild className="w-full">
            <Link href="/login">Sign In Now</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="shadow-xl">
      <CardHeader className="space-y-1 text-center">
        <div className="flex justify-center mb-4">
          <div className="p-3 rounded-full bg-primary/10">
            {mfaRequired ? (
              <Shield className="h-8 w-8 text-primary" />
            ) : (
              <Network className="h-8 w-8 text-primary" />
            )}
          </div>
        </div>
        <CardTitle className="text-2xl">Set new password</CardTitle>
        <CardDescription>
          {mfaRequired 
            ? 'MFA verification is required to reset your password'
            : 'Enter your new password below'
          }
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          {mfaRequired && (
            <div className="space-y-4 pb-4 border-b">
              <Label className="text-center block">
                {useBackupCode ? 'Enter backup code' : 'Enter MFA code from authenticator app'}
              </Label>
              {useBackupCode ? (
                <Input
                  type="text"
                  placeholder="Enter backup code"
                  value={mfaToken}
                  onChange={(e) => setMfaToken(e?.target?.value?.toUpperCase() ?? '')}
                  className="text-center font-mono tracking-wider"
                  maxLength={8}
                  disabled={loading}
                />
              ) : (
                <div className="flex justify-center">
                  <InputOTP
                    maxLength={6}
                    value={mfaToken}
                    onChange={(value) => setMfaToken(value)}
                    disabled={loading}
                  >
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                      <InputOTPSlot index={2} />
                    </InputOTPGroup>
                    <InputOTPSeparator />
                    <InputOTPGroup>
                      <InputOTPSlot index={3} />
                      <InputOTPSlot index={4} />
                      <InputOTPSlot index={5} />
                    </InputOTPGroup>
                  </InputOTP>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  setUseBackupCode(!useBackupCode);
                  setMfaToken('');
                }}
                className="text-sm text-primary hover:underline w-full text-center"
              >
                {useBackupCode ? 'Use authenticator app instead' : 'Use a backup code instead'}
              </button>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="password">New Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                placeholder="Create a new password"
                value={password}
                onChange={(e) => setPassword(e?.target?.value ?? '')}
                className="pl-10"
                required
                disabled={loading}
                minLength={8}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Confirm your new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e?.target?.value ?? '')}
                className="pl-10"
                required
                disabled={loading}
              />
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button 
            type="submit" 
            className="w-full" 
            disabled={loading || (mfaRequired && !useBackupCode && mfaToken.length !== 6)}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Reset Password
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <Card className="shadow-xl">
        <CardHeader className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin" />
        </CardHeader>
      </Card>
    }>
      <ResetPasswordForm />
    </Suspense>
  );
}
