"use client";

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Users,
  UserPlus,
  MoreHorizontal,
  Shield,
  Loader2,
  Trash2,
  UserCog,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { hasPermission, ROLE_LABELS, ROLE_DESCRIPTIONS, canManageRole, type OrganizationMemberInfo } from '@/lib/types';
import { Role } from '@prisma/client';
import { formatDate } from '@/lib/utils';

export default function UsersPage() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const [users, setUsers] = useState<OrganizationMemberInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<OrganizationMemberInfo | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('VIEWER');
  const [editRole, setEditRole] = useState<Role>('VIEWER');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const userRole = session?.user?.currentOrgRole ?? 'VIEWER';
  const canManageUsers = hasPermission(userRole, 'manage_users');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router?.replace?.('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session?.user?.id) {
      fetchUsers();
    }
  }, [session?.user?.id, session?.user?.currentOrgId]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/users');
      if (res?.ok) {
        const data = await res?.json?.();
        setUsers(data?.users ?? []);
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async () => {
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch('/api/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });

      const data = await res?.json?.();

      if (!res?.ok) {
        setError(data?.error ?? 'Failed to send invitation');
        return;
      }

      setInviteOpen(false);
      setInviteEmail('');
      setInviteRole('VIEWER');
      alert('Invitation sent successfully!');
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateRole = async () => {
    if (!selectedUser) return;
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: selectedUser?.id, role: editRole }),
      });

      const data = await res?.json?.();

      if (!res?.ok) {
        setError(data?.error ?? 'Failed to update user');
        return;
      }

      setEditOpen(false);
      setSelectedUser(null);
      fetchUsers();
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveUser = async (member: OrganizationMemberInfo) => {
    if (!confirm(`Are you sure you want to remove ${member?.name} from this organization?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/users?memberId=${member?.id ?? ''}`, {
        method: 'DELETE',
      });

      const data = await res?.json?.();

      if (!res?.ok) {
        alert(data?.error ?? 'Failed to remove user');
        return;
      }

      fetchUsers();
    } catch (err) {
      alert('An unexpected error occurred');
    }
  };

  const handleToggleStatus = async (member: OrganizationMemberInfo) => {
    const newStatus = member?.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const action = newStatus === 'ACTIVE' ? 'activate' : 'deactivate';

    if (!confirm(`Are you sure you want to ${action} ${member?.name}?`)) {
      return;
    }

    try {
      const res = await fetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: member?.id, status: newStatus }),
      });

      const data = await res?.json?.();

      if (!res?.ok) {
        alert(data?.error ?? `Failed to ${action} user`);
        return;
      }

      fetchUsers();
    } catch (err) {
      alert('An unexpected error occurred');
    }
  };

  const openEditDialog = (member: OrganizationMemberInfo) => {
    setSelectedUser(member);
    setEditRole(member?.role ?? 'VIEWER');
    setError('');
    setEditOpen(true);
  };

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!canManageUsers && userRole !== 'VIEWER') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <Shield className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Access Restricted</h2>
        <p className="text-muted-foreground">You don&apos;t have permission to manage users.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Team Members</h1>
          <p className="text-muted-foreground">
            Manage your organization&apos;s team members and their roles.
          </p>
        </div>
        {canManageUsers && (
          <Button onClick={() => { setInviteOpen(true); setError(''); }}>
            <UserPlus className="h-4 w-4 mr-2" />
            Invite Member
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Members ({users?.length ?? 0})
          </CardTitle>
          <CardDescription>
            All members of this organization and their assigned roles.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                {canManageUsers && <TableHead className="w-12"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {users?.map?.((member) => (
                <TableRow key={member?.id ?? ''}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={member?.avatarUrl ?? undefined} />
                        <AvatarFallback>
                          {member?.name?.charAt?.(0)?.toUpperCase?.() ?? 'U'}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-medium">{member?.name ?? ''}</div>
                        <div className="text-sm text-muted-foreground">
                          {member?.email ?? ''}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={member?.role === 'OWNER' ? 'default' : 'secondary'}>
                      {ROLE_LABELS?.[member?.role] ?? member?.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={member?.status === 'ACTIVE' ? 'success' : 'destructive'}
                    >
                      {member?.status ?? 'Unknown'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(member?.joinedAt ?? new Date())}
                  </TableCell>
                  {canManageUsers && (
                    <TableCell>
                      {member?.userId !== session?.user?.id && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {(userRole === 'OWNER' || canManageRole(userRole, member?.role)) && (
                              <DropdownMenuItem onClick={() => openEditDialog(member)}>
                                <UserCog className="h-4 w-4 mr-2" />
                                Change Role
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => handleToggleStatus(member)}>
                              <Shield className="h-4 w-4 mr-2" />
                              {member?.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleRemoveUser(member)}
                              className="text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
            <DialogDescription>
              Send an invitation to join this organization.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="colleague@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e?.target?.value ?? '')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Role)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLE_LABELS)?.map?.(([key, label]) => {
                    if (key === 'OWNER' && userRole !== 'OWNER') return null;
                    return (
                      <SelectItem key={key} value={key}>
                        <div>
                          <div>{label}</div>
                          <div className="text-xs text-muted-foreground">
                            {ROLE_DESCRIPTIONS?.[key as Role] ?? ''}
                          </div>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleInvite} disabled={submitting || !inviteEmail}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Send Invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Role Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Role</DialogTitle>
            <DialogDescription>
              Update the role for {selectedUser?.name ?? 'this user'}.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>New Role</Label>
              <Select value={editRole} onValueChange={(v) => setEditRole(v as Role)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLE_LABELS)?.map?.(([key, label]) => {
                    if (key === 'OWNER' && userRole !== 'OWNER') return null;
                    return (
                      <SelectItem key={key} value={key}>
                        <div>
                          <div>{label}</div>
                          <div className="text-xs text-muted-foreground">
                            {ROLE_DESCRIPTIONS?.[key as Role] ?? ''}
                          </div>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateRole} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Update Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
