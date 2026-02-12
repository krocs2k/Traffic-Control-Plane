import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';
import { checkPermission } from '@/lib/rbac';
import { LoadBalancerStrategy } from '@prisma/client';

// GET /api/backends/clusters - List all clusters for organization
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    let orgId = searchParams.get('orgId');

    // If orgId not provided, get it from user's membership
    if (!orgId) {
      const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        include: { memberships: true },
      });

      if (!user || user.memberships.length === 0) {
        return NextResponse.json({ error: 'No organization found' }, { status: 404 });
      }

      orgId = user.memberships[0].orgId;
    } else {
      // Check user has access to the specified org
      const member = await prisma.organizationMember.findFirst({
        where: {
          orgId,
          user: { email: session.user.email }
        }
      });

      if (!member) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    }

    const clusters = await prisma.backendCluster.findMany({
      where: { orgId },
      include: {
        backends: {
          orderBy: { name: 'asc' }
        },
        _count: {
          select: { backends: true, routingPolicies: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    return NextResponse.json({ clusters });
  } catch (error) {
    console.error('Error fetching clusters:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/backends/clusters - Create a new cluster
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { orgId, name, description, strategy, healthCheck } = body;

    if (!orgId || !name) {
      return NextResponse.json({ error: 'Organization ID and name required' }, { status: 400 });
    }

    // Check permission
    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const hasPermission = await checkPermission(user.id, orgId, 'manage_backends');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    // Check for duplicate name
    const existing = await prisma.backendCluster.findUnique({
      where: { orgId_name: { orgId, name } }
    });

    if (existing) {
      return NextResponse.json({ error: 'Cluster with this name already exists' }, { status: 409 });
    }

    const cluster = await prisma.backendCluster.create({
      data: {
        orgId,
        name,
        description,
        strategy: strategy || LoadBalancerStrategy.ROUND_ROBIN,
        healthCheck: healthCheck || { path: '/health', intervalMs: 30000, timeoutMs: 5000, unhealthyThreshold: 3 }
      },
      include: {
        backends: true
      }
    });

    await createAuditLog({
      orgId,
      userId: user.id,
      action: 'backend_cluster.create',
      resourceType: 'backend_cluster',
      resourceId: cluster.id,
      details: { name, strategy },
      ipAddress: getClientIP(request)
    });

    return NextResponse.json({ cluster }, { status: 201 });
  } catch (error) {
    console.error('Error creating cluster:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
