import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';

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

    const rule = await prisma.alertRule.findUnique({
      where: { id },
      include: { alerts: { orderBy: { createdAt: 'desc' }, take: 50 } },
    });

    if (!rule) {
      return NextResponse.json({ error: 'Alert rule not found' }, { status: 404 });
    }

    return NextResponse.json(rule);
  } catch (error) {
    console.error('Error fetching alert rule:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

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
    const body = await request.json();

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { memberships: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const rule = await prisma.alertRule.findUnique({ where: { id } });
    if (!rule) {
      return NextResponse.json({ error: 'Alert rule not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    const allowedFields = [
      'name', 'description', 'type', 'isActive', 'metric', 'condition',
      'threshold', 'duration', 'severity', 'targetType', 'targetId',
      'cooldownMs', 'notifyChannels', 'escalationPolicy'
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    const updated = await prisma.alertRule.update({
      where: { id },
      data: updateData,
    });

    await createAuditLog({
      orgId: rule.orgId,
      userId: user.id,
      action: 'alert.rule.updated',
      resourceType: 'alert_rule',
      resourceId: id,
      details: { changes: Object.keys(updateData) },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating alert rule:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

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
      include: { memberships: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const rule = await prisma.alertRule.findUnique({ where: { id } });
    if (!rule) {
      return NextResponse.json({ error: 'Alert rule not found' }, { status: 404 });
    }

    await prisma.alertRule.delete({ where: { id } });

    await createAuditLog({
      orgId: rule.orgId,
      userId: user.id,
      action: 'alert.rule.deleted',
      resourceType: 'alert_rule',
      resourceId: id,
      details: { name: rule.name },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting alert rule:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
