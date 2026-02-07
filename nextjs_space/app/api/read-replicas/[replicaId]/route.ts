import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';
import { checkPermission } from '@/lib/rbac';

type Params = { params: Promise<{ replicaId: string }> };

// GET /api/read-replicas/[replicaId]
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { replicaId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const replica = await prisma.readReplica.findUnique({
      where: { id: replicaId },
      include: {
        organization: true,
        lagMetrics: {
          orderBy: { recordedAt: 'desc' },
          take: 100
        }
      }
    });

    if (!replica) {
      return NextResponse.json({ error: 'Read replica not found' }, { status: 404 });
    }

    // Check user has access to org
    const member = await prisma.organizationMember.findFirst({
      where: {
        orgId: replica.orgId,
        user: { email: session.user.email }
      }
    });

    if (!member) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return NextResponse.json({ replica });
  } catch (error) {
    console.error('Error fetching replica:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/read-replicas/[replicaId]
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { replicaId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const replica = await prisma.readReplica.findUnique({
      where: { id: replicaId }
    });

    if (!replica) {
      return NextResponse.json({ error: 'Read replica not found' }, { status: 404 });
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const hasPermission = await checkPermission(user.id, replica.orgId, 'manage_replicas');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const { name, host, port, region, maxAcceptableLagMs, currentLagMs, status, isActive, metadata } = body;

    // Check for duplicate name if changing
    if (name && name !== replica.name) {
      const existing = await prisma.readReplica.findUnique({
        where: { orgId_name: { orgId: replica.orgId, name } }
      });
      if (existing) {
        return NextResponse.json({ error: 'Read replica with this name already exists' }, { status: 409 });
      }
    }

    const updated = await prisma.readReplica.update({
      where: { id: replicaId },
      data: {
        ...(name && { name }),
        ...(host && { host }),
        ...(port !== undefined && { port }),
        ...(region !== undefined && { region }),
        ...(maxAcceptableLagMs !== undefined && { maxAcceptableLagMs }),
        ...(currentLagMs !== undefined && { currentLagMs }),
        ...(status && { status }),
        ...(isActive !== undefined && { isActive }),
        ...(metadata && { metadata }),
        lastHealthCheck: new Date()
      }
    });

    // Record lag metric if lag changed
    if (currentLagMs !== undefined) {
      await prisma.lagMetric.create({
        data: {
          replicaId,
          lagMs: currentLagMs
        }
      });
    }

    await createAuditLog({
      orgId: replica.orgId,
      userId: user.id,
      action: 'read_replica.update',
      resourceType: 'read_replica',
      resourceId: replicaId,
      details: { changes: body },
      ipAddress: getClientIP(request)
    });

    return NextResponse.json({ replica: updated });
  } catch (error) {
    console.error('Error updating replica:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/read-replicas/[replicaId]
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { replicaId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const replica = await prisma.readReplica.findUnique({
      where: { id: replicaId }
    });

    if (!replica) {
      return NextResponse.json({ error: 'Read replica not found' }, { status: 404 });
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const hasPermission = await checkPermission(user.id, replica.orgId, 'manage_replicas');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    await prisma.readReplica.delete({ where: { id: replicaId } });

    await createAuditLog({
      orgId: replica.orgId,
      userId: user.id,
      action: 'read_replica.delete',
      resourceType: 'read_replica',
      resourceId: replicaId,
      details: { name: replica.name },
      ipAddress: getClientIP(request)
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting replica:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
