import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { Backend } from '@prisma/client';

// POST - Generate sample metrics data for demo purposes
export async function POST(request: NextRequest) {
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

    // Get clusters and backends
    const clusters = await prisma.backendCluster.findMany({
      where: { orgId },
      include: { backends: true },
    });

    const policies = await prisma.routingPolicy.findMany({
      where: { orgId, isActive: true },
    });

    // Generate metrics for the last 24 hours
    const metricsToCreate: Array<{
      orgId: string;
      clusterId?: string;
      backendId?: string;
      policyId?: string;
      requestCount: number;
      errorCount: number;
      avgLatencyMs: number;
      p50LatencyMs: number;
      p95LatencyMs: number;
      p99LatencyMs: number;
      bytesIn: bigint;
      bytesOut: bigint;
      period: string;
      recordedAt: Date;
    }> = [];

    // Generate hourly metrics for last 24 hours
    for (let i = 0; i < 24; i++) {
      const recordedAt = new Date(Date.now() - i * 60 * 60 * 1000);
      
      // Overall org metrics
      const baseRequests = Math.floor(Math.random() * 5000) + 1000;
      const errorRate = Math.random() * 0.05; // 0-5% error rate
      const avgLatency = Math.random() * 100 + 30;

      metricsToCreate.push({
        orgId,
        requestCount: baseRequests,
        errorCount: Math.floor(baseRequests * errorRate),
        avgLatencyMs: avgLatency,
        p50LatencyMs: avgLatency * 0.8,
        p95LatencyMs: avgLatency * 1.5,
        p99LatencyMs: avgLatency * 2.5,
        bytesIn: BigInt(baseRequests * 1024),
        bytesOut: BigInt(baseRequests * 4096),
        period: '1h',
        recordedAt,
      });

      // Per-cluster metrics
      for (const cluster of clusters) {
        const clusterRequests = Math.floor(baseRequests * (0.2 + Math.random() * 0.3));
        const clusterErrorRate = Math.random() * 0.03;
        const clusterLatency = avgLatency * (0.8 + Math.random() * 0.4);

        metricsToCreate.push({
          orgId,
          clusterId: cluster.id,
          requestCount: clusterRequests,
          errorCount: Math.floor(clusterRequests * clusterErrorRate),
          avgLatencyMs: clusterLatency,
          p50LatencyMs: clusterLatency * 0.8,
          p95LatencyMs: clusterLatency * 1.5,
          p99LatencyMs: clusterLatency * 2.5,
          bytesIn: BigInt(clusterRequests * 1024),
          bytesOut: BigInt(clusterRequests * 4096),
          period: '1h',
          recordedAt,
        });

        // Per-backend metrics
        for (const backend of cluster.backends) {
          const backendRequests = Math.floor(clusterRequests / cluster.backends.length * (0.5 + Math.random()));
          const backendLatency = clusterLatency * (0.9 + Math.random() * 0.2);

          metricsToCreate.push({
            orgId,
            clusterId: cluster.id,
            backendId: backend.id,
            requestCount: backendRequests,
            errorCount: Math.floor(backendRequests * Math.random() * 0.02),
            avgLatencyMs: backendLatency,
            p50LatencyMs: backendLatency * 0.8,
            p95LatencyMs: backendLatency * 1.5,
            p99LatencyMs: backendLatency * 2.5,
            bytesIn: BigInt(backendRequests * 1024),
            bytesOut: BigInt(backendRequests * 4096),
            period: '1h',
            recordedAt,
          });
        }
      }

      // Per-policy metrics
      for (const policy of policies) {
        const policyRequests = Math.floor(baseRequests * 0.1);
        metricsToCreate.push({
          orgId,
          policyId: policy.id,
          requestCount: policyRequests,
          errorCount: Math.floor(policyRequests * Math.random() * 0.01),
          avgLatencyMs: avgLatency * 1.1,
          p50LatencyMs: avgLatency * 0.9,
          p95LatencyMs: avgLatency * 1.6,
          p99LatencyMs: avgLatency * 2.8,
          bytesIn: BigInt(policyRequests * 512),
          bytesOut: BigInt(policyRequests * 2048),
          period: '1h',
          recordedAt,
        });
      }
    }

    // Create all metrics
    const created = await prisma.trafficMetric.createMany({
      data: metricsToCreate,
    });

    // Create a snapshot
    const totalRequests = metricsToCreate
      .filter(m => !m.clusterId && !m.backendId && !m.policyId)
      .reduce((sum, m) => sum + m.requestCount, 0);
    const totalErrors = metricsToCreate
      .filter(m => !m.clusterId && !m.backendId && !m.policyId)
      .reduce((sum, m) => sum + m.errorCount, 0);

    const backends = await prisma.backend.findMany({
      where: { cluster: { orgId } },
    });

    await prisma.metricSnapshot.create({
      data: {
        orgId,
        totalRequests: BigInt(totalRequests),
        totalErrors: BigInt(totalErrors),
        avgResponseTime: 65,
        healthyBackends: backends.filter((b: Backend) => b.status === 'HEALTHY').length,
        unhealthyBackends: backends.filter((b: Backend) => b.status === 'UNHEALTHY').length,
        activeConnections: Math.floor(Math.random() * 500) + 100,
        requestsPerSecond: Math.round(totalRequests / (24 * 3600) * 100) / 100,
        errorRate: totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0,
      },
    });

    return NextResponse.json({
      message: 'Sample metrics generated',
      metricsCreated: created.count,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error generating metrics:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
