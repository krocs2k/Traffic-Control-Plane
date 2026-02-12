import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';
import { checkPermission } from '@/lib/rbac';
import { LoadBalancerStrategy } from '@prisma/client';
import { getCached, invalidateOrgCache } from '@/lib/cache';

// DELETE /api/backends/clusters - Bulk delete clusters
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { clusterIds, orgId } = body;

    if (!clusterIds || !Array.isArray(clusterIds) || clusterIds.length === 0) {
      return NextResponse.json({ error: 'Cluster IDs required' }, { status: 400 });
    }

    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID required' }, { status: 400 });
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

    // Verify all clusters belong to the org
    const clusters = await prisma.backendCluster.findMany({
      where: { id: { in: clusterIds }, orgId },
      select: { id: true, name: true }
    });

    if (clusters.length !== clusterIds.length) {
      return NextResponse.json({ error: 'Some clusters not found or access denied' }, { status: 403 });
    }

    // Delete all selected clusters (cascades to backends)
    const deleted = await prisma.backendCluster.deleteMany({
      where: { id: { in: clusterIds }, orgId }
    });

    // Invalidate cache for the organization
    invalidateOrgCache(orgId);

    // Audit log for each
    for (const cluster of clusters) {
      await createAuditLog({
        orgId,
        userId: user.id,
        action: 'backend_cluster.delete',
        resourceType: 'backend_cluster',
        resourceId: cluster.id,
        details: { name: cluster.name, bulkDelete: true },
        ipAddress: getClientIP(request)
      });
    }

    return NextResponse.json({ message: `Deleted ${deleted.count} clusters` });
  } catch (error) {
    console.error('Error bulk deleting clusters:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

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

    // Use caching for cluster fetches - 30 second TTL
    const clusters = await getCached(
      `clusters:org:${orgId}`,
      async () => {
        return prisma.backendCluster.findMany({
          where: { orgId: orgId as string },
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
      },
      { ttl: 30000, tags: [`org:${orgId}`] }
    );

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

    // Invalidate cache for the organization
    invalidateOrgCache(orgId);

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
