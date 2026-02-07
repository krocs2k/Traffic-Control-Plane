import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const config = await prisma.loadBalancerConfig.findUnique({
      where: { id },
    });

    if (!config) {
      return NextResponse.json({ error: 'Config not found' }, { status: 404 });
    }

    const cluster = await prisma.backendCluster.findUnique({
      where: { id: config.clusterId },
      include: { backends: true },
    });

    return NextResponse.json({ ...config, cluster });
  } catch (error) {
    console.error('Error fetching load balancer config:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { memberships: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const config = await prisma.loadBalancerConfig.findUnique({ where: { id } });
    if (!config) {
      return NextResponse.json({ error: 'Config not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    const allowedFields = [
      'strategy', 'stickySession', 'sessionCookieName', 'sessionTtlMs',
      'healthCheckEnabled', 'healthCheckIntervalMs', 'healthCheckPath', 'healthCheckTimeoutMs',
      'failoverEnabled', 'failoverThreshold', 'retryEnabled', 'maxRetries', 'retryDelayMs',
      'connectionDrainingMs', 'slowStartMs', 'weights'
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    const updated = await prisma.loadBalancerConfig.update({
      where: { id },
      data: updateData,
    });

    await createAuditLog({
      orgId: config.orgId,
      userId: user.id,
      action: 'loadbalancer.config.updated',
      resourceType: 'loadbalancer_config',
      resourceId: id,
      details: { changes: Object.keys(updateData) },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating load balancer config:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { memberships: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const config = await prisma.loadBalancerConfig.findUnique({ where: { id } });
    if (!config) {
      return NextResponse.json({ error: 'Config not found' }, { status: 404 });
    }

    await prisma.loadBalancerConfig.delete({ where: { id } });

    await createAuditLog({
      orgId: config.orgId,
      userId: user.id,
      action: 'loadbalancer.config.deleted',
      resourceType: 'loadbalancer_config',
      resourceId: id,
      details: { clusterId: config.clusterId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting load balancer config:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
