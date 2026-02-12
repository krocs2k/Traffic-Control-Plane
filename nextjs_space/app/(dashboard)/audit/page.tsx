"use client";

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  FileText,
  Shield,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Filter,
  X,
  Archive,
  ArchiveRestore,
  Trash2,
  CheckSquare,
  Square,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { hasPermission, type AuditLogEntry } from '@/lib/types';
import { formatDateTime } from '@/lib/utils';
import { toast } from 'sonner';

const ACTION_TYPES = [
  { value: 'user.login', label: 'User Login' },
  { value: 'user.logout', label: 'User Logout' },
  { value: 'user.register', label: 'User Register' },
  { value: 'user.password_change', label: 'Password Change' },
  { value: 'user.password_reset', label: 'Password Reset' },
  { value: 'user.profile_update', label: 'Profile Update' },
  { value: 'user.status_change', label: 'Status Change' },
  { value: 'user.role_change', label: 'Role Change' },
  { value: 'user.invite', label: 'User Invite' },
  { value: 'user.remove', label: 'User Remove' },
  { value: 'org.create', label: 'Org Create' },
  { value: 'org.update', label: 'Org Update' },
  { value: 'session.revoke', label: 'Session Revoke' },
  { value: 'backend.create', label: 'Backend Create' },
  { value: 'backend.update', label: 'Backend Update' },
  { value: 'backend.delete', label: 'Backend Delete' },
  { value: 'cluster.create', label: 'Cluster Create' },
  { value: 'cluster.update', label: 'Cluster Update' },
  { value: 'cluster.delete', label: 'Cluster Delete' },
];

interface ExtendedAuditLog extends AuditLogEntry {
  archived?: boolean;
  archivedAt?: string;
}

