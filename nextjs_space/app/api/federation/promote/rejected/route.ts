import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';

// POST - Receive notification that promotion request was rejected
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { principleNodeId, reason } = body;

    // Find pending promotion request
    const promotionRequest = await prisma.federationPromotionRequest.findFirst({
      where: {
        currentPrincipleId: principleNodeId,
        status: 'PENDING',
      },
    });

    if (!promotionRequest) {
      return NextResponse.json({ error: 'No pending promotion request found' }, { status: 404 });
    }

    // Update promotion request
    await prisma.federationPromotionRequest.update({
      where: { id: promotionRequest.id },
      data: {
        status: 'REJECTED',
        respondedAt: new Date(),
        reason,
      },
    });

    await createAuditLog({
      orgId: promotionRequest.orgId,
      action: 'federation.promotion.rejected',
      resourceType: 'federation_promotion',
      resourceId: promotionRequest.id,
      details: { principleNodeId, reason },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error processing rejection:', error);
    return NextResponse.json({ error: 'Failed to process rejection' }, { status: 500 });
  }
}
