import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';

// GET /api/endpoints/[id] - Get a specific endpoint
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

    const endpoint = await prisma.trafficEndpoint.findUnique({
      where: { id }
    });

    if (!endpoint) {
      return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 });
    }

    // Get related data
    const [cluster, policy] = await Promise.all([
      endpoint.clusterId
        ? prisma.backendCluster.findUnique({
            where: { id: endpoint.clusterId },
            include: { backends: true }
          })
        : null,
      endpoint.policyId
        ? prisma.routingPolicy.findUnique({ where: { id: endpoint.policyId } })
        : null
    ]);

    return NextResponse.json({
      ...endpoint,
      totalRequests: Number(endpoint.totalRequests),
      totalErrors: Number(endpoint.totalErrors),
      cluster,
      policy
    });
  } catch (error) {
    console.error('Error fetching endpoint:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/endpoints/[id] - Update an endpoint
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

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: {
        memberships: {
          where: { role: { in: ['OWNER', 'ADMIN', 'OPERATOR'] } }
        }
      }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const endpoint = await prisma.trafficEndpoint.findUnique({
      where: { id }
    });

    if (!endpoint) {
      return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 });
    }

    // Check permission
    const hasMembership = user.memberships.some(m => m.orgId === endpoint.orgId);
    if (!hasMembership) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const { name, description, type, clusterId, policyId, config, isActive } = body;

    const updated = await prisma.trafficEndpoint.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(type !== undefined && { type }),
        ...(clusterId !== undefined && { clusterId: clusterId || null }),
        ...(policyId !== undefined && { policyId: policyId || null }),
        ...(config !== undefined && { config }),
        ...(isActive !== undefined && { isActive })
      }
    });

    await createAuditLog({
      orgId: endpoint.orgId,
      userId: user.id,
      action: 'endpoint.updated',
      resourceType: 'endpoint',
      resourceId: id,
      details: { name, type, isActive },
      ipAddress: getClientIP(request)
    });

    return NextResponse.json({
      ...updated,
      totalRequests: Number(updated.totalRequests),
      totalErrors: Number(updated.totalErrors)
    });
  } catch (error) {
    console.error('Error updating endpoint:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/endpoints/[id] - Delete an endpoint
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
      include: {
        memberships: {
          where: { role: { in: ['OWNER', 'ADMIN'] } }
        }
      }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const endpoint = await prisma.trafficEndpoint.findUnique({
      where: { id }
    });

    if (!endpoint) {
      return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 });
    }

    // Check permission
    const hasMembership = user.memberships.some(m => m.orgId === endpoint.orgId);
    if (!hasMembership) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    await prisma.trafficEndpoint.delete({ where: { id } });

    await createAuditLog({
      orgId: endpoint.orgId,
      userId: user.id,
      action: 'endpoint.deleted',
      resourceType: 'endpoint',
      resourceId: id,
      details: { name: endpoint.name, slug: endpoint.slug },
      ipAddress: getClientIP(request)
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting endpoint:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
