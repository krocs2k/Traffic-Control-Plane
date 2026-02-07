import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { TrafficMetric } from '@prisma/client';

// GET - Get metrics summary/dashboard data
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { memberships: true },
    });

    if (!user?.memberships?.[0]) {
      return NextResponse.json({ error: 'User not in an organization' }, { status: 403 });
    }

    const orgId = user.memberships[0].orgId;
    const { searchParams } = new URL(request.url);
    const timeRange = searchParams.get('timeRange') || '1h';

    // Calculate time range
    let hoursAgo = 1;
    if (timeRange === '24h') hoursAgo = 24;
    else if (timeRange === '7d') hoursAgo = 168;
    else if (timeRange === '30d') hoursAgo = 720;

    const startTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);

    // Get metrics for the time period
    const metrics = await prisma.trafficMetric.findMany({
      where: {
        orgId,
        recordedAt: { gte: startTime },
      },
      orderBy: { recordedAt: 'asc' },
    });

    // Get latest snapshot
    const latestSnapshot = await prisma.metricSnapshot.findFirst({
      where: { orgId },
      orderBy: { snapshotAt: 'desc' },
    });

    // Aggregate metrics
    const totalRequests = metrics.reduce((sum: number, m: TrafficMetric) => sum + m.requestCount, 0);
    const totalErrors = metrics.reduce((sum: number, m: TrafficMetric) => sum + m.errorCount, 0);
    const avgLatency = metrics.length > 0
      ? metrics.reduce((sum: number, m: TrafficMetric) => sum + m.avgLatencyMs, 0) / metrics.length
      : 0;
    const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;

    // Calculate throughput (requests per second)
    const timeSpanMs = hoursAgo * 60 * 60 * 1000;
    const requestsPerSecond = totalRequests / (timeSpanMs / 1000);

    // Get per-cluster metrics
    const clusterMetrics: Record<string, { requests: number; errors: number; latency: number[] }> = {};
    metrics.forEach((m: TrafficMetric) => {
      if (m.clusterId) {
        if (!clusterMetrics[m.clusterId]) {
          clusterMetrics[m.clusterId] = { requests: 0, errors: 0, latency: [] };
        }
        clusterMetrics[m.clusterId].requests += m.requestCount;
        clusterMetrics[m.clusterId].errors += m.errorCount;
        clusterMetrics[m.clusterId].latency.push(m.avgLatencyMs);
      }
    });

    // Format cluster summary
    const clusterSummary = Object.entries(clusterMetrics).map(([clusterId, data]) => ({
      clusterId,
      totalRequests: data.requests,
      totalErrors: data.errors,
      avgLatency: data.latency.length > 0
        ? data.latency.reduce((a, b) => a + b, 0) / data.latency.length
        : 0,
      errorRate: data.requests > 0 ? (data.errors / data.requests) * 100 : 0,
    }));

    // Time series for charts (group by hour for 24h+, by minute for 1h)
    const timeSeries = groupMetricsByTime(metrics, timeRange);

    return NextResponse.json({
      summary: {
        totalRequests,
        totalErrors,
        avgLatencyMs: Math.round(avgLatency * 100) / 100,
        errorRate: Math.round(errorRate * 100) / 100,
        requestsPerSecond: Math.round(requestsPerSecond * 100) / 100,
        timeRange,
      },
      latestSnapshot: latestSnapshot || null,
      clusterSummary,
      timeSeries,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching metrics summary:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function groupMetricsByTime(metrics: Array<{
  recordedAt: Date;
  requestCount: number;
  errorCount: number;
  avgLatencyMs: number;
}>, timeRange: string) {
  const grouped: Record<string, { requests: number; errors: number; latency: number[] }> = {};

  metrics.forEach(m => {
    const date = new Date(m.recordedAt);
    let key: string;

    if (timeRange === '1h') {
      key = `${date.getHours()}:${Math.floor(date.getMinutes() / 5) * 5}`;
    } else if (timeRange === '24h') {
      key = `${date.getHours()}:00`;
    } else {
      key = date.toISOString().split('T')[0];
    }

    if (!grouped[key]) {
      grouped[key] = { requests: 0, errors: 0, latency: [] };
    }
    grouped[key].requests += m.requestCount;
    grouped[key].errors += m.errorCount;
    grouped[key].latency.push(m.avgLatencyMs);
  });

  return Object.entries(grouped).map(([time, data]) => ({
    time,
    requests: data.requests,
    errors: data.errors,
    avgLatency: data.latency.length > 0
      ? Math.round(data.latency.reduce((a, b) => a + b, 0) / data.latency.length)
      : 0,
  }));
}
