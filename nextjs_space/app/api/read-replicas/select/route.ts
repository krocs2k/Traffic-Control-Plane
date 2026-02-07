import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { selectReadReplica, formatReplicaLag } from '@/lib/routing';

// POST /api/read-replicas/select - Select optimal read replica using lag-aware algorithm
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { orgId, maxAcceptableLagMs, preferredRegion } = body;

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

    // Get all replicas for the org
    const replicas = await prisma.readReplica.findMany({
      where: { orgId }
    });

    if (replicas.length === 0) {
      return NextResponse.json({
        selected: null,
        message: 'No read replicas configured'
      });
    }

    const selection = selectReadReplica(replicas, maxAcceptableLagMs, preferredRegion);

    if (!selection) {
      return NextResponse.json({
        selected: null,
        message: 'No suitable read replica available',
        fallbackToPrimary: true
      });
    }

    return NextResponse.json({
      selected: {
        id: selection.replica.id,
        name: selection.replica.name,
        host: selection.replica.host,
        port: selection.replica.port,
        region: selection.replica.region,
        lagMs: selection.lagMs,
        lagFormatted: formatReplicaLag(selection.lagMs)
      },
      reason: selection.reason,
      fallbackToPrimary: false
    });
  } catch (error) {
    console.error('Error selecting read replica:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
