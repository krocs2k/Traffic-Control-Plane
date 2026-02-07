"use client";

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
  FlaskConical,
  Shuffle,
  BellRing,
  AlertTriangle,
  Zap,
  Server,
  HeartPulse,
  ArrowRight,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ROLE_LABELS, hasPermission, type AuditLogEntry } from '@/lib/types';
import { formatRelativeTime } from '@/lib/utils';

interface SystemStats {
  backends: number;
  healthyBackends: number;
  activeExperiments: number;
  activeAlerts: number;
  circuitBreakers: number;
  openCircuitBreakers: number;
  rateLimitRules: number;
  loadBalancers: number;
}

export default function DashboardPage() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const [stats, setStats] = useState({ users: 0, orgs: 0, logs: 0 });
  const [systemStats, setSystemStats] = useState<SystemStats>({
    backends: 0,
    healthyBackends: 0,
    activeExperiments: 0,
    activeAlerts: 0,
    circuitBreakers: 0,
    openCircuitBreakers: 0,
    rateLimitRules: 0,
    loadBalancers: 0,
  });
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
      const orgId = session?.user?.currentOrgId;
      const [usersRes, auditRes, backendsRes, experimentsRes, alertsRes, circuitBreakersRes, rateLimitsRes, loadBalancersRes] = await Promise.all([
        fetch('/api/users'),
        hasPermission(session?.user?.currentOrgRole ?? 'VIEWER', 'view_audit')
          ? fetch('/api/audit?limit=5')
          : Promise.resolve(null),
        orgId ? fetch(`/api/backends?orgId=${orgId}`) : Promise.resolve(null),
        fetch('/api/experiments'),
        fetch('/api/alerts'),
        fetch('/api/circuit-breakers'),
        fetch('/api/rate-limits'),
        fetch('/api/load-balancing'),
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

      // Fetch system stats
      const newSystemStats: SystemStats = {
        backends: 0,
        healthyBackends: 0,
        activeExperiments: 0,
        activeAlerts: 0,
        circuitBreakers: 0,
        openCircuitBreakers: 0,
        rateLimitRules: 0,
        loadBalancers: 0,
      };

      if (backendsRes && backendsRes?.ok) {
        const data = await backendsRes.json();
        const backends = data?.backends ?? [];
        newSystemStats.backends = backends.length;
        newSystemStats.healthyBackends = backends.filter((b: { status: string }) => b.status === 'HEALTHY').length;
      }

      if (experimentsRes?.ok) {
        const data = await experimentsRes.json();
        newSystemStats.activeExperiments = (data ?? []).filter((e: { status: string }) => e.status === 'RUNNING').length;
      }

      if (alertsRes?.ok) {
        const data = await alertsRes.json();
        newSystemStats.activeAlerts = (data ?? []).filter((a: { status: string }) => a.status === 'ACTIVE').length;
      }

      if (circuitBreakersRes?.ok) {
        const data = await circuitBreakersRes.json();
        newSystemStats.circuitBreakers = (data ?? []).length;
        newSystemStats.openCircuitBreakers = (data ?? []).filter((cb: { state: string }) => cb.state === 'OPEN').length;
      }

      if (rateLimitsRes?.ok) {
        const data = await rateLimitsRes.json();
        newSystemStats.rateLimitRules = (data ?? []).filter((r: { isActive: boolean }) => r.isActive).length;
      }

      if (loadBalancersRes?.ok) {
        const data = await loadBalancersRes.json();
        newSystemStats.loadBalancers = (data ?? []).length;
      }

      setSystemStats(newSystemStats);
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
        {/* System Overview */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5 text-primary" />
              System Overview
            </CardTitle>
            <CardDescription>
              Real-time status of your traffic control infrastructure
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Backends Status */}
              <Link href="/dashboard/backends" className="block">
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer group">
                  <div className="flex items-center gap-3">
                    <HeartPulse className="h-5 w-5 text-green-500" />
                    <div>
                      <h4 className="font-medium">Backends</h4>
                      <p className="text-sm text-muted-foreground">
                        {systemStats.healthyBackends} healthy of {systemStats.backends} total
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </Link>

              {/* Active Experiments */}
              <Link href="/dashboard/experiments" className="block">
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer group">
                  <div className="flex items-center gap-3">
                    <FlaskConical className="h-5 w-5 text-purple-500" />
                    <div>
                      <h4 className="font-medium">Experiments</h4>
                      <p className="text-sm text-muted-foreground">
                        {systemStats.activeExperiments} running
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </Link>

              {/* Active Alerts */}
              <Link href="/dashboard/alerts" className="block">
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer group">
                  <div className="flex items-center gap-3">
                    <BellRing className={`h-5 w-5 ${systemStats.activeAlerts > 0 ? 'text-red-500' : 'text-muted-foreground'}`} />
                    <div>
                      <h4 className="font-medium">Alerts</h4>
                      <p className="text-sm text-muted-foreground">
                        {systemStats.activeAlerts > 0 ? (
                          <span className="text-red-500 font-medium">{systemStats.activeAlerts} active</span>
                        ) : (
                          'No active alerts'
                        )}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </Link>

              {/* Circuit Breakers */}
              <Link href="/dashboard/traffic-management" className="block">
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer group">
                  <div className="flex items-center gap-3">
                    <Zap className={`h-5 w-5 ${systemStats.openCircuitBreakers > 0 ? 'text-yellow-500' : 'text-blue-500'}`} />
                    <div>
                      <h4 className="font-medium">Circuit Breakers</h4>
                      <p className="text-sm text-muted-foreground">
                        {systemStats.openCircuitBreakers > 0 ? (
                          <span className="text-yellow-500 font-medium">{systemStats.openCircuitBreakers} open</span>
                        ) : (
                          `${systemStats.circuitBreakers} configured, all closed`
                        )}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </Link>

              {/* Load Balancers & Rate Limits */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <Link href="/dashboard/load-balancing" className="block">
                  <div className="p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer text-center">
                    <Shuffle className="h-5 w-5 mx-auto mb-1 text-cyan-500" />
                    <p className="text-sm font-medium">{systemStats.loadBalancers}</p>
                    <p className="text-xs text-muted-foreground">Load Balancers</p>
                  </div>
                </Link>
                <Link href="/dashboard/traffic-management" className="block">
                  <div className="p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer text-center">
                    <AlertTriangle className="h-5 w-5 mx-auto mb-1 text-orange-500" />
                    <p className="text-sm font-medium">{systemStats.rateLimitRules}</p>
                    <p className="text-xs text-muted-foreground">Rate Limit Rules</p>
                  </div>
                </Link>
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
