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

    const experiment = await prisma.experiment.findUnique({
      where: { id },
      include: {
        variants: true,
        metrics: {
          orderBy: { recordedAt: 'desc' },
          take: 100,
        },
      },
    });

    if (!experiment) {
      return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
    }

    return NextResponse.json(experiment);
  } catch (error) {
    console.error('Error fetching experiment:', error);
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

    const experiment = await prisma.experiment.findUnique({ where: { id } });
    if (!experiment) {
      return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
    }

    const { status, name, description, rolloutPercentage, successMetric, variants } = body;

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (rolloutPercentage !== undefined) updateData.rolloutPercentage = rolloutPercentage;
    if (successMetric !== undefined) updateData.successMetric = successMetric;

    if (status) {
      updateData.status = status;
      if (status === 'RUNNING' && !experiment.startedAt) {
        updateData.startedAt = new Date();
      }
      if (status === 'COMPLETED' || status === 'ABORTED') {
        updateData.endedAt = new Date();
      }
    }

    const updated = await prisma.experiment.update({
      where: { id },
      data: updateData,
      include: { variants: true },
    });

    if (variants && Array.isArray(variants)) {
      for (const v of variants) {
        if (v.id) {
          await prisma.experimentVariant.update({
            where: { id: v.id },
            data: {
              name: v.name,
              description: v.description,
              backendId: v.backendId,
              weight: v.weight,
              isControl: v.isControl,
              config: v.config || {},
            },
          });
        }
      }
    }

    await createAuditLog({
      orgId: experiment.orgId,
      userId: user.id,
      action: 'experiment.updated',
      resourceType: 'experiment',
      resourceId: experiment.id,
      details: { changes: Object.keys(updateData) },
    });

    const finalExperiment = await prisma.experiment.findUnique({
      where: { id },
      include: { variants: true, metrics: { orderBy: { recordedAt: 'desc' }, take: 10 } },
    });

    return NextResponse.json(finalExperiment);
  } catch (error) {
    console.error('Error updating experiment:', error);
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

    const experiment = await prisma.experiment.findUnique({ where: { id } });
    if (!experiment) {
      return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
    }

    await prisma.experiment.delete({ where: { id } });

    await createAuditLog({
      orgId: experiment.orgId,
      userId: user.id,
      action: 'experiment.deleted',
      resourceType: 'experiment',
      resourceId: id,
      details: { name: experiment.name },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting experiment:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
