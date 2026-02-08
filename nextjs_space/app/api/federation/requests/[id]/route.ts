import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';

// PATCH - Acknowledge or reject a partnership request
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const orgId = session.user.currentOrgId;
    if (!orgId) {
      return NextResponse.json({ error: 'No organization selected' }, { status: 400 });
    }

    const { id } = await params;
    const body = await request.json();
    const { action, rejectionReason } = body; // action: 'acknowledge' or 'reject'

    // Get the request
    const federationRequest = await prisma.federationRequest.findFirst({
      where: { id, orgId },
    });

    if (!federationRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    if (federationRequest.status !== 'PENDING') {
      return NextResponse.json({ error: 'Request is no longer pending' }, { status: 400 });
    }

    // Get this node's config
    const myConfig = await prisma.federationConfig.findUnique({
      where: { orgId },
    });

    if (!myConfig) {
      return NextResponse.json({ error: 'Federation not configured' }, { status: 400 });
    }

    if (action === 'acknowledge') {
      // This node becomes/remains Principle
      // Update request
      await prisma.federationRequest.update({
        where: { id },
        data: {
          status: 'ACKNOWLEDGED',
          acknowledgedAt: new Date(),
        },
      });

      // Add the requester as a Partner
      await prisma.federationPartner.upsert({
        where: {
          orgId_nodeId: {
            orgId,
            nodeId: federationRequest.requesterNodeId,
          },
        },
        create: {
          orgId,
          nodeId: federationRequest.requesterNodeId,
          nodeName: federationRequest.requesterNodeName,
          nodeUrl: federationRequest.requesterNodeUrl,
          secretKey: federationRequest.secretKey,
          isActive: true,
        },
        update: {
          nodeName: federationRequest.requesterNodeName,
          nodeUrl: federationRequest.requesterNodeUrl,
          secretKey: federationRequest.secretKey,
          isActive: true,
          updatedAt: new Date(),
        },
      });

      // Update this node's role to PRINCIPLE if not already
      if (myConfig.role !== 'PRINCIPLE') {
        await prisma.federationConfig.update({
          where: { orgId },
          data: { role: 'PRINCIPLE' },
        });
      }

      // Notify the requester that they've been acknowledged
      try {
        await fetch(`${federationRequest.requesterNodeUrl}/api/federation/requests/acknowledge-callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            principleNodeId: myConfig.nodeId,
            principleNodeName: myConfig.nodeName,
            principleNodeUrl: myConfig.nodeUrl,
            secretKey: federationRequest.secretKey,
          }),
        });
      } catch (callbackError) {
        console.error('Failed to notify requester:', callbackError);
      }

      await createAuditLog({
        orgId,
        userId: session.user.id,
        action: 'federation.request.acknowledged',
        resourceType: 'federation_request',
        resourceId: id,
        details: { 
          requesterNodeId: federationRequest.requesterNodeId,
          requesterNodeName: federationRequest.requesterNodeName,
        },
        ipAddress: getClientIP(request),
      });

      // Trigger initial sync
      await triggerFullSync(orgId, federationRequest.requesterNodeId);

      return NextResponse.json({ success: true, status: 'acknowledged' });
    } else if (action === 'reject') {
      // Reject the request
      await prisma.federationRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          rejectedAt: new Date(),
          rejectionReason,
        },
      });

      // Notify the requester
      try {
        await fetch(`${federationRequest.requesterNodeUrl}/api/federation/requests/reject-callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            principleNodeId: myConfig.nodeId,
            reason: rejectionReason,
          }),
        });
      } catch (callbackError) {
        console.error('Failed to notify requester of rejection:', callbackError);
      }

      await createAuditLog({
        orgId,
        userId: session.user.id,
        action: 'federation.request.rejected',
        resourceType: 'federation_request',
        resourceId: id,
        details: { 
          requesterNodeId: federationRequest.requesterNodeId,
          rejectionReason,
        },
        ipAddress: getClientIP(request),
      });

      return NextResponse.json({ success: true, status: 'rejected' });
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Error processing request action:', error);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}

// Helper function to trigger full sync to a partner
async function triggerFullSync(orgId: string, partnerNodeId: string) {
  try {
    const partner = await prisma.federationPartner.findFirst({
      where: { orgId, nodeId: partnerNodeId, isActive: true },
    });

    if (!partner) return;

    // Create sync log
    const syncLog = await prisma.federationSyncLog.create({
      data: {
        orgId,
        partnerId: partner.id,
        direction: 'OUTGOING',
        syncType: 'FULL',
        status: 'IN_PROGRESS',
      },
    });

    // Gather all data to sync
    const syncData = await gatherSyncData(orgId);

    // Send to partner
    try {
      const response = await fetch(`${partner.nodeUrl}/api/federation/sync/receive`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Federation-Secret': partner.secretKey,
        },
        body: JSON.stringify({
          syncType: 'FULL',
          data: syncData,
          sourceNodeId: (await prisma.federationConfig.findUnique({ where: { orgId } }))?.nodeId,
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
    }
  } catch (error) {
    console.error('Error triggering sync:', error);
  }
}

// Helper function to gather all data for sync
async function gatherSyncData(orgId: string) {
  const [org, members, clusters, backends, policies, replicas, experiments, loadBalancerConfigs, endpoints, circuitBreakers, rateLimits, auditLogs] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId } }),
    prisma.organizationMember.findMany({ where: { orgId }, include: { user: { select: { id: true, email: true, name: true, status: true } } } }),
    prisma.backendCluster.findMany({ where: { orgId } }),
    prisma.backend.findMany({ where: { cluster: { orgId } } }),
    prisma.routingPolicy.findMany({ where: { orgId } }),
    prisma.readReplica.findMany({ where: { orgId } }),
    prisma.experiment.findMany({ where: { orgId }, include: { variants: true } }),
    prisma.loadBalancerConfig.findMany({ where: { orgId } }),
    prisma.trafficEndpoint.findMany({ where: { orgId } }),
    prisma.circuitBreaker.findMany({ where: { orgId } }),
    prisma.rateLimitRule.findMany({ where: { orgId } }),
    prisma.auditLog.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' }, take: 1000 }),
  ]);

  return {
    organization: org,
    members,
    clusters,
    backends,
    policies,
    replicas,
    experiments,
    loadBalancerConfigs,
    endpoints,
    circuitBreakers,
    rateLimits,
    auditLogs,
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
