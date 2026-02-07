import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';
import { checkPermission } from '@/lib/rbac';
import { ReplicaStatus } from '@prisma/client';

// GET /api/read-replicas - List read replicas
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('orgId');
    const status = searchParams.get('status') as ReplicaStatus | null;
    const region = searchParams.get('region');

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

    const replicas = await prisma.readReplica.findMany({
      where: {
        orgId,
        ...(status && { status }),
        ...(region && { region })
      },
      include: {
        lagMetrics: {
          orderBy: { recordedAt: 'desc' },
          take: 10
        }
      },
      orderBy: { name: 'asc' }
    });

    return NextResponse.json({ replicas });
  } catch (error) {
    console.error('Error fetching read replicas:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/read-replicas - Create a new read replica
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { orgId, name, host, port, region, maxAcceptableLagMs } = body;

    if (!orgId || !name || !host) {
      return NextResponse.json({ error: 'Organization ID, name, and host required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const hasPermission = await checkPermission(user.id, orgId, 'manage_replicas');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    // Check for duplicate name
    const existing = await prisma.readReplica.findUnique({
      where: { orgId_name: { orgId, name } }
    });

    if (existing) {
      return NextResponse.json({ error: 'Read replica with this name already exists' }, { status: 409 });
    }

    const replica = await prisma.readReplica.create({
      data: {
        orgId,
        name,
        host,
        port: port || 5432,
        region,
        maxAcceptableLagMs: maxAcceptableLagMs || 1000,
        status: ReplicaStatus.SYNCED
      }
    });

    await createAuditLog({
      orgId,
      userId: user.id,
      action: 'read_replica.create',
      resourceType: 'read_replica',
      resourceId: replica.id,
      details: { name, host, region },
      ipAddress: getClientIP(request)
    });

    return NextResponse.json({ replica }, { status: 201 });
  } catch (error) {
    console.error('Error creating read replica:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
