import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';

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

    if (!user || user.memberships.length === 0) {
      return NextResponse.json({ error: 'No organization found' }, { status: 404 });
    }

    const orgId = user.memberships[0].orgId;

    const configs = await prisma.loadBalancerConfig.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });

    // Include cluster info for each config
    const configsWithClusters = await Promise.all(
      configs.map(async (config) => {
        const cluster = await prisma.backendCluster.findUnique({
          where: { id: config.clusterId },
          include: { backends: { select: { id: true, name: true, weight: true, status: true } } },
        });
        return { ...config, cluster };
      })
    );

    return NextResponse.json(configsWithClusters);
  } catch (error) {
    console.error('Error fetching load balancer configs:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

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

    if (!user || user.memberships.length === 0) {
      return NextResponse.json({ error: 'No organization found' }, { status: 404 });
    }

    const orgId = user.memberships[0].orgId;
    const body = await request.json();

    const {
      clusterId,
      strategy,
      stickySession,
      sessionCookieName,
      sessionTtlMs,
      healthCheckEnabled,
      healthCheckIntervalMs,
      healthCheckPath,
      healthCheckTimeoutMs,
      failoverEnabled,
      failoverThreshold,
      retryEnabled,
      maxRetries,
      retryDelayMs,
      connectionDrainingMs,
      slowStartMs,
      weights,
    } = body;

    if (!clusterId) {
      return NextResponse.json({ error: 'Cluster ID is required' }, { status: 400 });
    }

    // Check if config already exists for this cluster
    const existing = await prisma.loadBalancerConfig.findUnique({
      where: { clusterId },
    });

    if (existing) {
      return NextResponse.json({ error: 'Load balancer config already exists for this cluster' }, { status: 400 });
    }

    const config = await prisma.loadBalancerConfig.create({
      data: {
        orgId,
        clusterId,
        strategy: strategy || 'ROUND_ROBIN',
        stickySession: stickySession || false,
        sessionCookieName,
        sessionTtlMs: sessionTtlMs || 3600000,
        healthCheckEnabled: healthCheckEnabled !== false,
        healthCheckIntervalMs: healthCheckIntervalMs || 30000,
        healthCheckPath: typeof healthCheckPath === 'string' ? healthCheckPath : '/health',
        healthCheckTimeoutMs: healthCheckTimeoutMs || 5000,
        failoverEnabled: failoverEnabled !== false,
        failoverThreshold: failoverThreshold || 3,
        retryEnabled: retryEnabled !== false,
        maxRetries: maxRetries || 3,
        retryDelayMs: retryDelayMs || 1000,
        connectionDrainingMs: connectionDrainingMs || 30000,
        slowStartMs,
        weights: weights || {},
      },
    });

    await createAuditLog({
      orgId,
      userId: user.id,
      action: 'loadbalancer.config.created',
      resourceType: 'loadbalancer_config',
      resourceId: config.id,
      details: { clusterId, strategy: strategy || 'ROUND_ROBIN' },
    });

    return NextResponse.json(config);
  } catch (error) {
    console.error('Error creating load balancer config:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
