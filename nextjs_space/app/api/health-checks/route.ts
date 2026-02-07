import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

// GET - List health check results
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const backendId = searchParams.get('backendId');
    const replicaId = searchParams.get('replicaId');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '100');

    const where: Record<string, unknown> = {};
    if (backendId) where.backendId = backendId;
    if (replicaId) where.replicaId = replicaId;
    if (status) where.status = status;

    const healthChecks = await prisma.healthCheck.findMany({
      where,
      orderBy: { checkedAt: 'desc' },
      take: limit,
    });

    return NextResponse.json(healthChecks);
  } catch (error) {
    console.error('Error fetching health checks:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Record a new health check
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { backendId, replicaId, endpoint, status, responseTime, statusCode, errorMessage, metadata } = body;

    if (!endpoint) {
      return NextResponse.json({ error: 'Endpoint is required' }, { status: 400 });
    }

    const healthCheck = await prisma.healthCheck.create({
      data: {
        backendId,
        replicaId,
        endpoint,
        status: status || 'UNKNOWN',
        responseTime,
        statusCode,
        errorMessage,
        metadata: metadata || {},
      },
    });

    // Update backend or replica status based on health check
    if (backendId && status) {
      await prisma.backend.update({
        where: { id: backendId },
        data: {
          status: status === 'HEALTHY' ? 'HEALTHY' : status === 'UNHEALTHY' ? 'UNHEALTHY' : 'DRAINING',
          lastHealthCheck: new Date(),
        },
      });
    }

    if (replicaId && status) {
      await prisma.readReplica.update({
        where: { id: replicaId },
        data: {
          status: status === 'HEALTHY' ? 'SYNCED' : 'OFFLINE',
          lastHealthCheck: new Date(),
        },
      });
    }

    return NextResponse.json(healthCheck, { status: 201 });
  } catch (error) {
    console.error('Error creating health check:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
