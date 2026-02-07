import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { Backend, ReadReplica, HealthCheck } from '@prisma/client';

// GET - Get health check summary
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

    // Get backend health summary
    const backends = await prisma.backend.findMany({
      where: {
        cluster: { orgId },
        isActive: true,
      },
    });

    const backendSummary = {
      total: backends.length,
      healthy: backends.filter((b: Backend) => b.status === 'HEALTHY').length,
      unhealthy: backends.filter((b: Backend) => b.status === 'UNHEALTHY').length,
      draining: backends.filter((b: Backend) => b.status === 'DRAINING').length,
      maintenance: backends.filter((b: Backend) => b.status === 'MAINTENANCE').length,
    };

    // Get replica health summary
    const replicas = await prisma.readReplica.findMany({
      where: { orgId, isActive: true },
    });

    const replicaSummary = {
      total: replicas.length,
      synced: replicas.filter((r: ReadReplica) => r.status === 'SYNCED').length,
      lagging: replicas.filter((r: ReadReplica) => r.status === 'LAGGING').length,
      catchingUp: replicas.filter((r: ReadReplica) => r.status === 'CATCHING_UP').length,
      offline: replicas.filter((r: ReadReplica) => r.status === 'OFFLINE').length,
    };

    // Get recent health check results (last 24 hours)
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentHealthChecks = await prisma.healthCheck.findMany({
      where: { checkedAt: { gte: last24Hours } },
      orderBy: { checkedAt: 'desc' },
    });

    const healthCheckSummary = {
      total: recentHealthChecks.length,
      healthy: recentHealthChecks.filter((h: HealthCheck) => h.status === 'HEALTHY').length,
      unhealthy: recentHealthChecks.filter((h: HealthCheck) => h.status === 'UNHEALTHY').length,
      degraded: recentHealthChecks.filter((h: HealthCheck) => h.status === 'DEGRADED').length,
      timeout: recentHealthChecks.filter((h: HealthCheck) => h.status === 'TIMEOUT').length,
      avgResponseTime: recentHealthChecks.length > 0
        ? Math.round(recentHealthChecks.reduce((sum: number, h: HealthCheck) => sum + (h.responseTime || 0), 0) / recentHealthChecks.length)
        : 0,
    };

    // Calculate overall health score
    const totalHealthy = backendSummary.healthy + replicaSummary.synced + replicaSummary.catchingUp;
    const totalResources = backendSummary.total + replicaSummary.total;
    const healthScore = totalResources > 0 ? Math.round((totalHealthy / totalResources) * 100) : 100;

    return NextResponse.json({
      backends: backendSummary,
      replicas: replicaSummary,
      healthChecks: healthCheckSummary,
      healthScore,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching health summary:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
