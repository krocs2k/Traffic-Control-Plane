"use client";

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Building2,
  Settings,
  Loader2,
  Save,
  Plus,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { hasPermission, ROLE_LABELS } from '@/lib/types';

interface Organization {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export default function OrganizationPage() {
  const { data: session, status, update } = useSession() || {};
  const router = useRouter();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [newOrgName, setNewOrgName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const userRole = session?.user?.currentOrgRole ?? 'VIEWER';
  const canManageSettings = hasPermission(userRole, 'manage_settings');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router?.replace?.('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session?.user?.id) {
      fetchOrganizations();
    }
  }, [session?.user?.id]);

  const fetchOrganizations = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/organizations');
      if (res?.ok) {
        const data = await res?.json?.();
        setOrgs(data?.organizations ?? []);

        // Set current org details
        const currentOrg = data?.organizations?.find?.(
          (o: Organization) => o?.id === session?.user?.currentOrgId
        );
        if (currentOrg) {
          setName(currentOrg?.name ?? '');
          setSlug(currentOrg?.slug ?? '');
        }
      }
    } catch (error) {
      console.error('Failed to fetch organizations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateOrg = async () => {
    setError('');
    setSuccess('');
    setSaving(true);

    try {
      const res = await fetch('/api/organizations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug }),
      });

      const data = await res?.json?.();

      if (!res?.ok) {
        setError(data?.error ?? 'Failed to update organization');
        return;
      }

      setSuccess('Organization updated successfully');
      fetchOrganizations();
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateOrg = async () => {
    setError('');
    setCreating(true);

    try {
      const res = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newOrgName }),
      });

      const data = await res?.json?.();

      if (!res?.ok) {
        setError(data?.error ?? 'Failed to create organization');
        return;
      }

      setCreateOpen(false);
      setNewOrgName('');
      
      // Switch to the new org
      await update?.({ currentOrgId: data?.organization?.id });
      router?.refresh?.();
      fetchOrganizations();
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setCreating(false);
    }
  };

  const handleSwitchOrg = async (orgId: string) => {
    await update?.({ currentOrgId: orgId });
    router?.refresh?.();
    fetchOrganizations();
  };

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const currentOrg = orgs?.find?.((o) => o?.id === session?.user?.currentOrgId);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Organization Settings</h1>
          <p className="text-muted-foreground">
            Manage your organization&apos;s settings and membership.
          </p>
        </div>
        <Button onClick={() => { setCreateOpen(true); setError(''); }}>
          <Plus className="h-4 w-4 mr-2" />
          New Organization
        </Button>
      </div>

      {(error || success) && (
        <Alert variant={error ? 'destructive' : 'success'}>
          <AlertDescription>{error || success}</AlertDescription>
        </Alert>
      )}

      {/* Organization Switcher */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Your Organizations
          </CardTitle>
          <CardDescription>
            Switch between organizations you&apos;re a member of.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {orgs?.map?.((org) => (
              <div
                key={org?.id ?? ''}
                className={`flex items-center justify-between p-4 rounded-lg border cursor-pointer transition-colors ${
                  org?.id === session?.user?.currentOrgId
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-muted'
                }`}
                onClick={() => handleSwitchOrg(org?.id ?? '')}
              >
                <div>
                  <p className="font-medium">{org?.name ?? ''}</p>
                  <p className="text-sm text-muted-foreground">
                    {org?.slug ?? ''} • {ROLE_LABELS?.[org?.role as keyof typeof ROLE_LABELS] ?? org?.role}
                  </p>
                </div>
                {org?.id === session?.user?.currentOrgId && (
                  <span className="text-xs text-primary font-medium">Current</span>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Organization Settings */}
      {canManageSettings && currentOrg && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Organization Details
            </CardTitle>
            <CardDescription>
              Update your organization&apos;s name and identifier.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="orgName">Organization Name</Label>
              <Input
                id="orgName"
                value={name}
                onChange={(e) => setName(e?.target?.value ?? '')}
                placeholder="My Organization"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="orgSlug">Organization Slug</Label>
              <Input
                id="orgSlug"
                value={slug}
                onChange={(e) => setSlug(e?.target?.value?.toLowerCase?.()?.replace?.(/[^a-z0-9-]/g, '-') ?? '')}
                placeholder="my-organization"
              />
              <p className="text-xs text-muted-foreground">
                Used in URLs and API references. Only lowercase letters, numbers, and hyphens.
              </p>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              onClick={handleUpdateOrg}
              disabled={saving || (name === currentOrg?.name && slug === currentOrg?.slug)}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              <Save className="h-4 w-4 mr-2" />
              Save Changes
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Danger Zone */}
      {userRole === 'OWNER' && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Danger Zone
            </CardTitle>
            <CardDescription>
              Irreversible and destructive actions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between p-4 rounded-lg border border-destructive/20 bg-destructive/5">
              <div>
                <p className="font-medium">Delete Organization</p>
                <p className="text-sm text-muted-foreground">
                  Permanently delete this organization and all its data.
                </p>
              </div>
              <Button variant="destructive" disabled>
                Delete
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create Organization Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Organization</DialogTitle>
            <DialogDescription>
              Create a new organization to manage a separate team or project.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newOrgName">Organization Name</Label>
              <Input
                id="newOrgName"
                value={newOrgName}
                onChange={(e) => setNewOrgName(e?.target?.value ?? '')}
                placeholder="My New Organization"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateOrg} disabled={creating || !newOrgName?.trim?.()}>
              {creating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Create Organization
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
