import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';
import { checkPermission } from '@/lib/rbac';
import { BackendStatus } from '@prisma/client';

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

    return NextResponse.json({ backend }, { status: 201 });
  } catch (error) {
    console.error('Error creating backend:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
