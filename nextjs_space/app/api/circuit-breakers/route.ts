import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';

// GET - List circuit breakers
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
    const state = searchParams.get('state');
    const targetType = searchParams.get('targetType');

    const where: Record<string, unknown> = { orgId };
    if (state) where.state = state;
    if (targetType) where.targetType = targetType;

    const circuitBreakers = await prisma.circuitBreaker.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    return NextResponse.json(circuitBreakers);
  } catch (error) {
    console.error('Error fetching circuit breakers:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Create circuit breaker
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
      targetType,
      targetId,
      failureThreshold,
      successThreshold,
      timeoutMs,
      halfOpenMaxRequests,
      isActive,
      metadata,
    } = body;

    if (!name || !targetType || !targetId) {
      return NextResponse.json(
        { error: 'Name, targetType, and targetId are required' },
        { status: 400 }
      );
    }

    const circuitBreaker = await prisma.circuitBreaker.create({
      data: {
        orgId,
        name,
        targetType,
        targetId,
        failureThreshold: failureThreshold || 5,
        successThreshold: successThreshold || 3,
        timeoutMs: timeoutMs || 30000,
        halfOpenMaxRequests: halfOpenMaxRequests || 3,
        isActive: isActive !== false,
        metadata: metadata || {},
      },
    });

    await createAuditLog({
      orgId,
      userId: user.id,
      action: 'circuit_breaker.created',
      resourceType: 'circuit_breaker',
      resourceId: circuitBreaker.id,
      details: { name, targetType, targetId },
      ipAddress: getClientIP(request),
    });

    return NextResponse.json(circuitBreaker, { status: 201 });
  } catch (error) {
    console.error('Error creating circuit breaker:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
