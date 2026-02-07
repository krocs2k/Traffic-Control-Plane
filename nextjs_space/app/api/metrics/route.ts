import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

// GET - Get traffic metrics
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
    const clusterId = searchParams.get('clusterId');
    const backendId = searchParams.get('backendId');
    const period = searchParams.get('period') || '1h';
    const limit = parseInt(searchParams.get('limit') || '100');

    const where: Record<string, unknown> = { orgId };
    if (clusterId) where.clusterId = clusterId;
    if (backendId) where.backendId = backendId;
    if (period) where.period = period;

    const metrics = await prisma.trafficMetric.findMany({
      where,
      orderBy: { recordedAt: 'desc' },
      take: limit,
    });

    return NextResponse.json(metrics);
  } catch (error) {
    console.error('Error fetching metrics:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Record traffic metrics
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

    const orgId = user.memberships[0].orgId;
    const body = await request.json();
    const {
      clusterId,
      backendId,
      policyId,
      requestCount,
      errorCount,
      avgLatencyMs,
      p50LatencyMs,
      p95LatencyMs,
      p99LatencyMs,
      bytesIn,
      bytesOut,
      period,
    } = body;

    const metric = await prisma.trafficMetric.create({
      data: {
        orgId,
        clusterId,
        backendId,
        policyId,
        requestCount: requestCount || 0,
        errorCount: errorCount || 0,
        avgLatencyMs: avgLatencyMs || 0,
        p50LatencyMs,
        p95LatencyMs,
        p99LatencyMs,
        bytesIn: bytesIn || 0,
        bytesOut: bytesOut || 0,
        period: period || '1m',
      },
    });

    return NextResponse.json(metric, { status: 201 });
  } catch (error) {
    console.error('Error recording metric:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
