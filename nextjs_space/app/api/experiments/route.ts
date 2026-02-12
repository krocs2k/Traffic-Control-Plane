import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { memberships: true },
    });

    if (!user || user.memberships.length === 0) {
      return NextResponse.json({ error: 'No organization found' }, { status: 404 });
    }

    const orgId = user.memberships[0].orgId;
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)));
    const status = searchParams.get('status'); // 'DRAFT' | 'RUNNING' | 'PAUSED' | 'COMPLETED'
    const search = searchParams.get('search') || '';

    const where: Record<string, unknown> = { orgId };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [experiments, total] = await Promise.all([
      prisma.experiment.findMany({
        where,
        include: {
          variants: true,
          metrics: {
            orderBy: { recordedAt: 'desc' },
            take: 5, // Limit metrics per experiment
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.experiment.count({ where }),
    ]);

    return NextResponse.json({
      experiments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching experiments:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { memberships: true },
    });

    if (!user || user.memberships.length === 0) {
      return NextResponse.json({ error: 'No organization found' }, { status: 404 });
    }

    const orgId = user.memberships[0].orgId;
    const body = await request.json();

    const { name, description, type, clusterId, targetRoutes, rolloutPercentage, successMetric, variants } = body;

    if (!name || !type) {
      return NextResponse.json({ error: 'Name and type are required' }, { status: 400 });
    }

    const experiment = await prisma.experiment.create({
      data: {
        orgId,
        name,
        description,
        type,
        clusterId,
        targetRoutes: targetRoutes || [],
        rolloutPercentage: rolloutPercentage || 10,
        successMetric,
        variants: {
          create: variants?.map((v: { name: string; description?: string; backendId?: string; weight: number; isControl?: boolean; config?: object }) => ({
            name: v.name,
            description: v.description,
            backendId: v.backendId,
            weight: v.weight || 50,
            isControl: v.isControl || false,
            config: v.config || {},
          })) || [],
        },
      },
      include: { variants: true },
    });

    await createAuditLog({
      orgId,
      userId: user.id,
      action: 'experiment.created',
      resourceType: 'experiment',
      resourceId: experiment.id,
      details: { name, type },
    });

    return NextResponse.json(experiment);
  } catch (error) {
    console.error('Error creating experiment:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
