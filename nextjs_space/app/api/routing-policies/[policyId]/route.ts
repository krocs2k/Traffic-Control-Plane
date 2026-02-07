import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';
import { checkPermission } from '@/lib/rbac';

type Params = { params: Promise<{ policyId: string }> };

// GET /api/routing-policies/[policyId]
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { policyId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const policy = await prisma.routingPolicy.findUnique({
      where: { id: policyId },
      include: {
        cluster: {
          include: {
            backends: { orderBy: { name: 'asc' } }
          }
        },
        organization: true
      }
    });

    if (!policy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    // Check user has access to org
    const member = await prisma.organizationMember.findFirst({
      where: {
        orgId: policy.orgId,
        user: { email: session.user.email }
      }
    });

    if (!member) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return NextResponse.json({ policy });
  } catch (error) {
    console.error('Error fetching policy:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/routing-policies/[policyId]
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { policyId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const policy = await prisma.routingPolicy.findUnique({
      where: { id: policyId }
    });

    if (!policy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const hasPermission = await checkPermission(user.id, policy.orgId, 'manage_routing');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const { name, description, type, priority, clusterId, conditions, actions, isActive } = body;

    // Check for duplicate name if changing
    if (name && name !== policy.name) {
      const existing = await prisma.routingPolicy.findUnique({
        where: { orgId_name: { orgId: policy.orgId, name } }
      });
      if (existing) {
        return NextResponse.json({ error: 'Policy with this name already exists' }, { status: 409 });
      }
    }

    // Validate cluster if provided
    if (clusterId !== undefined && clusterId !== policy.clusterId) {
      if (clusterId) {
        const cluster = await prisma.backendCluster.findUnique({
          where: { id: clusterId, orgId: policy.orgId }
        });
        if (!cluster) {
          return NextResponse.json({ error: 'Cluster not found or does not belong to this organization' }, { status: 400 });
        }
      }
    }

    const updated = await prisma.routingPolicy.update({
      where: { id: policyId },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(type && { type }),
        ...(priority !== undefined && { priority }),
        ...(clusterId !== undefined && { clusterId }),
        ...(conditions && { conditions }),
        ...(actions && { actions }),
        ...(isActive !== undefined && { isActive })
      },
      include: {
        cluster: { select: { id: true, name: true } }
      }
    });

    await createAuditLog({
      orgId: policy.orgId,
      userId: user.id,
      action: 'routing_policy.update',
      resourceType: 'routing_policy',
      resourceId: policyId,
      details: { changes: body },
      ipAddress: getClientIP(request)
    });

    return NextResponse.json({ policy: updated });
  } catch (error) {
    console.error('Error updating policy:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/routing-policies/[policyId]
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { policyId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const policy = await prisma.routingPolicy.findUnique({
      where: { id: policyId }
    });

    if (!policy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const hasPermission = await checkPermission(user.id, policy.orgId, 'manage_routing');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    await prisma.routingPolicy.delete({ where: { id: policyId } });

    await createAuditLog({
      orgId: policy.orgId,
      userId: user.id,
      action: 'routing_policy.delete',
      resourceType: 'routing_policy',
      resourceId: policyId,
      details: { name: policy.name },
      ipAddress: getClientIP(request)
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting policy:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
