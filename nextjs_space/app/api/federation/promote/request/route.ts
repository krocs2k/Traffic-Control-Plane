import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';

// POST - Receive a promotion request from a Partner
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { requesterNodeId, requesterNodeName, requesterNodeUrl, requestId, reason, responseDeadline } = body;

    // Find this node's config (should be Principle)
    const myConfig = await prisma.federationConfig.findFirst({
      where: { role: 'PRINCIPLE' },
    });

    if (!myConfig) {
      return NextResponse.json({ error: 'This node is not a Principle' }, { status: 400 });
    }

    // Create incoming promotion request
    await prisma.federationPromotionRequest.create({
      data: {
        orgId: myConfig.orgId,
        requesterNodeId,
        requesterNodeUrl,
        currentPrincipleId: myConfig.nodeId,
        status: 'PENDING',
        responseDeadline: new Date(responseDeadline),
        reason,
        metadata: {
          requesterNodeName,
          originalRequestId: requestId,
        },
      },
    });

    await createAuditLog({
      orgId: myConfig.orgId,
      action: 'federation.promotion.requested',
      resourceType: 'federation_promotion',
      details: { requesterNodeId, requesterNodeName, reason },
    });

    return NextResponse.json({
      success: true,
      principleNodeId: myConfig.nodeId,
      message: 'Promotion request received',
    });
  } catch (error) {
    console.error('Error receiving promotion request:', error);
    return NextResponse.json({ error: 'Failed to process promotion request' }, { status: 500 });
  }
}
