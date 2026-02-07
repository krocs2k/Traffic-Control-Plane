import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { HealthCheckStatus } from '@prisma/client';

// POST - Run health checks for all backends/replicas
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

    // Get all active backends
    const backends = await prisma.backend.findMany({
      where: {
        cluster: { orgId },
        isActive: true,
      },
      include: { cluster: true },
    });

    // Get all active replicas
    const replicas = await prisma.readReplica.findMany({
      where: { orgId, isActive: true },
    });

    const results: { backends: unknown[]; replicas: unknown[] } = { backends: [], replicas: [] };

    // Simulate health checks for backends
    for (const backend of backends) {
      const startTime = Date.now();
      // Simulate health check (in production, this would make actual HTTP requests)
      const isHealthy = Math.random() > 0.1; // 90% healthy
      const responseTime = Math.floor(Math.random() * 200) + 20;
      const statusCode = isHealthy ? 200 : Math.random() > 0.5 ? 503 : 500;
      const status: HealthCheckStatus = isHealthy ? 'HEALTHY' : responseTime > 150 ? 'DEGRADED' : 'UNHEALTHY';

      const healthCheck = await prisma.healthCheck.create({
        data: {
          backendId: backend.id,
          endpoint: `${backend.protocol}://${backend.host}:${backend.port}${backend.healthCheckPath}`,
          status,
          responseTime,
          statusCode,
          errorMessage: isHealthy ? null : 'Connection refused',
          metadata: { simulatedAt: new Date().toISOString() },
        },
      });

      // Update backend status
      await prisma.backend.update({
        where: { id: backend.id },
        data: {
          status: isHealthy ? 'HEALTHY' : 'UNHEALTHY',
          lastHealthCheck: new Date(),
        },
      });

      results.backends.push({ backend: backend.name, ...healthCheck });
    }

    // Simulate health checks for replicas
    for (const replica of replicas) {
      const isHealthy = Math.random() > 0.15; // 85% healthy
      const responseTime = Math.floor(Math.random() * 150) + 10;
      const status: HealthCheckStatus = isHealthy ? 'HEALTHY' : 'UNHEALTHY';

      const healthCheck = await prisma.healthCheck.create({
        data: {
          replicaId: replica.id,
          endpoint: `postgres://${replica.host}:${replica.port}`,
          status,
          responseTime,
          statusCode: isHealthy ? 200 : 0,
          errorMessage: isHealthy ? null : 'Connection timeout',
          metadata: { simulatedAt: new Date().toISOString() },
        },
      });

      // Update replica status
      await prisma.readReplica.update({
        where: { id: replica.id },
        data: {
          status: isHealthy ? (Math.random() > 0.3 ? 'SYNCED' : 'CATCHING_UP') : 'OFFLINE',
          lastHealthCheck: new Date(),
        },
      });

      results.replicas.push({ replica: replica.name, ...healthCheck });
    }

    return NextResponse.json({
      message: 'Health checks completed',
      checkedAt: new Date().toISOString(),
      results,
    });
  } catch (error) {
    console.error('Error running health checks:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
