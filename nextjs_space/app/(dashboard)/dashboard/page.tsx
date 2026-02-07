"use client";

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Network,
  Users,
  Building2,
  Activity,
  Shield,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ROLE_LABELS, hasPermission, type AuditLogEntry } from '@/lib/types';
import { formatRelativeTime } from '@/lib/utils';

export default function DashboardPage() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const [stats, setStats] = useState({ users: 0, orgs: 0, logs: 0 });
  const [recentActivity, setRecentActivity] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router?.replace?.('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session?.user?.id) {
      fetchDashboardData();
    }
  }, [session?.user?.id, session?.user?.currentOrgId]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const [usersRes, auditRes] = await Promise.all([
        fetch('/api/users'),
        hasPermission(session?.user?.currentOrgRole ?? 'VIEWER', 'view_audit')
          ? fetch('/api/audit?limit=5')
          : Promise.resolve(null),
      ]);

      if (usersRes?.ok) {
        const userData = await usersRes?.json?.();
        setStats((s) => ({ ...s, users: userData?.users?.length ?? 0 }));
      }

      if (auditRes && auditRes?.ok) {
        const auditData = await auditRes?.json?.();
        setRecentActivity(auditData?.auditLogs ?? []);
        setStats((s) => ({ ...s, logs: auditData?.pagination?.total ?? 0 }));
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleResetDemoData = async () => {
    if (!confirm('This will reset all demo data. Are you sure?')) return;
    
    try {
      setResetting(true);
      const res = await fetch('/api/admin/reset-demo-data', { method: 'POST' });
      if (res?.ok) {
        alert('Demo data has been reset successfully!');
        window?.location?.reload?.();
      } else {
        const data = await res?.json?.();
        alert(data?.error ?? 'Failed to reset demo data');
      }
    } catch (error) {
      console.error('Failed to reset demo data:', error);
    } finally {
      setResetting(false);
    }
  };

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session?.user) {
    return null;
  }

  const userRole = session?.user?.currentOrgRole ?? 'VIEWER';
  const canViewAudit = hasPermission(userRole, 'view_audit');
  const isOwner = userRole === 'OWNER';

  const formatAction = (action: string): string => {
    return action?.replace?.(/\./g, ' ')?.replace?.(/_/g, ' ') ?? action;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome back, {session?.user?.name ?? 'User'}. Manage your traffic control plane.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-sm py-1 px-3">
            <Shield className="h-3 w-3 mr-1" />
            {ROLE_LABELS?.[userRole] ?? userRole}
          </Badge>
          {isOwner && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetDemoData}
              disabled={resetting}
            >
              {resetting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Reset Demo Data
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Organization</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold truncate">
              {session?.user?.currentOrgId ? 'Active' : 'Not Selected'}
            </div>
            <p className="text-xs text-muted-foreground">Current workspace</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Team Members</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.users ?? 0}</div>
            <p className="text-xs text-muted-foreground">In this organization</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Audit Events</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{canViewAudit ? stats?.logs ?? 0 : '—'}</div>
            <p className="text-xs text-muted-foreground">
              {canViewAudit ? 'Total logged events' : 'No access'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">Healthy</div>
            <p className="text-xs text-muted-foreground">All systems operational</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Coming Soon - Traffic Control Features */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Coming Soon
            </CardTitle>
            <CardDescription>
              Next phase features for the Traffic Control Plane
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <Network className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <h4 className="font-medium">Global Load Balancing</h4>
                  <p className="text-sm text-muted-foreground">
                    Route traffic based on location, latency, and health signals
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <Shield className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <h4 className="font-medium">HA Failover</h4>
                  <p className="text-sm text-muted-foreground">
                    Automatic failover across regions and providers
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <Activity className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <h4 className="font-medium">AI-Powered Insights</h4>
                  <p className="text-sm text-muted-foreground">
                    Anomaly detection, forecasting, and recommendations
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Recent Activity
            </CardTitle>
            <CardDescription>
              {canViewAudit
                ? 'Latest audit events in your organization'
                : 'You need Auditor or higher role to view activity'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {canViewAudit ? (
              (recentActivity?.length ?? 0) > 0 ? (
                <div className="space-y-3">
                  {recentActivity?.map?.((log) => (
                    <div
                      key={log?.id ?? ''}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {formatAction(log?.action ?? '')}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {log?.user?.name ?? 'System'} • {log?.resourceType ?? ''}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                        {formatRelativeTime(log?.createdAt ?? new Date())}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No recent activity</p>
                </div>
              )
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Shield className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Access restricted</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
