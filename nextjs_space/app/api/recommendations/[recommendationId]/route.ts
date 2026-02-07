import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';

// GET /api/recommendations/[recommendationId] - Get single recommendation
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ recommendationId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { recommendationId } = await params;

    const recommendation = await prisma.recommendation.findUnique({
      where: { id: recommendationId },
    });

    if (!recommendation) {
      return NextResponse.json({ error: 'Recommendation not found' }, { status: 404 });
    }

    // Check user has access to org
    const member = await prisma.organizationMember.findFirst({
      where: {
        orgId: recommendation.orgId,
        user: { email: session.user.email }
      }
    });

    if (!member) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return NextResponse.json({ recommendation });
  } catch (error) {
    console.error('Error fetching recommendation:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/recommendations/[recommendationId] - Update recommendation status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ recommendationId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { recommendationId } = await params;
    const body = await request.json();
    const { status } = body;

    if (!status || !['ACCEPTED', 'REJECTED', 'EXPIRED'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const recommendation = await prisma.recommendation.findUnique({
      where: { id: recommendationId }
    });

    if (!recommendation) {
      return NextResponse.json({ error: 'Recommendation not found' }, { status: 404 });
    }

    // Check user has appropriate role
    const member = await prisma.organizationMember.findFirst({
      where: {
        orgId: recommendation.orgId,
        user: { email: session.user.email },
        role: { in: ['OWNER', 'ADMIN', 'OPERATOR'] }
      },
      include: { user: true }
    });

    if (!member) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const updated = await prisma.recommendation.update({
      where: { id: recommendationId },
      data: { status },
    });

    // Audit log
    const actionMap: Record<string, 'recommendation.accepted' | 'recommendation.rejected' | 'recommendation.expired'> = {
      'ACCEPTED': 'recommendation.accepted',
      'REJECTED': 'recommendation.rejected',
      'EXPIRED': 'recommendation.expired',
    };
    await createAuditLog({
      orgId: recommendation.orgId,
      userId: member.user.id,
      action: actionMap[status],
      resourceType: 'recommendation',
      resourceId: recommendationId,
      details: {
        title: recommendation.title,
        category: recommendation.category,
      },
    });

    return NextResponse.json({ recommendation: updated });
  } catch (error) {
    console.error('Error updating recommendation:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
