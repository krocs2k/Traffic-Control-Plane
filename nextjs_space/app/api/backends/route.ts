import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';
import { checkPermission } from '@/lib/rbac';
import { BackendStatus } from '@prisma/client';
import { invalidateBackendCaches } from '@/lib/cache';

// GET /api/backends - List backends (optionally filtered by cluster)
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const clusterId = searchParams.get('clusterId');
    const orgId = searchParams.get('orgId');

    if (!orgId && !clusterId) {
      return NextResponse.json({ error: 'Organization ID or Cluster ID required' }, { status: 400 });
    }

    let targetOrgId = orgId;

    if (clusterId) {
      const cluster = await prisma.backendCluster.findUnique({
        where: { id: clusterId },
        select: { orgId: true }
      });
      if (!cluster) {
        return NextResponse.json({ error: 'Cluster not found' }, { status: 404 });
      }
      targetOrgId = cluster.orgId;
    }

    // Check user has access to org
    const member = await prisma.organizationMember.findFirst({
      where: {
        orgId: targetOrgId!,
        user: { email: session.user.email }
      }
    });

    if (!member) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const backends = await prisma.backend.findMany({
      where: clusterId 
        ? { clusterId } 
        : { cluster: { orgId: targetOrgId! } },
      include: {
        cluster: {
          select: { id: true, name: true, strategy: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    return NextResponse.json({ backends });
  } catch (error) {
    console.error('Error fetching backends:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/backends - Bulk delete backends
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { backendIds } = body;

    if (!backendIds || !Array.isArray(backendIds) || backendIds.length === 0) {
      return NextResponse.json({ error: 'Backend IDs array required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Verify all backends exist and user has permission
    const backends = await prisma.backend.findMany({
      where: { id: { in: backendIds } },
      include: { cluster: { select: { orgId: true, name: true } } }
    });

    if (backends.length === 0) {
      return NextResponse.json({ error: 'No backends found' }, { status: 404 });
    }

    // Check permission for each backend's org
    const orgIds = [...new Set(backends.map(b => b.cluster.orgId))];
    for (const orgId of orgIds) {
      const hasPermission = await checkPermission(user.id, orgId, 'manage_backends');
      if (!hasPermission) {
        return NextResponse.json({ error: 'Permission denied for one or more backends' }, { status: 403 });
      }
    }

    // Delete backends
    const result = await prisma.backend.deleteMany({
      where: { id: { in: backendIds } }
    });

    // Audit log and cache invalidation
    for (const backend of backends) {
      await createAuditLog({
        orgId: backend.cluster.orgId,
        userId: user.id,
        action: 'backend.delete',
        resourceType: 'backend',
        resourceId: backend.id,
        details: { name: backend.name, host: backend.host, bulkDelete: true },
        ipAddress: getClientIP(request)
      });
    }

    // Invalidate caches for all affected organizations
    for (const orgId of orgIds) {
      invalidateBackendCaches(orgId);
    }

    return NextResponse.json({ 
      message: `Deleted ${result.count} backend(s)`,
      count: result.count 
    });
  } catch (error) {
    console.error('Error bulk deleting backends:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/backends - Create a new backend
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { clusterId, name, host, port, protocol, weight, healthCheckPath, maxConnections, tags } = body;

    if (!clusterId || !name || !host) {
      return NextResponse.json({ error: 'Cluster ID, name, and host required' }, { status: 400 });
    }

    const cluster = await prisma.backendCluster.findUnique({
      where: { id: clusterId },
      select: { orgId: true }
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

    const backend = await prisma.backend.create({
      data: {
        clusterId,
        name,
        host,
        port: port || 443,
        protocol: protocol || 'https',
        weight: weight || 100,
        healthCheckPath: healthCheckPath || '',
        maxConnections: maxConnections || null,
        tags: tags || [],
        status: BackendStatus.HEALTHY
      },
      include: {
        cluster: { select: { id: true, name: true } }
      }
    });

    await createAuditLog({
      orgId: cluster.orgId,
      userId: user.id,
      action: 'backend.create',
      resourceType: 'backend',
      resourceId: backend.id,
      details: { name, host, port, clusterId },
      ipAddress: getClientIP(request)
    });

    // Invalidate backend caches for the organization
    invalidateBackendCaches(cluster.orgId);

    return NextResponse.json({ backend }, { status: 201 });
  } catch (error) {
    console.error('Error creating backend:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
