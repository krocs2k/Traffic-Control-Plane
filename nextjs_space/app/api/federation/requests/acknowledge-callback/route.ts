import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';

// POST - Callback when a partnership request is acknowledged by Principle
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { principleNodeId, principleNodeName, principleNodeUrl, secretKey } = body;

    if (!principleNodeId || !principleNodeUrl || !secretKey) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Find the outgoing request that matches this callback
    const federationRequest = await prisma.federationRequest.findFirst({
      where: {
        requestType: 'OUTGOING',
        status: 'PENDING',
        secretKey,
      },
    });

    if (!federationRequest) {
      return NextResponse.json({ error: 'No matching request found' }, { status: 404 });
    }

    // Update the request
    await prisma.federationRequest.update({
      where: { id: federationRequest.id },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: new Date(),
        targetNodeId: principleNodeId,
        metadata: { principleNodeName },
      },
    });

    // Update this node's config to be a Partner
    await prisma.federationConfig.update({
      where: { orgId: federationRequest.orgId },
      data: {
        role: 'PARTNER',
        principleNodeId,
        principleUrl: principleNodeUrl,
      },
    });

    await createAuditLog({
      orgId: federationRequest.orgId,
      action: 'federation.role.changed',
      resourceType: 'federation_config',
      details: {
        newRole: 'PARTNER',
        principleNodeId,
        principleNodeName,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error processing acknowledge callback:', error);
    return NextResponse.json({ error: 'Failed to process callback' }, { status: 500 });
  }
}
