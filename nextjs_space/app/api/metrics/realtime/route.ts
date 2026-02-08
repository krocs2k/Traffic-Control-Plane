import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { getMetricsQueueStats, flushMetrics } from '@/lib/metrics-queue';

// GET - Get real-time metrics from actual traffic
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
    const timeRange = searchParams.get('timeRange') || '1h'; // 1h, 6h, 24h, 7d

    // Calculate time window
    const now = new Date();
    let startTime: Date;
    switch (timeRange) {
      case '6h':
        startTime = new Date(now.getTime() - 6 * 60 * 60 * 1000);
        break;
      case '24h':
        startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      default: // 1h
        startTime = new Date(now.getTime() - 60 * 60 * 1000);
    }

    // Get real traffic metrics from TrafficEndpoint records (actual traffic data)
    const endpoints = await prisma.trafficEndpoint.findMany({
      where: { orgId },
    });

    // Get cluster names for endpoints that have clusterId
    const clusterIds = endpoints.map(e => e.clusterId).filter((id): id is string => id !== null);
    const clusters = clusterIds.length > 0 
      ? await prisma.backendCluster.findMany({
          where: { id: { in: clusterIds } },
          select: { id: true, name: true },
        })
      : [];
    const clusterMap = new Map(clusters.map(c => [c.id, c.name]));

    // Get recent traffic metrics from database
    const recentMetrics = await prisma.trafficMetric.findMany({
      where: {
        orgId,
        recordedAt: { gte: startTime },
      },
      orderBy: { recordedAt: 'desc' },
      take: 1000,
    });

    // Aggregate endpoint traffic data
    const endpointStats = endpoints.map(endpoint => ({
      id: endpoint.id,
      name: endpoint.name,
      slug: endpoint.slug,
      type: endpoint.type,
      totalRequests: Number(endpoint.totalRequests),
      totalErrors: Number(endpoint.totalErrors),
      avgLatencyMs: endpoint.avgLatencyMs,
      lastRequestAt: endpoint.lastRequestAt,
      clusterName: endpoint.clusterId ? clusterMap.get(endpoint.clusterId) || 'N/A' : 'N/A',
      errorRate: endpoint.totalRequests > 0 
        ? (Number(endpoint.totalErrors) / Number(endpoint.totalRequests) * 100).toFixed(2)
        : '0.00',
    }));

    // Calculate overall stats
    const totalRequests = endpoints.reduce((sum, e) => sum + Number(e.totalRequests), 0);
    const totalErrors = endpoints.reduce((sum, e) => sum + Number(e.totalErrors), 0);
    const avgLatency = endpoints.length > 0
      ? endpoints.reduce((sum, e) => sum + (e.avgLatencyMs || 0), 0) / endpoints.length
      : 0;

    // Get metrics queue stats (in-memory pending metrics)
    const queueStats = getMetricsQueueStats();

    // Time-series data from recent metrics
    const timeSeries = recentMetrics.map(m => ({
      timestamp: m.recordedAt,
      requestCount: m.requestCount,
      errorCount: m.errorCount,
      avgLatencyMs: m.avgLatencyMs,
      p50LatencyMs: m.p50LatencyMs,
      p95LatencyMs: m.p95LatencyMs,
      p99LatencyMs: m.p99LatencyMs,
    }));

    return NextResponse.json({
      summary: {
        totalRequests,
        totalErrors,
        errorRate: totalRequests > 0 ? (totalErrors / totalRequests * 100).toFixed(2) : '0.00',
        avgLatencyMs: avgLatency.toFixed(2),
        activeEndpoints: endpoints.filter(e => e.isActive).length,
        totalEndpoints: endpoints.length,
      },
      endpoints: endpointStats,
      timeSeries,
      queue: queueStats,
      timeRange,
      collectedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching real-time metrics:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Flush pending metrics to database immediately
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Force flush the metrics queue
    await flushMetrics();

    return NextResponse.json({
      message: 'Metrics flushed successfully',
      flushedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error flushing metrics:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
