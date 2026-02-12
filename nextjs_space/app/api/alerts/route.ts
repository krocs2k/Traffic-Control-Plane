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
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const status = searchParams.get('status');
    const severity = searchParams.get('severity');
    const search = searchParams.get('search') || '';
    const archived = searchParams.get('archived');
    const viewMode = searchParams.get('viewMode'); // 'active', 'resolved', 'archived'

    const where: Record<string, unknown> = { orgId };
    
    // Handle view modes
    if (viewMode === 'active') {
      where.archived = false;
      where.status = { in: ['ACTIVE', 'ACKNOWLEDGED'] };
    } else if (viewMode === 'resolved') {
      where.archived = false;
      where.status = 'RESOLVED';
    } else if (viewMode === 'archived') {
      where.archived = true;
    } else {
      // Legacy support for archived param
      if (archived === 'true') {
        where.archived = true;
      } else if (archived !== 'all') {
        where.archived = false;
      }
    }
    
    if (status && !viewMode) where.status = status;
    if (severity) where.severity = severity;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { message: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [alerts, total, archivedCount, resolvedCount] = await Promise.all([
      prisma.alert.findMany({
        where,
        include: { rule: { select: { name: true, metric: true, condition: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.alert.count({ where }),
      prisma.alert.count({ where: { orgId, archived: true } }),
      prisma.alert.count({ where: { orgId, archived: false, status: 'RESOLVED' } }),
    ]);

    return NextResponse.json({
      alerts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      archivedCount,
      resolvedCount,
    });
  } catch (error) {
    console.error('Error fetching alerts:', error);
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

    const {
      ruleId,
      severity,
      title,
      message,
      metricValue,
      threshold,
      targetType,
      targetId,
    } = body;

    if (!title || !message) {
      return NextResponse.json({ error: 'Title and message are required' }, { status: 400 });
    }

    const alert = await prisma.alert.create({
      data: {
        orgId,
        ruleId,
        severity: severity || 'MEDIUM',
        title,
        message,
        metricValue,
        threshold,
        targetType,
        targetId,
      },
    });

    return NextResponse.json(alert);
  } catch (error) {
    console.error('Error creating alert:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH: Bulk archive/unarchive alerts
export async function PATCH(request: NextRequest) {
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
    const { ids, unarchive } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'Alert IDs are required' }, { status: 400 });
    }

    const result = await prisma.alert.updateMany({
      where: {
        id: { in: ids },
        orgId,
      },
      data: {
        archived: !unarchive,
        archivedAt: unarchive ? null : new Date(),
      },
    });

    await createAuditLog({
      userId: user.id,
      orgId,
      action: unarchive ? 'alert.unarchived' : 'alert.archived',
      resourceType: 'alert',
      details: { alertIds: ids, count: result.count },
    });

    return NextResponse.json({
      success: true,
      message: `${result.count} alert${result.count !== 1 ? 's' : ''} ${unarchive ? 'unarchived' : 'archived'}`,
      count: result.count,
    });
  } catch (error) {
    console.error('Error archiving alerts:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE: Bulk delete alerts
export async function DELETE(request: NextRequest) {
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
    const { ids } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'Alert IDs are required' }, { status: 400 });
    }

    const result = await prisma.alert.deleteMany({
      where: {
        id: { in: ids },
        orgId,
      },
    });

    await createAuditLog({
      userId: user.id,
      orgId,
      action: 'alert.deleted',
      resourceType: 'alert',
      details: { alertIds: ids, count: result.count },
    });

    return NextResponse.json({
      success: true,
      message: `${result.count} alert${result.count !== 1 ? 's' : ''} deleted`,
      count: result.count,
    });
  } catch (error) {
    console.error('Error deleting alerts:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
