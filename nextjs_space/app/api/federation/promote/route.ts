import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';

// POST - Request promotion or promote a partner
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

    const body = await request.json();
    const { action, partnerId, reason } = body;

    const config = await prisma.federationConfig.findUnique({
      where: { orgId },
    });

    if (!config) {
      return NextResponse.json({ error: 'Federation not configured' }, { status: 400 });
    }

    if (action === 'request') {
      // Partner requesting to become Principle
      if (config.role !== 'PARTNER') {
        return NextResponse.json({ error: 'Only Partners can request promotion' }, { status: 400 });
      }

      const responseDeadline = new Date(Date.now() + 30000); // 30 seconds

      // Create promotion request
      const promotionRequest = await prisma.federationPromotionRequest.create({
        data: {
          orgId,
          requesterNodeId: config.nodeId,
          requesterNodeUrl: config.nodeUrl,
          currentPrincipleId: config.principleNodeId,
          status: 'PENDING',
          responseDeadline,
          reason,
        },
      });

      // Send request to Principle
      try {
        const response = await fetch(`${config.principleUrl}/api/federation/promote/request`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requesterNodeId: config.nodeId,
            requesterNodeName: config.nodeName,
            requesterNodeUrl: config.nodeUrl,
            requestId: promotionRequest.id,
            reason,
            responseDeadline: responseDeadline.toISOString(),
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to reach Principle');
        }

        await createAuditLog({
          orgId,
          userId: session.user.id,
          action: 'federation.promotion.requested',
          resourceType: 'federation_promotion',
          resourceId: promotionRequest.id,
          details: { principleNodeId: config.principleNodeId, reason },
          ipAddress: getClientIP(request),
        });

        // Start timeout checker
        setTimeout(async () => {
          await checkPromotionTimeout(promotionRequest.id, orgId, config);
        }, 31000); // Check after 31 seconds

        return NextResponse.json({
          success: true,
          promotionRequestId: promotionRequest.id,
          responseDeadline: responseDeadline.toISOString(),
        });
      } catch (fetchError) {
        // Principle unreachable - auto-promote
        await autoPromote(promotionRequest.id, orgId, config);

        return NextResponse.json({
          success: true,
          autoPromoted: true,
          reason: 'Principle unreachable',
        });
      }
    } else if (action === 'promote') {
      // Principle promoting a Partner
      if (config.role !== 'PRINCIPLE') {
        return NextResponse.json({ error: 'Only Principles can promote Partners' }, { status: 400 });
      }

      if (!partnerId) {
        return NextResponse.json({ error: 'Partner ID required' }, { status: 400 });
      }

      const partner = await prisma.federationPartner.findFirst({
        where: { id: partnerId, orgId, isActive: true },
      });

      if (!partner) {
        return NextResponse.json({ error: 'Partner not found' }, { status: 404 });
      }

      // Get all other partners to transfer
      const allPartners = await prisma.federationPartner.findMany({
        where: { orgId, isActive: true },
      });

      // Notify the Partner to become Principle
      try {
        const response = await fetch(`${partner.nodeUrl}/api/federation/promote/become-principle`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Federation-Secret': partner.secretKey,
          },
          body: JSON.stringify({
            previousPrincipleId: config.nodeId,
            previousPrincipleUrl: config.nodeUrl,
            partners: allPartners
              .filter((p) => p.nodeId !== partner.nodeId)
              .map((p) => ({
                nodeId: p.nodeId,
                nodeName: p.nodeName,
                nodeUrl: p.nodeUrl,
                secretKey: p.secretKey,
              })),
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to promote partner');
        }

        // This node becomes a Partner
        await prisma.federationConfig.update({
          where: { orgId },
          data: {
            role: 'PARTNER',
            principleNodeId: partner.nodeId,
            principleUrl: partner.nodeUrl,
          },
        });

        // Clear partners (they now belong to the new Principle)
        await prisma.federationPartner.deleteMany({
          where: { orgId },
        });

        await createAuditLog({
          orgId,
          userId: session.user.id,
          action: 'federation.promotion.approved',
          resourceType: 'federation_promotion',
          details: {
            promotedNodeId: partner.nodeId,
            promotedNodeName: partner.nodeName,
            newRole: 'PARTNER',
          },
          ipAddress: getClientIP(request),
        });

        return NextResponse.json({
          success: true,
          newPrinciple: partner.nodeName,
          thisNodeRole: 'PARTNER',
        });
      } catch (promoteError: any) {
        return NextResponse.json({ error: 'Failed to promote partner: ' + promoteError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Error processing promotion:', error);
    return NextResponse.json({ error: 'Failed to process promotion' }, { status: 500 });
  }
}

async function checkPromotionTimeout(requestId: string, orgId: string, config: any) {
  const promotionRequest = await prisma.federationPromotionRequest.findFirst({
    where: { id: requestId, status: 'PENDING' },
  });

  if (promotionRequest && new Date() > promotionRequest.responseDeadline) {
    await autoPromote(requestId, orgId, config);
  }
}

async function autoPromote(requestId: string, orgId: string, config: any) {
  // Update promotion request
  await prisma.federationPromotionRequest.update({
    where: { id: requestId },
    data: {
      status: 'AUTO_PROMOTED',
      promotedAt: new Date(),
    },
  });

  // This node becomes Principle
  await prisma.federationConfig.update({
    where: { orgId },
    data: {
      role: 'PRINCIPLE',
      principleNodeId: null,
      principleUrl: null,
    },
  });

  await createAuditLog({
    orgId,
    action: 'federation.promotion.auto',
    resourceType: 'federation_promotion',
    resourceId: requestId,
    details: {
      reason: 'Principle did not respond within 30 seconds',
      previousPrinciple: config.principleNodeId,
    },
  });
}
