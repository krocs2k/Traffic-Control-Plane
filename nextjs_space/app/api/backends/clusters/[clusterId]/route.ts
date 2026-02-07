import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';
import { checkPermission } from '@/lib/rbac';

type Params = { params: Promise<{ clusterId: string }> };

// GET /api/backends/clusters/[clusterId]
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { clusterId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cluster = await prisma.backendCluster.findUnique({
      where: { id: clusterId },
      include: {
        backends: {
          orderBy: { name: 'asc' }
        },
        routingPolicies: {
          orderBy: { priority: 'asc' }
        },
        organization: true
      }
    });

    if (!cluster) {
      return NextResponse.json({ error: 'Cluster not found' }, { status: 404 });
    }

    // Check user has access to org
    const member = await prisma.organizationMember.findFirst({
      where: {
        orgId: cluster.orgId,
        user: { email: session.user.email }
      }
    });

    if (!member) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return NextResponse.json({ cluster });
  } catch (error) {
    console.error('Error fetching cluster:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/backends/clusters/[clusterId]
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { clusterId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cluster = await prisma.backendCluster.findUnique({
      where: { id: clusterId }
    });

    if (!cluster) {
      return NextResponse.json({ error: 'Cluster not found' }, { status: 404 });
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const hasPermission = await checkPermission(user.id, cluster.orgId, 'manage_backends');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const { name, description, strategy, healthCheck, isActive } = body;

    // Check for duplicate name if changing
    if (name && name !== cluster.name) {
      const existing = await prisma.backendCluster.findUnique({
        where: { orgId_name: { orgId: cluster.orgId, name } }
      });
      if (existing) {
        return NextResponse.json({ error: 'Cluster with this name already exists' }, { status: 409 });
      }
    }

    const updated = await prisma.backendCluster.update({
      where: { id: clusterId },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(strategy && { strategy }),
        ...(healthCheck && { healthCheck }),
        ...(isActive !== undefined && { isActive })
      },
      include: { backends: true }
    });

    await createAuditLog({
      orgId: cluster.orgId,
      userId: user.id,
      action: 'backend_cluster.update',
      resourceType: 'backend_cluster',
      resourceId: clusterId,
      details: { changes: body },
      ipAddress: getClientIP(request)
    });

    return NextResponse.json({ cluster: updated });
  } catch (error) {
    console.error('Error updating cluster:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/backends/clusters/[clusterId]
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { clusterId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cluster = await prisma.backendCluster.findUnique({
      where: { id: clusterId },
      include: { _count: { select: { backends: true } } }
    });

    if (!cluster) {
      return NextResponse.json({ error: 'Cluster not found' }, { status: 404 });
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const hasPermission = await checkPermission(user.id, cluster.orgId, 'manage_backends');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    await prisma.backendCluster.delete({ where: { id: clusterId } });

    await createAuditLog({
      orgId: cluster.orgId,
      userId: user.id,
      action: 'backend_cluster.delete',
      resourceType: 'backend_cluster',
      resourceId: clusterId,
      details: { name: cluster.name },
      ipAddress: getClientIP(request)
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting cluster:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
