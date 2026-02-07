import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';

// GET - Get single rate limit rule
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ rateLimitId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { rateLimitId } = await params;

    const rateLimit = await prisma.rateLimitRule.findUnique({
      where: { id: rateLimitId },
    });

    if (!rateLimit) {
      return NextResponse.json({ error: 'Rate limit rule not found' }, { status: 404 });
    }

    return NextResponse.json(rateLimit);
  } catch (error) {
    console.error('Error fetching rate limit:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH - Update rate limit rule
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ rateLimitId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { memberships: true },
    });

    if (!user?.memberships?.[0]) {
      return NextResponse.json({ error: 'User not in an organization' }, { status: 403 });
    }

    const membership = user.memberships[0];
    if (!['OWNER', 'ADMIN', 'OPERATOR'].includes(membership.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const { rateLimitId } = await params;
    const body = await request.json();
    const {
      name,
      description,
      type,
      limit,
      windowMs,
      burstLimit,
      scope,
      matchConditions,
      action,
      isActive,
      priority,
      metadata,
    } = body;

    const existing = await prisma.rateLimitRule.findUnique({
      where: { id: rateLimitId },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Rate limit rule not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (type !== undefined) updateData.type = type;
    if (limit !== undefined) updateData.limit = limit;
    if (windowMs !== undefined) updateData.windowMs = windowMs;
    if (burstLimit !== undefined) updateData.burstLimit = burstLimit;
    if (scope !== undefined) updateData.scope = scope;
    if (matchConditions !== undefined) updateData.matchConditions = matchConditions;
    if (action !== undefined) updateData.action = action;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (priority !== undefined) updateData.priority = priority;
    if (metadata !== undefined) updateData.metadata = metadata;

    const rateLimit = await prisma.rateLimitRule.update({
      where: { id: rateLimitId },
      data: updateData,
    });

    await createAuditLog({
      orgId: membership.orgId,
      userId: user.id,
      action: 'rate_limit.updated',
      resourceType: 'rate_limit',
      resourceId: rateLimitId,
      details: { changes: body },
      ipAddress: getClientIP(request),
    });

    return NextResponse.json(rateLimit);
  } catch (error) {
    console.error('Error updating rate limit:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE - Delete rate limit rule
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ rateLimitId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { memberships: true },
    });

    if (!user?.memberships?.[0]) {
      return NextResponse.json({ error: 'User not in an organization' }, { status: 403 });
    }

    const membership = user.memberships[0];
    if (!['OWNER', 'ADMIN'].includes(membership.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const { rateLimitId } = await params;

    const existing = await prisma.rateLimitRule.findUnique({
      where: { id: rateLimitId },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Rate limit rule not found' }, { status: 404 });
    }

    await prisma.rateLimitRule.delete({
      where: { id: rateLimitId },
    });

    await createAuditLog({
      orgId: membership.orgId,
      userId: user.id,
      action: 'rate_limit.deleted',
      resourceType: 'rate_limit',
      resourceId: rateLimitId,
      details: { name: existing.name },
      ipAddress: getClientIP(request),
    });

    return NextResponse.json({ message: 'Rate limit rule deleted' });
  } catch (error) {
    console.error('Error deleting rate limit:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
