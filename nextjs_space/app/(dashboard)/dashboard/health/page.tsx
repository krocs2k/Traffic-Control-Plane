"use client";

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  Activity,
  RefreshCw,
  Server,
  Database,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Loader2,
  Play,
  Zap,
} from 'lucide-react';

interface HealthSummary {
  backends: {
    total: number;
    healthy: number;
    unhealthy: number;
    draining: number;
    maintenance: number;
  };
  replicas: {
    total: number;
    synced: number;
    lagging: number;
    catchingUp: number;
    offline: number;
  };
  healthChecks: {
    total: number;
    healthy: number;
    unhealthy: number;
    degraded: number;
    timeout: number;
    avgResponseTime: number;
  };
  healthScore: number;
  lastUpdated: string;
}

interface HealthCheck {
  id: string;
  backendId: string | null;
  replicaId: string | null;
  endpoint: string;
  status: string;
  responseTime: number | null;
  statusCode: number | null;
  errorMessage: string | null;
  checkedAt: string;
}

export default function HealthMonitoringPage() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [recentChecks, setRecentChecks] = useState<HealthCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningChecks, setRunningChecks] = useState(false);

  const fetchHealthData = useCallback(async () => {
    try {
      const [summaryRes, checksRes] = await Promise.all([
        fetch('/api/health-checks/summary'),
        fetch('/api/health-checks?limit=50'),
      ]);

      if (summaryRes.ok) {
        const summaryData = await summaryRes.json();
        setSummary(summaryData);
      }

      if (checksRes.ok) {
        const checksData = await checksRes.json();
        setRecentChecks(checksData);
      }
    } catch (error) {
      console.error('Error fetching health data:', error);
      toast.error('Failed to fetch health data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    } else if (status === 'authenticated') {
      fetchHealthData();
    }
  }, [status, router, fetchHealthData]);

  const runHealthChecks = async () => {
    setRunningChecks(true);
    try {
      const res = await fetch('/api/health-checks/run', { method: 'POST' });
      if (res.ok) {
        toast.success('Health checks completed');
        fetchHealthData();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to run health checks');
      }
    } catch (error) {
      console.error('Error running health checks:', error);
      toast.error('Failed to run health checks');
    } finally {
      setRunningChecks(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'HEALTHY':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'UNHEALTHY':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'DEGRADED':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'TIMEOUT':
        return <Clock className="h-4 w-4 text-orange-500" />;
      default:
        return <Activity className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusBadgeVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case 'HEALTHY':
        return 'default';
      case 'UNHEALTHY':
        return 'destructive';
      case 'DEGRADED':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const healthScoreColor = summary
    ? summary.healthScore >= 90
      ? 'text-green-500'
      : summary.healthScore >= 70
      ? 'text-yellow-500'
      : 'text-red-500'
    : 'text-gray-500';

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Health Monitoring</h1>
          <p className="text-muted-foreground">Monitor the health of your backends and replicas</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchHealthData}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button size="sm" onClick={runHealthChecks} disabled={runningChecks}>
            {runningChecks ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            Run Health Checks
          </Button>
        </div>
      </div>

      {/* Health Score */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-primary/10">
                <Zap className="h-8 w-8 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Overall Health Score</p>
                <p className={`text-4xl font-bold ${healthScoreColor}`}>
                  {summary?.healthScore ?? 0}%
                </p>
              </div>
            </div>
            <div className="w-64">
              <Progress value={summary?.healthScore ?? 0} className="h-4" />
              <p className="text-xs text-muted-foreground mt-1 text-right">
                Last updated: {summary?.lastUpdated ? new Date(summary.lastUpdated).toLocaleTimeString() : 'N/A'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Backends Health */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Server className="h-4 w-4" />
              Backend Servers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary?.backends.healthy ?? 0}/{summary?.backends.total ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">Healthy</p>
            <div className="mt-3 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  Healthy
                </span>
                <span>{summary?.backends.healthy ?? 0}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  Unhealthy
                </span>
                <span>{summary?.backends.unhealthy ?? 0}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-yellow-500" />
                  Draining
                </span>
                <span>{summary?.backends.draining ?? 0}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  Maintenance
                </span>
                <span>{summary?.backends.maintenance ?? 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Replicas Health */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Database className="h-4 w-4" />
              Read Replicas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(summary?.replicas.synced ?? 0) + (summary?.replicas.catchingUp ?? 0)}/{summary?.replicas.total ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">Online</p>
            <div className="mt-3 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  Synced
                </span>
                <span>{summary?.replicas.synced ?? 0}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-yellow-500" />
                  Lagging
                </span>
                <span>{summary?.replicas.lagging ?? 0}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  Catching Up
                </span>
                <span>{summary?.replicas.catchingUp ?? 0}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  Offline
                </span>
                <span>{summary?.replicas.offline ?? 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Health Check Stats */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Health Checks (24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary?.healthChecks.total ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">Total Checks</p>
            <div className="mt-3 space-y-1">
              <div className="flex justify-between text-xs">
                <span>Avg Response Time</span>
                <span className="font-medium">{summary?.healthChecks.avgResponseTime ?? 0}ms</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-green-600">Healthy</span>
                <span>{summary?.healthChecks.healthy ?? 0}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-red-600">Unhealthy</span>
                <span>{summary?.healthChecks.unhealthy ?? 0}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-yellow-600">Degraded</span>
                <span>{summary?.healthChecks.degraded ?? 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Health Checks */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Health Checks</CardTitle>
          <CardDescription>Latest health check results from all endpoints</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="all">
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="backends">Backends</TabsTrigger>
              <TabsTrigger value="replicas">Replicas</TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="mt-4">
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {recentChecks.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      No health checks recorded yet. Click "Run Health Checks" to start.
                    </p>
                  ) : (
                    recentChecks.map((check) => (
                      <div
                        key={check.id}
                        className="flex items-center justify-between p-3 rounded-lg border"
                      >
                        <div className="flex items-center gap-3">
                          {getStatusIcon(check.status)}
                          <div>
                            <p className="text-sm font-medium truncate max-w-md">
                              {check.endpoint}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(check.checkedAt).toLocaleString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          {check.responseTime && (
                            <span className="text-sm text-muted-foreground">
                              {check.responseTime}ms
                            </span>
                          )}
                          <Badge variant={getStatusBadgeVariant(check.status)}>
                            {check.status}
                          </Badge>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="backends" className="mt-4">
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {recentChecks.filter(c => c.backendId).length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      No backend health checks recorded.
                    </p>
                  ) : (
                    recentChecks
                      .filter((c) => c.backendId)
                      .map((check) => (
                        <div
                          key={check.id}
                          className="flex items-center justify-between p-3 rounded-lg border"
                        >
                          <div className="flex items-center gap-3">
                            {getStatusIcon(check.status)}
                            <div>
                              <p className="text-sm font-medium truncate max-w-md">
                                {check.endpoint}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(check.checkedAt).toLocaleString()}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            {check.responseTime && (
                              <span className="text-sm text-muted-foreground">
                                {check.responseTime}ms
                              </span>
                            )}
                            <Badge variant={getStatusBadgeVariant(check.status)}>
                              {check.status}
                            </Badge>
                          </div>
                        </div>
                      ))
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="replicas" className="mt-4">
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {recentChecks.filter(c => c.replicaId).length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      No replica health checks recorded.
                    </p>
                  ) : (
                    recentChecks
                      .filter((c) => c.replicaId)
                      .map((check) => (
                        <div
                          key={check.id}
                          className="flex items-center justify-between p-3 rounded-lg border"
                        >
                          <div className="flex items-center gap-3">
                            {getStatusIcon(check.status)}
                            <div>
                              <p className="text-sm font-medium truncate max-w-md">
                                {check.endpoint}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(check.checkedAt).toLocaleString()}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            {check.responseTime && (
                              <span className="text-sm text-muted-foreground">
                                {check.responseTime}ms
                              </span>
                            )}
                            <Badge variant={getStatusBadgeVariant(check.status)}>
                              {check.status}
                            </Badge>
                          </div>
                        </div>
                      ))
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
