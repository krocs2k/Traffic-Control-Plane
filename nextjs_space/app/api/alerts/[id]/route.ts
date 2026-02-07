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

    const alert = await prisma.alert.findUnique({
      where: { id },
      include: { rule: true },
    });

    if (!alert) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }

    return NextResponse.json(alert);
  } catch (error) {
    console.error('Error fetching alert:', error);
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

    const alert = await prisma.alert.findUnique({ where: { id } });
    if (!alert) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};

    // Handle status transitions
    if (body.status) {
      updateData.status = body.status;
      if (body.status === 'ACKNOWLEDGED') {
        updateData.acknowledgedBy = user.email;
        updateData.acknowledgedAt = new Date();
      }
      if (body.status === 'RESOLVED') {
        updateData.resolvedAt = new Date();
      }
    }

    const updated = await prisma.alert.update({
      where: { id },
      data: updateData,
      include: { rule: true },
    });

    const auditAction = body.status === 'ACKNOWLEDGED' ? 'alert.acknowledged' :
                        body.status === 'RESOLVED' ? 'alert.resolved' :
                        body.status === 'SILENCED' ? 'alert.silenced' : 'alert.updated';

    await createAuditLog({
      orgId: alert.orgId,
      userId: user.id,
      action: auditAction,
      resourceType: 'alert',
      resourceId: id,
      details: { title: alert.title, status: body.status },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating alert:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
