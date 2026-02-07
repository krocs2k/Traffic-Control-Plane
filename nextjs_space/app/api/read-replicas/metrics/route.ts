import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

// GET /api/read-replicas/metrics - Get lag metrics history
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('orgId');
    const replicaId = searchParams.get('replicaId');
    const hours = parseInt(searchParams.get('hours') || '24');

    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID required' }, { status: 400 });
    }

    // Check user has access to org
    const member = await prisma.organizationMember.findFirst({
      where: {
        orgId,
        user: { email: session.user.email }
      }
    });

    if (!member) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const where = replicaId
      ? { replicaId, recordedAt: { gte: since } }
      : { replica: { orgId }, recordedAt: { gte: since } };

    const metrics = await prisma.lagMetric.findMany({
      where,
      include: {
        replica: {
          select: { id: true, name: true, region: true }
        }
      },
      orderBy: { recordedAt: 'asc' }
    });

    // Aggregate metrics by replica
    const aggregated: Record<string, {
      replicaId: string;
      replicaName: string;
      region: string | null;
      metrics: { time: string; lagMs: number }[];
      avgLagMs: number;
      maxLagMs: number;
      minLagMs: number;
    }> = {};

    for (const metric of metrics) {
      if (!metric.replica) continue;
      
      if (!aggregated[metric.replicaId!]) {
        aggregated[metric.replicaId!] = {
          replicaId: metric.replicaId!,
          replicaName: metric.replica.name,
          region: metric.replica.region,
          metrics: [],
          avgLagMs: 0,
          maxLagMs: 0,
          minLagMs: Infinity
        };
      }

      aggregated[metric.replicaId!].metrics.push({
        time: metric.recordedAt.toISOString(),
        lagMs: metric.lagMs
      });

      aggregated[metric.replicaId!].maxLagMs = Math.max(
        aggregated[metric.replicaId!].maxLagMs,
        metric.lagMs
      );
      aggregated[metric.replicaId!].minLagMs = Math.min(
        aggregated[metric.replicaId!].minLagMs,
        metric.lagMs
      );
    }

    // Calculate averages
    for (const key of Object.keys(aggregated)) {
      const data = aggregated[key];
      data.avgLagMs = Math.round(
        data.metrics.reduce((sum, m) => sum + m.lagMs, 0) / data.metrics.length
      );
      if (data.minLagMs === Infinity) data.minLagMs = 0;
    }

    return NextResponse.json({
      metrics: Object.values(aggregated),
      period: { hours, since: since.toISOString() }
    });
  } catch (error) {
    console.error('Error fetching lag metrics:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/read-replicas/metrics - Record a new lag metric
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { replicaId, lagMs, bytesLag, transactionsLag } = body;

    if (!replicaId || lagMs === undefined) {
      return NextResponse.json({ error: 'Replica ID and lag required' }, { status: 400 });
    }

    const replica = await prisma.readReplica.findUnique({
      where: { id: replicaId },
      select: { orgId: true }
    });

    if (!replica) {
      return NextResponse.json({ error: 'Replica not found' }, { status: 404 });
    }

    // Check user has access to org
    const member = await prisma.organizationMember.findFirst({
      where: {
        orgId: replica.orgId,
        user: { email: session.user.email }
      }
    });

    if (!member) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Create metric and update replica
    const [metric] = await prisma.$transaction([
      prisma.lagMetric.create({
        data: {
          replicaId,
          lagMs,
          bytesLag,
          transactionsLag
        }
      }),
      prisma.readReplica.update({
        where: { id: replicaId },
        data: {
          currentLagMs: lagMs,
          lastHealthCheck: new Date(),
          status: lagMs <= 1000 ? 'SYNCED' : lagMs <= 5000 ? 'LAGGING' : 'CATCHING_UP'
        }
      })
    ]);

    return NextResponse.json({ metric }, { status: 201 });
  } catch (error) {
    console.error('Error recording lag metric:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
