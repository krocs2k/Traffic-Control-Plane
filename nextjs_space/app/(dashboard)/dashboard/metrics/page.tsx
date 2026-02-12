"use client";

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  RefreshCw,
  Activity,
  TrendingUp,
  TrendingDown,
  Clock,
  AlertCircle,
  Loader2,
  Download,
} from 'lucide-react';

import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

// Chart loading skeleton
function ChartSkeleton() {
  return <Skeleton className="w-full h-[300px]" />;
}

interface MetricsSummary {
  summary: {
    totalRequests: number;
    totalErrors: number;
    avgLatencyMs: number;
    errorRate: number;
    requestsPerSecond: number;
    timeRange: string;
  };
  latestSnapshot: {
    totalRequests: bigint;
    totalErrors: bigint;
    avgResponseTime: number;
    healthyBackends: number;
    unhealthyBackends: number;
    activeConnections: number;
    requestsPerSecond: number;
    errorRate: number;
  } | null;
  clusterSummary: Array<{
    clusterId: string;
    totalRequests: number;
    totalErrors: number;
    avgLatency: number;
    errorRate: number;
  }>;
  timeSeries: Array<{
    time: string;
    requests: number;
    errors: number;
    avgLatency: number;
  }>;
  lastUpdated: string;
}

export default function MetricsPage() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const [metricsData, setMetricsData] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('24h');

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch(`/api/metrics/summary?timeRange=${timeRange}`);
      if (res.ok) {
        const data = await res.json();
        setMetricsData(data);
      }
    } catch (error) {
      console.error('Error fetching metrics:', error);
      toast.error('Failed to fetch metrics');
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    } else if (status === 'authenticated') {
      fetchMetrics();
    }
  }, [status, router, fetchMetrics]);

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const summary = metricsData?.summary;
  const snapshot = metricsData?.latestSnapshot;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Traffic Metrics</h1>
          <p className="text-muted-foreground">Monitor traffic patterns, latency, and error rates</p>
        </div>
        <div className="flex gap-2">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Time range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1h">Last 1 hour</SelectItem>
              <SelectItem value="24h">Last 24 hours</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchMetrics}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Total Requests
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary?.totalRequests?.toLocaleString() ?? '0'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {summary?.requestsPerSecond?.toFixed(2) ?? '0'} req/sec
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Avg Latency
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary?.avgLatencyMs?.toFixed(1) ?? '0'} ms
            </div>
            <div className="flex items-center gap-1 text-xs mt-1">
              {(summary?.avgLatencyMs ?? 0) < 100 ? (
                <TrendingDown className="h-3 w-3 text-green-500" />
              ) : (
                <TrendingUp className="h-3 w-3 text-red-500" />
              )}
              <span className="text-muted-foreground">
                {(summary?.avgLatencyMs ?? 0) < 100 ? 'Good' : 'Needs attention'}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Error Rate
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary?.errorRate?.toFixed(2) ?? '0'}%
            </div>
            <div className="flex items-center gap-1 text-xs mt-1">
              <Badge variant={(summary?.errorRate ?? 0) < 1 ? 'default' : 'destructive'}>
                {summary?.totalErrors?.toLocaleString() ?? '0'} errors
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Active Connections
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {snapshot?.activeConnections?.toLocaleString() ?? '0'}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {snapshot?.healthyBackends ?? 0} healthy / {(snapshot?.healthyBackends ?? 0) + (snapshot?.unhealthyBackends ?? 0)} backends
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Request Volume */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Request Volume</CardTitle>
            <CardDescription>Requests over time</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {metricsData?.timeSeries && metricsData.timeSeries.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={metricsData.timeSeries}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="time" className="text-xs" tick={{ fill: 'currentColor' }} />
                    <YAxis className="text-xs" tick={{ fill: 'currentColor' }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="requests"
                      stroke="hsl(var(--primary))"
                      fill="hsl(var(--primary) / 0.2)"
                      name="Requests"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No metrics data available yet. Metrics will appear once traffic flows through your endpoints.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Latency */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Response Latency</CardTitle>
            <CardDescription>Average latency over time (ms)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {metricsData?.timeSeries && metricsData.timeSeries.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={metricsData.timeSeries}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="time" className="text-xs" tick={{ fill: 'currentColor' }} />
                    <YAxis className="text-xs" tick={{ fill: 'currentColor' }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="avgLatency"
                      stroke="hsl(var(--chart-2))"
                      strokeWidth={2}
                      dot={false}
                      name="Avg Latency (ms)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No data available
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Error Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Requests vs Errors</CardTitle>
            <CardDescription>Request and error counts comparison</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {metricsData?.timeSeries && metricsData.timeSeries.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={metricsData.timeSeries}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="time" className="text-xs" tick={{ fill: 'currentColor' }} />
                    <YAxis className="text-xs" tick={{ fill: 'currentColor' }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend />
                    <Bar dataKey="requests" fill="hsl(var(--primary))" name="Requests" />
                    <Bar dataKey="errors" fill="hsl(var(--destructive))" name="Errors" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No data available
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Cluster Performance */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Cluster Performance</CardTitle>
            <CardDescription>Metrics by backend cluster</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {metricsData?.clusterSummary && metricsData.clusterSummary.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={metricsData.clusterSummary} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis type="number" className="text-xs" tick={{ fill: 'currentColor' }} />
                    <YAxis
                      dataKey="clusterId"
                      type="category"
                      className="text-xs"
                      tick={{ fill: 'currentColor' }}
                      width={100}
                      tickFormatter={(value) => value.slice(0, 8)}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Bar dataKey="totalRequests" fill="hsl(var(--primary))" name="Requests" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No cluster data available
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cluster Details Table */}
      {metricsData?.clusterSummary && metricsData.clusterSummary.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Cluster Details</CardTitle>
            <CardDescription>Detailed metrics for each backend cluster</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-4 font-medium">Cluster ID</th>
                    <th className="text-right py-2 px-4 font-medium">Requests</th>
                    <th className="text-right py-2 px-4 font-medium">Errors</th>
                    <th className="text-right py-2 px-4 font-medium">Error Rate</th>
                    <th className="text-right py-2 px-4 font-medium">Avg Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {metricsData.clusterSummary.map((cluster) => (
                    <tr key={cluster.clusterId} className="border-b">
                      <td className="py-2 px-4 font-mono text-sm">
                        {cluster.clusterId.slice(0, 12)}...
                      </td>
                      <td className="text-right py-2 px-4">
                        {cluster.totalRequests.toLocaleString()}
                      </td>
                      <td className="text-right py-2 px-4">
                        {cluster.totalErrors.toLocaleString()}
                      </td>
                      <td className="text-right py-2 px-4">
                        <Badge
                          variant={cluster.errorRate < 1 ? 'default' : 'destructive'}
                        >
                          {cluster.errorRate.toFixed(2)}%
                        </Badge>
                      </td>
                      <td className="text-right py-2 px-4">
                        {cluster.avgLatency.toFixed(1)} ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
