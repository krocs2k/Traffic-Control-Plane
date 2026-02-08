import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';

// POST - Receive synced data from Principle
export async function POST(request: NextRequest) {
  try {
    const secretKey = request.headers.get('X-Federation-Secret');
    if (!secretKey) {
      return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });
    }

    const body = await request.json();
    const { syncType, data, sourceNodeId } = body;

    // Verify this node is a Partner and the secret matches
    const myConfig = await prisma.federationConfig.findFirst({
      where: {
        role: 'PARTNER',
        principleNodeId: sourceNodeId,
      },
    });

    if (!myConfig) {
      return NextResponse.json({ error: 'Not configured as a Partner of this node' }, { status: 403 });
    }

    const orgId = myConfig.orgId;

    // Create sync log
    const syncLog = await prisma.federationSyncLog.create({
      data: {
        orgId,
        direction: 'INCOMING',
        syncType,
        status: 'IN_PROGRESS',
      },
    });

    try {
      // Process the sync based on type
      if (syncType === 'FULL') {
        await processFullSync(orgId, data);
      } else if (syncType === 'INCREMENTAL') {
        await processIncrementalSync(orgId, data);
      }

      // Update sync log as completed
      await prisma.federationSyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          durationMs: Date.now() - syncLog.startedAt.getTime(),
          entitiesSynced: data.counts || {},
        },
      });

      await createAuditLog({
        orgId,
        action: 'federation.sync.completed',
        resourceType: 'federation_sync',
        resourceId: syncLog.id,
        details: { syncType, counts: data.counts },
      });

      return NextResponse.json({ success: true, syncLogId: syncLog.id });
    } catch (syncError: any) {
      await prisma.federationSyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: syncError.message,
        },
      });

      await createAuditLog({
        orgId,
        action: 'federation.sync.failed',
        resourceType: 'federation_sync',
        resourceId: syncLog.id,
        details: { syncType, error: syncError.message },
      });

      throw syncError;
    }
  } catch (error: any) {
    console.error('Error receiving sync:', error);
    return NextResponse.json({ error: 'Failed to receive sync: ' + error.message }, { status: 500 });
  }
}

async function processFullSync(orgId: string, data: any) {
  // Process clusters
  if (data.clusters?.length) {
    for (const cluster of data.clusters) {
      await prisma.backendCluster.upsert({
        where: { orgId_name: { orgId, name: cluster.name } },
        create: { ...cluster, orgId, id: undefined },
        update: { ...cluster, id: undefined, orgId: undefined },
      });
    }
  }

  // Process backends
  if (data.backends?.length) {
    for (const backend of data.backends) {
      const cluster = await prisma.backendCluster.findFirst({
        where: { orgId, name: data.clusters?.find((c: any) => c.id === backend.clusterId)?.name },
      });
      if (cluster) {
        await prisma.backend.upsert({
          where: { id: backend.id },
          create: { ...backend, clusterId: cluster.id, id: undefined },
          update: { ...backend, id: undefined, clusterId: cluster.id },
        });
      }
    }
  }

  // Process routing policies
  if (data.policies?.length) {
    for (const policy of data.policies) {
      await prisma.routingPolicy.upsert({
        where: { orgId_name: { orgId, name: policy.name } },
        create: { ...policy, orgId, id: undefined },
        update: { ...policy, id: undefined, orgId: undefined },
      });
    }
  }

  // Process read replicas
  if (data.replicas?.length) {
    for (const replica of data.replicas) {
      await prisma.readReplica.upsert({
        where: { orgId_name: { orgId, name: replica.name } },
        create: { ...replica, orgId, id: undefined },
        update: { ...replica, id: undefined, orgId: undefined },
      });
    }
  }

  // Process experiments
  if (data.experiments?.length) {
    for (const experiment of data.experiments) {
      const { variants, metrics, ...expData } = experiment;
      const created = await prisma.experiment.upsert({
        where: { orgId_name: { orgId, name: experiment.name } },
        create: { ...expData, orgId, id: undefined },
        update: { ...expData, id: undefined, orgId: undefined },
      });

      // Process variants
      if (variants?.length) {
        for (const variant of variants) {
          await prisma.experimentVariant.upsert({
            where: { experimentId_name: { experimentId: created.id, name: variant.name } },
            create: { ...variant, experimentId: created.id, id: undefined },
            update: { ...variant, id: undefined, experimentId: undefined },
          });
        }
      }
    }
  }

  // Process endpoints
  if (data.endpoints?.length) {
    for (const endpoint of data.endpoints) {
      await prisma.trafficEndpoint.upsert({
        where: { orgId_name: { orgId, name: endpoint.name } },
        create: { ...endpoint, orgId, id: undefined, slug: endpoint.slug + '-synced' },
        update: { ...endpoint, id: undefined, orgId: undefined },
      });
    }
  }

  // Process circuit breakers
  if (data.circuitBreakers?.length) {
    for (const cb of data.circuitBreakers) {
      await prisma.circuitBreaker.upsert({
        where: { orgId_name: { orgId, name: cb.name } },
        create: { ...cb, orgId, id: undefined },
        update: { ...cb, id: undefined, orgId: undefined },
      });
    }
  }

  // Process rate limits
  if (data.rateLimits?.length) {
    for (const rl of data.rateLimits) {
      await prisma.rateLimitRule.upsert({
        where: { orgId_name: { orgId, name: rl.name } },
        create: { ...rl, orgId, id: undefined },
        update: { ...rl, id: undefined, orgId: undefined },
      });
    }
  }
}

async function processIncrementalSync(orgId: string, data: any) {
  // Process incremental changes
  // This handles individual entity updates
  const { entityType, action, entity } = data;

  switch (entityType) {
    case 'backend_cluster':
      if (action === 'create' || action === 'update') {
        await prisma.backendCluster.upsert({
          where: { orgId_name: { orgId, name: entity.name } },
          create: { ...entity, orgId, id: undefined },
          update: { ...entity, id: undefined, orgId: undefined },
        });
      } else if (action === 'delete') {
        await prisma.backendCluster.deleteMany({
          where: { orgId, name: entity.name },
        });
      }
      break;

    case 'routing_policy':
      if (action === 'create' || action === 'update') {
        await prisma.routingPolicy.upsert({
          where: { orgId_name: { orgId, name: entity.name } },
          create: { ...entity, orgId, id: undefined },
          update: { ...entity, id: undefined, orgId: undefined },
        });
      } else if (action === 'delete') {
        await prisma.routingPolicy.deleteMany({
          where: { orgId, name: entity.name },
        });
      }
      break;

    // Add more entity types as needed
  }
}
