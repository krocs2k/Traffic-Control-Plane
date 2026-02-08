import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';

// GET - Get sync status and history
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const orgId = session.user.currentOrgId;
    if (!orgId) {
      return NextResponse.json({ error: 'No organization selected' }, { status: 400 });
    }

    const syncLogs = await prisma.federationSyncLog.findMany({
      where: { orgId },
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: { partner: { select: { nodeName: true, nodeUrl: true } } },
    });

    return NextResponse.json({ syncLogs });
  } catch (error) {
    console.error('Error fetching sync logs:', error);
    return NextResponse.json({ error: 'Failed to fetch sync logs' }, { status: 500 });
  }
}

// POST - Trigger a manual sync to all partners (Principle only)
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const orgId = session.user.currentOrgId;
    if (!orgId) {
      return NextResponse.json({ error: 'No organization selected' }, { status: 400 });
    }

    // Check if this node is a Principle
    const config = await prisma.federationConfig.findUnique({
      where: { orgId },
    });

    if (!config || config.role !== 'PRINCIPLE') {
      return NextResponse.json({ error: 'Only Principle nodes can initiate sync' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { partnerId, syncType = 'FULL' } = body;

    // Get partners to sync
    const partners = partnerId
      ? await prisma.federationPartner.findMany({ where: { orgId, id: partnerId, isActive: true } })
      : await prisma.federationPartner.findMany({ where: { orgId, isActive: true } });

    if (partners.length === 0) {
      return NextResponse.json({ error: 'No active partners to sync' }, { status: 400 });
    }

    const results = [];

    for (const partner of partners) {
      const syncLog = await prisma.federationSyncLog.create({
        data: {
          orgId,
          partnerId: partner.id,
          direction: 'OUTGOING',
          syncType,
          status: 'IN_PROGRESS',
        },
      });

      try {
        const syncData = await gatherSyncData(orgId);

        const response = await fetch(`${partner.nodeUrl}/api/federation/sync/receive`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Federation-Secret': partner.secretKey,
          },
          body: JSON.stringify({
            syncType,
            data: syncData,
            sourceNodeId: config.nodeId,
          }),
        });

        if (response.ok) {
          await prisma.federationSyncLog.update({
            where: { id: syncLog.id },
            data: {
              status: 'COMPLETED',
              completedAt: new Date(),
              durationMs: Date.now() - syncLog.startedAt.getTime(),
              entitiesSynced: syncData.counts,
            },
          });

          await prisma.federationPartner.update({
            where: { id: partner.id },
            data: {
              lastSyncAt: new Date(),
              syncStatus: 'COMPLETED',
              failedSyncCount: 0,
            },
          });

          results.push({ partnerId: partner.id, nodeName: partner.nodeName, status: 'success' });
        } else {
          throw new Error(`Sync failed: ${response.statusText}`);
        }
      } catch (syncError: any) {
        await prisma.federationSyncLog.update({
          where: { id: syncLog.id },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
            errorMessage: syncError.message,
          },
        });

        await prisma.federationPartner.update({
          where: { id: partner.id },
          data: {
            syncStatus: 'FAILED',
            failedSyncCount: { increment: 1 },
          },
        });

        results.push({ partnerId: partner.id, nodeName: partner.nodeName, status: 'failed', error: syncError.message });
      }
    }

    await createAuditLog({
      orgId,
      userId: session.user.id,
      action: 'federation.sync.initiated',
      resourceType: 'federation_sync',
      details: { syncType, partnersCount: partners.length, results },
      ipAddress: getClientIP(request),
    });

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error('Error triggering sync:', error);
    return NextResponse.json({ error: 'Failed to trigger sync' }, { status: 500 });
  }
}

async function gatherSyncData(orgId: string) {
  const [org, clusters, backends, policies, replicas, experiments, loadBalancerConfigs, endpoints, circuitBreakers, rateLimits] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId } }),
    prisma.backendCluster.findMany({ where: { orgId } }),
    prisma.backend.findMany({ where: { cluster: { orgId } } }),
    prisma.routingPolicy.findMany({ where: { orgId } }),
    prisma.readReplica.findMany({ where: { orgId } }),
    prisma.experiment.findMany({ where: { orgId }, include: { variants: true } }),
    prisma.loadBalancerConfig.findMany({ where: { orgId } }),
    prisma.trafficEndpoint.findMany({ where: { orgId } }),
    prisma.circuitBreaker.findMany({ where: { orgId } }),
    prisma.rateLimitRule.findMany({ where: { orgId } }),
  ]);

  return {
    organization: org,
    clusters,
    backends,
    policies,
    replicas,
    experiments,
    loadBalancerConfigs,
    endpoints,
    circuitBreakers,
    rateLimits,
    counts: {
      clusters: clusters.length,
      backends: backends.length,
      policies: policies.length,
      replicas: replicas.length,
      experiments: experiments.length,
      endpoints: endpoints.length,
    },
  };
}
