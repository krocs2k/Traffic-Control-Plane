import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';
import { checkPermission } from '@/lib/rbac';
import { RoutingPolicyType } from '@prisma/client';

// GET /api/routing-policies - List routing policies with pagination
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('orgId');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const type = searchParams.get('type') as RoutingPolicyType | null;
    const isActive = searchParams.get('isActive');
    const search = searchParams.get('search') || '';

    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID required' }, { status: 400 });
    }

    // Check user has access to org
    const member = await prisma.organizationMember.findFirst({
      where: {
        orgId,
        user: { email: session.user.email }
      }
    });

    if (!member) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const where: Record<string, unknown> = { orgId };
    if (type) where.type = type;
    if (isActive !== null) where.isActive = isActive === 'true';
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [policies, total] = await Promise.all([
      prisma.routingPolicy.findMany({
        where,
        include: {
          cluster: {
            select: { id: true, name: true, strategy: true }
          }
        },
        orderBy: [{ priority: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.routingPolicy.count({ where }),
    ]);

    return NextResponse.json({
      policies,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching routing policies:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/routing-policies - Create a new routing policy
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { orgId, name, description, type, priority, clusterId, conditions, actions } = body;

    if (!orgId || !name) {
      return NextResponse.json({ error: 'Organization ID and name required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const hasPermission = await checkPermission(user.id, orgId, 'manage_routing');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    // Check for duplicate name
    const existing = await prisma.routingPolicy.findUnique({
      where: { orgId_name: { orgId, name } }
    });

    if (existing) {
      return NextResponse.json({ error: 'Policy with this name already exists' }, { status: 409 });
    }

    // Validate cluster if provided
    if (clusterId) {
      const cluster = await prisma.backendCluster.findUnique({
        where: { id: clusterId, orgId }
      });
      if (!cluster) {
        return NextResponse.json({ error: 'Cluster not found or does not belong to this organization' }, { status: 400 });
      }
    }

    const policy = await prisma.routingPolicy.create({
      data: {
        orgId,
        name,
        description,
        type: type || RoutingPolicyType.WEIGHTED,
        priority: priority || 100,
        clusterId,
        conditions: conditions || [],
        actions: actions || {}
      },
      include: {
        cluster: { select: { id: true, name: true } }
      }
    });

    await createAuditLog({
      orgId,
      userId: user.id,
      action: 'routing_policy.create',
      resourceType: 'routing_policy',
      resourceId: policy.id,
      details: { name, type: policy.type },
      ipAddress: getClientIP(request)
    });

    return NextResponse.json({ policy }, { status: 201 });
  } catch (error) {
    console.error('Error creating routing policy:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
