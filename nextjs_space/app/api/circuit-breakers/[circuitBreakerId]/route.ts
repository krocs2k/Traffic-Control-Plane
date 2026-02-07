import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';

// GET - Get single circuit breaker
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ circuitBreakerId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { circuitBreakerId } = await params;

    const circuitBreaker = await prisma.circuitBreaker.findUnique({
      where: { id: circuitBreakerId },
    });

    if (!circuitBreaker) {
      return NextResponse.json({ error: 'Circuit breaker not found' }, { status: 404 });
    }

    return NextResponse.json(circuitBreaker);
  } catch (error) {
    console.error('Error fetching circuit breaker:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH - Update circuit breaker
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ circuitBreakerId: string }> }
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

    const { circuitBreakerId } = await params;
    const body = await request.json();
    const {
      name,
      state,
      failureThreshold,
      successThreshold,
      timeoutMs,
      halfOpenMaxRequests,
      isActive,
      metadata,
    } = body;

    const existing = await prisma.circuitBreaker.findUnique({
      where: { id: circuitBreakerId },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Circuit breaker not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (state !== undefined) {
      updateData.state = state;
      updateData.lastStateChange = new Date();
      // Reset counters on state change
      if (state === 'CLOSED') {
        updateData.failureCount = 0;
        updateData.successCount = 0;
      }
    }
    if (failureThreshold !== undefined) updateData.failureThreshold = failureThreshold;
    if (successThreshold !== undefined) updateData.successThreshold = successThreshold;
    if (timeoutMs !== undefined) updateData.timeoutMs = timeoutMs;
    if (halfOpenMaxRequests !== undefined) updateData.halfOpenMaxRequests = halfOpenMaxRequests;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (metadata !== undefined) updateData.metadata = metadata;

    const circuitBreaker = await prisma.circuitBreaker.update({
      where: { id: circuitBreakerId },
      data: updateData,
    });

    await createAuditLog({
      orgId: membership.orgId,
      userId: user.id,
      action: 'circuit_breaker.updated',
      resourceType: 'circuit_breaker',
      resourceId: circuitBreakerId,
      details: { changes: body },
      ipAddress: getClientIP(request),
    });

    return NextResponse.json(circuitBreaker);
  } catch (error) {
    console.error('Error updating circuit breaker:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE - Delete circuit breaker
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ circuitBreakerId: string }> }
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

    const { circuitBreakerId } = await params;

    const existing = await prisma.circuitBreaker.findUnique({
      where: { id: circuitBreakerId },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Circuit breaker not found' }, { status: 404 });
    }

    await prisma.circuitBreaker.delete({
      where: { id: circuitBreakerId },
    });

    await createAuditLog({
      orgId: membership.orgId,
      userId: user.id,
      action: 'circuit_breaker.deleted',
      resourceType: 'circuit_breaker',
      resourceId: circuitBreakerId,
      details: { name: existing.name },
      ipAddress: getClientIP(request),
    });

    return NextResponse.json({ message: 'Circuit breaker deleted' });
  } catch (error) {
    console.error('Error deleting circuit breaker:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
