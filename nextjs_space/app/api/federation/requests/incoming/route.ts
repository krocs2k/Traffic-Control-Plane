import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';

// POST - Receive an incoming partnership request from another TCP
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { requesterNodeId, requesterNodeName, requesterNodeUrl, secretKey, message, expiresAt } = body;

    if (!requesterNodeId || !requesterNodeName || !requesterNodeUrl || !secretKey) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Find this node's config - get the first active one
    const myConfig = await prisma.federationConfig.findFirst({
      where: { isActive: true },
    });

    if (!myConfig) {
      return NextResponse.json({ error: 'Federation not configured on this node' }, { status: 400 });
    }

    // Check if we already have a pending request from this node
    const existingRequest = await prisma.federationRequest.findFirst({
      where: {
        orgId: myConfig.orgId,
        requesterNodeId,
        status: 'PENDING',
      },
    });

    if (existingRequest) {
      return NextResponse.json({ 
        nodeId: myConfig.nodeId,
        nodeName: myConfig.nodeName,
        message: 'Request already pending',
      });
    }

    // Create incoming request
    const federationRequest = await prisma.federationRequest.create({
      data: {
        orgId: myConfig.orgId,
        requestType: 'INCOMING',
        requesterNodeId,
        requesterNodeName,
        requesterNodeUrl,
        targetNodeId: myConfig.nodeId,
        targetNodeUrl: myConfig.nodeUrl,
        status: 'PENDING',
        secretKey,
        message,
        expiresAt: new Date(expiresAt),
      },
    });

    await createAuditLog({
      orgId: myConfig.orgId,
      action: 'federation.request.received',
      resourceType: 'federation_request',
      resourceId: federationRequest.id,
      details: { requesterNodeId, requesterNodeName, requesterNodeUrl },
    });

    return NextResponse.json({
      nodeId: myConfig.nodeId,
      nodeName: myConfig.nodeName,
      requestId: federationRequest.id,
    });
  } catch (error) {
    console.error('Error processing incoming request:', error);
    return NextResponse.json({ error: 'Failed to process incoming request' }, { status: 500 });
  }
}
