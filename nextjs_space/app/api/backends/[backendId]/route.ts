import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';
import { checkPermission } from '@/lib/rbac';

type Params = { params: Promise<{ backendId: string }> };

// GET /api/backends/[backendId]
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { backendId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const backend = await prisma.backend.findUnique({
      where: { id: backendId },
      include: {
        cluster: {
          include: { organization: true }
        },
        lagMetrics: {
          orderBy: { recordedAt: 'desc' },
          take: 100
        }
      }
    });

    if (!backend) {
      return NextResponse.json({ error: 'Backend not found' }, { status: 404 });
    }

    // Check user has access to org
    const member = await prisma.organizationMember.findFirst({
      where: {
        orgId: backend.cluster.orgId,
        user: { email: session.user.email }
      }
    });

    if (!member) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return NextResponse.json({ backend });
  } catch (error) {
    console.error('Error fetching backend:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/backends/[backendId]
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { backendId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const backend = await prisma.backend.findUnique({
      where: { id: backendId },
      include: { cluster: { select: { orgId: true } } }
    });

    if (!backend) {
      return NextResponse.json({ error: 'Backend not found' }, { status: 404 });
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const hasPermission = await checkPermission(user.id, backend.cluster.orgId, 'manage_backends');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const { name, host, port, protocol, weight, status, healthCheckPath, maxConnections, tags, isActive, metadata } = body;

    const updated = await prisma.backend.update({
      where: { id: backendId },
      data: {
        ...(name && { name }),
        ...(host && { host }),
        ...(port !== undefined && { port }),
        ...(protocol && { protocol }),
        ...(weight !== undefined && { weight }),
        ...(status && { status }),
        ...(healthCheckPath && { healthCheckPath }),
        ...(maxConnections !== undefined && { maxConnections }),
        ...(tags && { tags }),
        ...(isActive !== undefined && { isActive }),
        ...(metadata && { metadata })
      },
      include: {
        cluster: { select: { id: true, name: true } }
      }
    });

    await createAuditLog({
      orgId: backend.cluster.orgId,
      userId: user.id,
      action: 'backend.update',
      resourceType: 'backend',
      resourceId: backendId,
      details: { changes: body },
      ipAddress: getClientIP(request)
    });

    return NextResponse.json({ backend: updated });
  } catch (error) {
    console.error('Error updating backend:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/backends/[backendId]
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { backendId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const backend = await prisma.backend.findUnique({
      where: { id: backendId },
      include: { cluster: { select: { orgId: true, name: true } } }
    });

    if (!backend) {
      return NextResponse.json({ error: 'Backend not found' }, { status: 404 });
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const hasPermission = await checkPermission(user.id, backend.cluster.orgId, 'manage_backends');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    await prisma.backend.delete({ where: { id: backendId } });

    await createAuditLog({
      orgId: backend.cluster.orgId,
      userId: user.id,
      action: 'backend.delete',
      resourceType: 'backend',
      resourceId: backendId,
      details: { name: backend.name, cluster: backend.cluster.name },
      ipAddress: getClientIP(request)
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting backend:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
