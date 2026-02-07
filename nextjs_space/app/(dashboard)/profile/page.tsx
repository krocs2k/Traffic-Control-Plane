"use client";

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import {
  User,
  Mail,
  Lock,
  Loader2,
  Monitor,
  Trash2,
  Save,
  Shield,
  ShieldCheck,
  ShieldOff,
  Copy,
  Check,
  RefreshCw,
  Key,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from '@/components/ui/input-otp';
import { parseUserAgent, formatDateTime } from '@/lib/utils';

interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  mfaEnabled: boolean;
  createdAt: Date;
}

interface SessionInfo {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
}

interface MfaSetupData {
  qrCodeUrl: string;
  backupCodes: string[];
}

export default function ProfilePage() {
  const { data: session, status, update } = useSession() || {};
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  
  const [name, setName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // MFA states
  const [mfaSetupOpen, setMfaSetupOpen] = useState(false);
  const [mfaDisableOpen, setMfaDisableOpen] = useState(false);
  const [mfaBackupCodesOpen, setMfaBackupCodesOpen] = useState(false);
  const [mfaSetupData, setMfaSetupData] = useState<MfaSetupData | null>(null);
  const [mfaToken, setMfaToken] = useState('');
  const [mfaPassword, setMfaPassword] = useState('');
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaError, setMfaError] = useState('');
  const [mfaStep, setMfaStep] = useState<'qr' | 'verify' | 'backup'>('qr');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [backupCodesCount, setBackupCodesCount] = useState(0);
  const [copiedBackupCodes, setCopiedBackupCodes] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router?.replace?.('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session?.user?.id) {
      fetchProfile();
      fetchSessions();
    }
  }, [session?.user?.id]);

  const fetchProfile = async () => {
    try {
      const res = await fetch('/api/profile');
      if (res?.ok) {
        const data = await res?.json?.();
        setProfile(data?.user ?? null);
        setName(data?.user?.name ?? '');
      }
    } catch (error) {
      console.error('Failed to fetch profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/sessions');
      if (res?.ok) {
        const data = await res?.json?.();
        setSessions(data?.sessions ?? []);
      }
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
    }
  };

  const fetchBackupCodesCount = async () => {
    try {
      const res = await fetch('/api/auth/mfa/backup-codes');
      if (res?.ok) {
        const data = await res?.json?.();
        setBackupCodesCount(data?.remainingBackupCodes ?? 0);
      }
    } catch (error) {
      console.error('Failed to fetch backup codes count:', error);
    }
  };

  useEffect(() => {
    if (profile?.mfaEnabled) {
      fetchBackupCodesCount();
    }
  }, [profile?.mfaEnabled]);

  // MFA Setup
  const handleStartMfaSetup = async () => {
    setMfaLoading(true);
    setMfaError('');
    setMfaStep('qr');
    setMfaToken('');
    
    try {
      const res = await fetch('/api/auth/mfa/setup', { method: 'POST' });
      const data = await res?.json?.();
      
      if (!res?.ok) {
        setMfaError(data?.error ?? 'Failed to start MFA setup');
        return;
      }
      
      setMfaSetupData({
        qrCodeUrl: data?.qrCodeUrl ?? '',
        backupCodes: data?.backupCodes ?? [],
      });
      setMfaSetupOpen(true);
    } catch (err) {
      setMfaError('An unexpected error occurred');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleVerifyMfa = async () => {
    if (mfaToken.length !== 6) return;
    
    setMfaLoading(true);
    setMfaError('');
    
    try {
      const res = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: mfaToken }),
      });
      
      const data = await res?.json?.();
      
      if (!res?.ok) {
        setMfaError(data?.error ?? 'Invalid code');
        return;
      }
      
      setMfaStep('backup');
      setBackupCodes(mfaSetupData?.backupCodes ?? []);
    } catch (err) {
      setMfaError('An unexpected error occurred');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleCompleteMfaSetup = () => {
    setMfaSetupOpen(false);
    setMfaSetupData(null);
    setMfaToken('');
    setMfaStep('qr');
    setBackupCodes([]);
    fetchProfile();
    setSuccess('Two-factor authentication has been enabled');
  };

  const handleDisableMfa = async () => {
    setMfaLoading(true);
    setMfaError('');
    
    try {
      const res = await fetch('/api/auth/mfa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          mfaToken: mfaToken || undefined,
          password: mfaPassword || undefined,
        }),
      });
      
      const data = await res?.json?.();
      
      if (!res?.ok) {
        setMfaError(data?.error ?? 'Failed to disable MFA');
        return;
      }
      
      setMfaDisableOpen(false);
      setMfaToken('');
      setMfaPassword('');
      fetchProfile();
      setSuccess('Two-factor authentication has been disabled');
    } catch (err) {
      setMfaError('An unexpected error occurred');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleRegenerateBackupCodes = async () => {
    if (mfaToken.length !== 6) return;
    
    setMfaLoading(true);
    setMfaError('');
    
    try {
      const res = await fetch('/api/auth/mfa/backup-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfaToken }),
      });
      
      const data = await res?.json?.();
      
      if (!res?.ok) {
        setMfaError(data?.error ?? 'Failed to regenerate backup codes');
        return;
      }
      
      setBackupCodes(data?.backupCodes ?? []);
      setMfaToken('');
      fetchBackupCodesCount();
    } catch (err) {
      setMfaError('An unexpected error occurred');
    } finally {
      setMfaLoading(false);
    }
  };

  const copyBackupCodes = () => {
    const text = backupCodes.join('\\n');
    navigator.clipboard.writeText(text);
    setCopiedBackupCodes(true);
    setTimeout(() => setCopiedBackupCodes(false), 2000);
  };

  const handleUpdateProfile = async () => {
    setError('');
    setSuccess('');
    setSaving(true);

    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      const data = await res?.json?.();

      if (!res?.ok) {
        setError(data?.error ?? 'Failed to update profile');
        return;
      }

      setProfile(data?.user ?? null);
      await update?.({ name });
      setSuccess('Profile updated successfully');
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if ((newPassword?.length ?? 0) < 8) {
      setError('New password must be at least 8 characters');
      return;
    }

    setChangingPassword(true);

    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res?.json?.();

      if (!res?.ok) {
        setError(data?.error ?? 'Failed to change password');
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess('Password changed successfully');
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setChangingPassword(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions?sessionId=${sessionId}`, {
        method: 'DELETE',
      });

      if (res?.ok) {
        fetchSessions();
      }
    } catch (error) {
      console.error('Failed to revoke session:', error);
    }
  };

  const handleRevokeAllSessions = async () => {
    if (!confirm('This will sign you out from all other devices. Continue?')) return;

    try {
      const res = await fetch('/api/sessions?all=true', {
        method: 'DELETE',
      });

      if (res?.ok) {
        fetchSessions();
      }
    } catch (error) {
      console.error('Failed to revoke sessions:', error);
    }
  };

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Profile Settings</h1>
        <p className="text-muted-foreground">
          Manage your account settings and security preferences.
        </p>
      </div>

      {(error || success) && (
        <Alert variant={error ? 'destructive' : 'success'}>
          <AlertDescription>{error || success}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile">
            <User className="h-4 w-4 mr-2" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="security">
            <Lock className="h-4 w-4 mr-2" />
            Security
          </TabsTrigger>
          <TabsTrigger value="sessions">
            <Monitor className="h-4 w-4 mr-2" />
            Sessions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>Update your personal information.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    value={profile?.email ?? ''}
                    disabled
                    className="pl-10 bg-muted"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Email cannot be changed.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e?.target?.value ?? '')}
                    className="pl-10"
                    placeholder="Your name"
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={handleUpdateProfile} disabled={saving || name === profile?.name}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                <Save className="h-4 w-4 mr-2" />
                Save Changes
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Change Password</CardTitle>
              <CardDescription>
                Update your password to keep your account secure.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="currentPassword">Current Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="currentPassword"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e?.target?.value ?? '')}
                    className="pl-10"
                  />
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e?.target?.value ?? '')}
                    className="pl-10"
                    minLength={8}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e?.target?.value ?? '')}
                    className="pl-10"
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button
                onClick={handleChangePassword}
                disabled={changingPassword || !currentPassword || !newPassword}
              >
                {changingPassword && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Change Password
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Two-Factor Authentication
              </CardTitle>
              <CardDescription>
                Add an extra layer of security to your account using an authenticator app.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg border">
                <div className="flex items-center gap-3">
                  {profile?.mfaEnabled ? (
                    <ShieldCheck className="h-8 w-8 text-green-500" />
                  ) : (
                    <ShieldOff className="h-8 w-8 text-muted-foreground" />
                  )}
                  <div>
                    <p className="font-medium">
                      {profile?.mfaEnabled ? 'Two-factor authentication is enabled' : 'Two-factor authentication is not enabled'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {profile?.mfaEnabled 
                        ? 'Your account is protected with an authenticator app'
                        : 'Enable 2FA to add an extra layer of security'}
                    </p>
                  </div>
                </div>
                <Badge variant={profile?.mfaEnabled ? 'success' : 'secondary'}>
                  {profile?.mfaEnabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
              
              {profile?.mfaEnabled && (
                <div className="flex items-center justify-between p-4 rounded-lg border">
                  <div className="flex items-center gap-3">
                    <Key className="h-6 w-6 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Backup Codes</p>
                      <p className="text-sm text-muted-foreground">
                        {backupCodesCount} codes remaining
                      </p>
                    </div>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      setMfaBackupCodesOpen(true);
                      setMfaToken('');
                      setMfaError('');
                      setBackupCodes([]);
                    }}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Regenerate
                  </Button>
                </div>
              )}
            </CardContent>
            <CardFooter>
              {profile?.mfaEnabled ? (
                <Button 
                  variant="destructive" 
                  onClick={() => {
                    setMfaDisableOpen(true);
                    setMfaToken('');
                    setMfaPassword('');
                    setMfaError('');
                  }}
                >
                  <ShieldOff className="h-4 w-4 mr-2" />
                  Disable 2FA
                </Button>
              ) : (
                <Button onClick={handleStartMfaSetup} disabled={mfaLoading}>
                  {mfaLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  <Shield className="h-4 w-4 mr-2" />
                  Enable 2FA
                </Button>
              )}
            </CardFooter>
          </Card>

          {/* MFA Setup Dialog */}
          <Dialog open={mfaSetupOpen} onOpenChange={(open) => {
            if (!open && mfaStep !== 'backup') {
              setMfaSetupOpen(false);
              setMfaSetupData(null);
              setMfaToken('');
              setMfaStep('qr');
            }
          }}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {mfaStep === 'qr' && 'Set up Two-Factor Authentication'}
                  {mfaStep === 'verify' && 'Verify Your Authenticator'}
                  {mfaStep === 'backup' && 'Save Your Backup Codes'}
                </DialogTitle>
                <DialogDescription>
                  {mfaStep === 'qr' && 'Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.)'}
                  {mfaStep === 'verify' && 'Enter the 6-digit code from your authenticator app to verify setup'}
                  {mfaStep === 'backup' && 'Store these codes safely. You can use them if you lose access to your authenticator app.'}
                </DialogDescription>
              </DialogHeader>
              
              {mfaError && (
                <Alert variant="destructive">
                  <AlertDescription>{mfaError}</AlertDescription>
                </Alert>
              )}
              
              {mfaStep === 'qr' && mfaSetupData?.qrCodeUrl && (
                <div className="flex flex-col items-center space-y-4">
                  <div className="bg-white p-4 rounded-lg">
                    <img 
                      src={mfaSetupData.qrCodeUrl} 
                      alt="MFA QR Code" 
                      className="w-48 h-48"
                    />
                  </div>
                  <p className="text-sm text-muted-foreground text-center">
                    Can&apos;t scan? You can manually enter the setup code in your app.
                  </p>
                </div>
              )}
              
              {mfaStep === 'verify' && (
                <div className="flex flex-col items-center space-y-4">
                  <InputOTP
                    maxLength={6}
                    value={mfaToken}
                    onChange={(value) => setMfaToken(value)}
                    disabled={mfaLoading}
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
              
              {mfaStep === 'backup' && backupCodes.length > 0 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2 p-4 bg-muted rounded-lg font-mono text-sm">
                    {backupCodes.map((code, i) => (
                      <div key={i} className="text-center py-1">
                        {code}
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" className="w-full" onClick={copyBackupCodes}>
                    {copiedBackupCodes ? (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 mr-2" />
                        Copy All Codes
                      </>
                    )}
                  </Button>
                  <Alert>
                    <AlertDescription>
                      Each backup code can only be used once. Store them in a safe place.
                    </AlertDescription>
                  </Alert>
                </div>
              )}
              
              <DialogFooter>
                {mfaStep === 'qr' && (
                  <Button onClick={() => setMfaStep('verify')}>
                    Continue
                  </Button>
                )}
                {mfaStep === 'verify' && (
                  <Button onClick={handleVerifyMfa} disabled={mfaLoading || mfaToken.length !== 6}>
                    {mfaLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    Verify & Enable
                  </Button>
                )}
                {mfaStep === 'backup' && (
                  <Button onClick={handleCompleteMfaSetup}>
                    I&apos;ve Saved My Codes
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* MFA Disable Dialog */}
          <Dialog open={mfaDisableOpen} onOpenChange={setMfaDisableOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Disable Two-Factor Authentication</DialogTitle>
                <DialogDescription>
                  Enter your current MFA code or password to disable two-factor authentication.
                </DialogDescription>
              </DialogHeader>
              
              {mfaError && (
                <Alert variant="destructive">
                  <AlertDescription>{mfaError}</AlertDescription>
                </Alert>
              )}
              
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>MFA Code</Label>
                  <div className="flex justify-center">
                    <InputOTP
                      maxLength={6}
                      value={mfaToken}
                      onChange={(value) => setMfaToken(value)}
                      disabled={mfaLoading}
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
                </div>
                
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">Or</span>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="mfaPassword">Password</Label>
                  <Input
                    id="mfaPassword"
                    type="password"
                    value={mfaPassword}
                    onChange={(e) => setMfaPassword(e?.target?.value ?? '')}
                    placeholder="Enter your password"
                    disabled={mfaLoading}
                  />
                </div>
              </div>
              
              <DialogFooter>
                <Button variant="outline" onClick={() => setMfaDisableOpen(false)}>
                  Cancel
                </Button>
                <Button 
                  variant="destructive" 
                  onClick={handleDisableMfa}
                  disabled={mfaLoading || (!mfaToken && !mfaPassword)}
                >
                  {mfaLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Disable 2FA
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Backup Codes Regenerate Dialog */}
          <Dialog open={mfaBackupCodesOpen} onOpenChange={setMfaBackupCodesOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Regenerate Backup Codes</DialogTitle>
                <DialogDescription>
                  {backupCodes.length > 0 
                    ? 'Here are your new backup codes. Store them safely.'
                    : 'Enter your MFA code to generate new backup codes. This will invalidate all existing codes.'}
                </DialogDescription>
              </DialogHeader>
              
              {mfaError && (
                <Alert variant="destructive">
                  <AlertDescription>{mfaError}</AlertDescription>
                </Alert>
              )}
              
              {backupCodes.length === 0 ? (
                <div className="space-y-4">
                  <Label className="text-center block">Enter MFA Code</Label>
                  <div className="flex justify-center">
                    <InputOTP
                      maxLength={6}
                      value={mfaToken}
                      onChange={(value) => setMfaToken(value)}
                      disabled={mfaLoading}
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
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2 p-4 bg-muted rounded-lg font-mono text-sm">
                    {backupCodes.map((code, i) => (
                      <div key={i} className="text-center py-1">
                        {code}
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" className="w-full" onClick={copyBackupCodes}>
                    {copiedBackupCodes ? (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 mr-2" />
                        Copy All Codes
                      </>
                    )}
                  </Button>
                </div>
              )}
              
              <DialogFooter>
                {backupCodes.length === 0 ? (
                  <Button 
                    onClick={handleRegenerateBackupCodes}
                    disabled={mfaLoading || mfaToken.length !== 6}
                  >
                    {mfaLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    Generate New Codes
                  </Button>
                ) : (
                  <Button onClick={() => {
                    setMfaBackupCodesOpen(false);
                    setBackupCodes([]);
                  }}>
                    Done
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="sessions" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Active Sessions</CardTitle>
                  <CardDescription>
                    Manage your active sessions across devices.
                  </CardDescription>
                </div>
                {(sessions?.length ?? 0) > 1 && (
                  <Button variant="outline" size="sm" onClick={handleRevokeAllSessions}>
                    Revoke All Others
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {sessions?.map?.((s) => {
                  const { browser, os } = parseUserAgent(s?.userAgent ?? null);
                  return (
                    <div
                      key={s?.id ?? ''}
                      className="flex items-center justify-between p-4 rounded-lg border"
                    >
                      <div className="flex items-center gap-4">
                        <Monitor className="h-8 w-8 text-muted-foreground" />
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium">
                              {browser} on {os}
                            </p>
                            {s?.isCurrent && (
                              <Badge variant="success">Current</Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {s?.ipAddress ?? 'Unknown IP'} • Started{' '}
                            {formatDateTime(s?.createdAt ?? new Date())}
                          </p>
                        </div>
                      </div>
                      {!s?.isCurrent && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRevokeSession(s?.id ?? '')}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
