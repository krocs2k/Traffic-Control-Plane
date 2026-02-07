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

    const rules = await prisma.alertRule.findMany({
      where: { orgId },
      include: {
        alerts: {
          where: { status: 'ACTIVE' },
          take: 5,
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(rules);
  } catch (error) {
    console.error('Error fetching alert rules:', error);
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
      name,
      description,
      type,
      metric,
      condition,
      threshold,
      duration,
      severity,
      targetType,
      targetId,
      cooldownMs,
      notifyChannels,
      escalationPolicy,
    } = body;

    if (!name || !metric || !condition || threshold === undefined) {
      return NextResponse.json({ error: 'Name, metric, condition, and threshold are required' }, { status: 400 });
    }

    const rule = await prisma.alertRule.create({
      data: {
        orgId,
        name,
        description,
        type: type || 'THRESHOLD',
        metric,
        condition,
        threshold: parseFloat(threshold),
        duration: duration || 60000,
        severity: severity || 'MEDIUM',
        targetType,
        targetId,
        cooldownMs: cooldownMs || 300000,
        notifyChannels: notifyChannels || [],
        escalationPolicy: escalationPolicy || {},
      },
    });

    await createAuditLog({
      orgId,
      userId: user.id,
      action: 'alert.rule.created',
      resourceType: 'alert_rule',
      resourceId: rule.id,
      details: { name, metric, condition, threshold },
    });

    return NextResponse.json(rule);
  } catch (error) {
    console.error('Error creating alert rule:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
