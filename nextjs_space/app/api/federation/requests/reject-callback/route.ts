import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';

// POST - Callback when a partnership request is rejected by Principle
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { principleNodeId, reason } = body;

    if (!principleNodeId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Find the outgoing request that matches this callback
    const federationRequest = await prisma.federationRequest.findFirst({
      where: {
        requestType: 'OUTGOING',
        status: 'PENDING',
        targetNodeId: principleNodeId,
      },
    });

    if (!federationRequest) {
      // Try to find by URL
      const requestByUrl = await prisma.federationRequest.findFirst({
        where: {
          requestType: 'OUTGOING',
          status: 'PENDING',
        },
      });

      if (requestByUrl) {
        await prisma.federationRequest.update({
          where: { id: requestByUrl.id },
          data: {
            status: 'REJECTED',
            rejectedAt: new Date(),
            rejectionReason: reason,
          },
        });
      }

      return NextResponse.json({ success: true });
    }

    // Update the request
    await prisma.federationRequest.update({
      where: { id: federationRequest.id },
      data: {
        status: 'REJECTED',
        rejectedAt: new Date(),
        rejectionReason: reason,
      },
    });

    await createAuditLog({
      orgId: federationRequest.orgId,
      action: 'federation.request.rejected',
      resourceType: 'federation_request',
      resourceId: federationRequest.id,
      details: { principleNodeId, reason },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error processing reject callback:', error);
    return NextResponse.json({ error: 'Failed to process callback' }, { status: 500 });
  }
}