export default function AuditPage() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const [logs, setLogs] = useState<ExtendedAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [actionFilter, setActionFilter] = useState<string>('');
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'active' | 'archived' | 'all'>('active');
  const [archivedCount, setArchivedCount] = useState(0);
  
  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const userRole = session?.user?.currentOrgRole ?? 'VIEWER';
  const canViewAudit = hasPermission(userRole, 'view_audit');
  const canManageAudit = hasPermission(userRole, 'manage_audit');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router?.replace?.('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session?.user?.id && canViewAudit) {
      fetchLogs();
    }
  }, [session?.user?.id, session?.user?.currentOrgId, page, actionFilter, viewMode]);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: page?.toString?.() ?? '1',
        limit: '20',
      });
      if (actionFilter) {
        params?.append?.('action', actionFilter);
      }
      // Set archived filter based on view mode
      if (viewMode === 'archived') {
        params?.append?.('archived', 'true');
      } else if (viewMode === 'all') {
        params?.append?.('archived', 'all');
      }
      // Default (active) will show non-archived

      const res = await fetch(`/api/audit?${params?.toString?.()}`);
      if (res?.ok) {
        const data = await res?.json?.();
        setLogs(data?.auditLogs ?? []);
        setTotalPages(data?.pagination?.totalPages ?? 1);
        setArchivedCount(data?.archivedCount ?? 0);
      }
    } catch (error) {
      console.error('Failed to fetch audit logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const clearFilters = () => {
    setActionFilter('');
    setPage(1);
  };

  const formatAction = (action: string): string => {
    return action?.replace?.(/\./g, ' ')?.replace?.(/_/g, ' ')?.toUpperCase?.() ?? action;
  };

  const getActionBadgeVariant = (action: string) => {
    if (action?.includes?.('delete') || action?.includes?.('remove')) return 'destructive';
    if (action?.includes?.('create') || action?.includes?.('register')) return 'success';
    if (action?.includes?.('update') || action?.includes?.('change')) return 'warning';
    return 'secondary';
  };

  // Selection functions
  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === logs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(logs.map(l => l.id)));
    }
  };

  const handleArchive = async (unarchive: boolean = false) => {
    if (selectedIds.size === 0) return;
    
    try {
      setIsArchiving(true);
      const res = await fetch('/api/audit', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: Array.from(selectedIds),
          unarchive,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        toast.success(data.message);
        setSelectedIds(new Set());
        fetchLogs();
      } else {
        const error = await res.json();
        toast.error(error.error || 'Failed to archive logs');
      }
    } catch (error) {
      console.error('Archive error:', error);
      toast.error('Failed to archive logs');
    } finally {
      setIsArchiving(false);
      setArchiveDialogOpen(false);
    }
  };

  const handleDelete = async () => {
    if (selectedIds.size === 0) return;
    
    try {
      setIsDeleting(true);
      const res = await fetch('/api/audit', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: Array.from(selectedIds),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        toast.success(data.message);
        setSelectedIds(new Set());
        fetchLogs();
      } else {
        const error = await res.json();
        toast.error(error.error || 'Failed to delete logs');
      }
    } catch (error) {
      console.error('Delete error:', error);
      toast.error('Failed to delete logs');
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!canViewAudit) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <Shield className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Access Restricted</h2>
        <p className="text-muted-foreground">
          You need Auditor or higher role to view audit logs.
        </p>
      </div>
    );
  }

  const isInArchivedView = viewMode === 'archived';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audit Log</h1>
          <p className="text-muted-foreground">
            Track all significant actions and changes in your organization.
          </p>
        </div>
        {canManageAudit && selectedIds.size > 0 && (
          <div className="flex gap-2">
            {isInArchivedView ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleArchive(true)}
                disabled={isArchiving}
              >
                <ArchiveRestore className="h-4 w-4 mr-2" />
                Restore ({selectedIds.size})
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setArchiveDialogOpen(true)}
                disabled={isArchiving}
              >
                <Archive className="h-4 w-4 mr-2" />
                Archive ({selectedIds.size})
              </Button>
            )}
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={isDeleting}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete ({selectedIds.size})
            </Button>
          </div>
        )}
      </div>

      {/* View Mode Tabs */}
      <Tabs value={viewMode} onValueChange={(v) => { setViewMode(v as typeof viewMode); setPage(1); setSelectedIds(new Set()); }}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="archived" className="flex items-center gap-2">
            Archived
            {archivedCount > 0 && (
              <Badge variant="secondary" className="ml-1">{archivedCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Activity Log
              </CardTitle>
              <CardDescription>Complete audit trail of all events</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {canManageAudit && logs.length > 0 && (
                <Button variant="outline" size="sm" onClick={toggleSelectAll}>
                  {selectedIds.size === logs.length ? (
                    <><CheckSquare className="h-4 w-4 mr-2" />Deselect All</>
                  ) : (
                    <><Square className="h-4 w-4 mr-2" />Select All</>
                  )}
                </Button>
              )}
              <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1); }}>
                <SelectTrigger className="w-48">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Filter by action" />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_TYPES?.map?.((type) => (
                    <SelectItem key={type?.value ?? ''} value={type?.value ?? ''}>
                      {type?.label ?? ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {actionFilter && (
                <Button variant="ghost" size="icon" onClick={clearFilters}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (logs?.length ?? 0) > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    {canManageAudit && <TableHead className="w-12"></TableHead>}
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead>IP Address</TableHead>
                    {viewMode === 'all' && <TableHead>Status</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs?.map?.((log) => (
                    <TableRow
                      key={log?.id ?? ''}
                      className={`cursor-pointer ${selectedIds.has(log.id) ? 'bg-muted/50' : ''} ${log.archived ? 'opacity-60' : ''}`}
                      onClick={() => setExpandedLog(expandedLog === log?.id ? null : log?.id ?? null)}
                    >
                      {canManageAudit && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(log.id)}
                            onCheckedChange={() => toggleSelection(log.id)}
                          />
                        </TableCell>
                      )}
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDateTime(log?.createdAt ?? new Date())}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getActionBadgeVariant(log?.action ?? '') as any}>
                          {formatAction(log?.action ?? '')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{log?.user?.name ?? 'System'}</div>
                          <div className="text-xs text-muted-foreground">
                            {log?.user?.email ?? ''}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <span className="text-muted-foreground">{log?.resourceType ?? ''}</span>
                          {log?.resourceId && (
                            <span className="ml-1 font-mono text-xs">
                              #{log?.resourceId?.slice?.(0, 8)}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        {log?.ipAddress ?? '—'}
                      </TableCell>
                      {viewMode === 'all' && (
                        <TableCell>
                          {log.archived ? (
                            <Badge variant="outline" className="bg-muted">
                              <Archive className="h-3 w-3 mr-1" />
                              Archived
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300">
                              Active
                            </Badge>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Expanded Details */}
              {expandedLog && (
                <div className="mt-4 p-4 bg-muted rounded-lg">
                  <h4 className="font-medium mb-2">Event Details</h4>
                  <pre className="text-xs overflow-auto max-h-48">
                    {JSON.stringify(
                      logs?.find?.((l) => l?.id === expandedLog)?.details ?? {},
                      null,
                      2
                    )}
                  </pre>
                </div>
              )}

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No audit logs found</p>
              {actionFilter && (
                <Button variant="link" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Archive Confirmation Dialog */}
      <AlertDialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {selectedIds.size} audit log{selectedIds.size > 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              Archived logs will be moved to the Archived tab. You can restore them later if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleArchive(false)} disabled={isArchiving}>
              {isArchiving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Archive className="h-4 w-4 mr-2" />}
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} audit log{selectedIds.size > 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The selected audit logs will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
