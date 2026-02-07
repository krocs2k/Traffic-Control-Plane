import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';

// GET - List rate limit rules
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

    if (!user?.memberships?.[0]) {
      return NextResponse.json({ error: 'User not in an organization' }, { status: 403 });
    }

    const orgId = user.memberships[0].orgId;
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get('scope');
    const isActive = searchParams.get('isActive');

    const where: Record<string, unknown> = { orgId };
    if (scope) where.scope = scope;
    if (isActive !== null) where.isActive = isActive === 'true';

    const rateLimits = await prisma.rateLimitRule.findMany({
      where,
      orderBy: { priority: 'asc' },
    });

    return NextResponse.json(rateLimits);
  } catch (error) {
    console.error('Error fetching rate limits:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Create rate limit rule
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

    if (!user?.memberships?.[0]) {
      return NextResponse.json({ error: 'User not in an organization' }, { status: 403 });
    }

    const membership = user.memberships[0];
    if (!['OWNER', 'ADMIN', 'OPERATOR'].includes(membership.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const orgId = membership.orgId;
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

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const rateLimit = await prisma.rateLimitRule.create({
      data: {
        orgId,
        name,
        description,
        type: type || 'REQUESTS_PER_MINUTE',
        limit: limit || 100,
        windowMs: windowMs || 60000,
        burstLimit,
        scope: scope || 'global',
        matchConditions: matchConditions || [],
        action: action || 'reject',
        isActive: isActive !== false,
        priority: priority || 100,
        metadata: metadata || {},
      },
    });

    await createAuditLog({
      orgId,
      userId: user.id,
      action: 'rate_limit.created',
      resourceType: 'rate_limit',
      resourceId: rateLimit.id,
      details: { name, type, limit, scope },
      ipAddress: getClientIP(request),
    });

    return NextResponse.json(rateLimit, { status: 201 });
  } catch (error) {
    console.error('Error creating rate limit:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
