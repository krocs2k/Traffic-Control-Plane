import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';

// POST - Respond to a promotion request (approve/reject)
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
    const { requestId, action, reason } = body; // action: 'approve' or 'reject'

    const config = await prisma.federationConfig.findUnique({
      where: { orgId },
    });

    if (!config || config.role !== 'PRINCIPLE') {
      return NextResponse.json({ error: 'Only Principles can respond to promotion requests' }, { status: 403 });
    }

    const promotionRequest = await prisma.federationPromotionRequest.findFirst({
      where: { id: requestId, orgId, status: 'PENDING' },
    });

    if (!promotionRequest) {
      return NextResponse.json({ error: 'Promotion request not found or already processed' }, { status: 404 });
    }

    if (action === 'approve') {
      // Find the partner
      const partner = await prisma.federationPartner.findFirst({
        where: { orgId, nodeId: promotionRequest.requesterNodeId, isActive: true },
      });

      if (!partner) {
        return NextResponse.json({ error: 'Requester is not an active partner' }, { status: 400 });
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

        // Update promotion request
        await prisma.federationPromotionRequest.update({
          where: { id: requestId },
          data: {
            status: 'APPROVED',
            respondedAt: new Date(),
            promotedAt: new Date(),
          },
        });

        // This node becomes a Partner
        await prisma.federationConfig.update({
          where: { orgId },
          data: {
            role: 'PARTNER',
            principleNodeId: partner.nodeId,
            principleUrl: partner.nodeUrl,
          },
        });

        // Clear partners
        await prisma.federationPartner.deleteMany({
          where: { orgId },
        });

        await createAuditLog({
          orgId,
          userId: session.user.id,
          action: 'federation.promotion.approved',
          resourceType: 'federation_promotion',
          resourceId: requestId,
          details: {
            promotedNodeId: partner.nodeId,
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
        return NextResponse.json({ error: 'Failed to promote: ' + promoteError.message }, { status: 500 });
      }
    } else if (action === 'reject') {
      // Reject the promotion request
      await prisma.federationPromotionRequest.update({
        where: { id: requestId },
        data: {
          status: 'REJECTED',
          respondedAt: new Date(),
          reason,
        },
      });

      // Notify the requester
      try {
        const partner = await prisma.federationPartner.findFirst({
          where: { orgId, nodeId: promotionRequest.requesterNodeId },
        });

        if (partner) {
          await fetch(`${partner.nodeUrl}/api/federation/promote/rejected`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              principleNodeId: config.nodeId,
              reason,
            }),
          });
        }
      } catch (notifyError) {
        console.error('Failed to notify requester of rejection:', notifyError);
      }

      await createAuditLog({
        orgId,
        userId: session.user.id,
        action: 'federation.promotion.rejected',
        resourceType: 'federation_promotion',
        resourceId: requestId,
        details: {
          requesterNodeId: promotionRequest.requesterNodeId,
          reason,
        },
        ipAddress: getClientIP(request),
      });

      return NextResponse.json({ success: true, status: 'rejected' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Error responding to promotion:', error);
    return NextResponse.json({ error: 'Failed to respond to promotion' }, { status: 500 });
  }
}
