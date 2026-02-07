"use client";

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  User,
  Mail,
  Lock,
  Loader2,
  Monitor,
  Trash2,
  Save,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
              <CardTitle>Two-Factor Authentication</CardTitle>
              <CardDescription>
                Add an extra layer of security to your account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Status</p>
                  <p className="text-sm text-muted-foreground">
                    {profile?.mfaEnabled
                      ? 'Two-factor authentication is enabled'
                      : 'Two-factor authentication is not enabled'}
                  </p>
                </div>
                <Badge variant={profile?.mfaEnabled ? 'success' : 'secondary'}>
                  {profile?.mfaEnabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
            </CardContent>
            <CardFooter>
              <Button variant="outline" disabled>
                {profile?.mfaEnabled ? 'Disable 2FA' : 'Enable 2FA'}
                <Badge variant="secondary" className="ml-2">Coming Soon</Badge>
              </Button>
            </CardFooter>
          </Card>
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
