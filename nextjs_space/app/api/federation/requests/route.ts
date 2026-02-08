import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';
import crypto from 'crypto';

// GET - List all federation requests (incoming and outgoing)
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

    const requests = await prisma.federationRequest.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ requests });
  } catch (error) {
    console.error('Error fetching federation requests:', error);
    return NextResponse.json({ error: 'Failed to fetch requests' }, { status: 500 });
  }
}

// POST - Send a partnership request to another TCP (become a Partner)
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
    const { targetNodeUrl, message } = body;

    if (!targetNodeUrl) {
      return NextResponse.json({ error: 'Target node URL is required' }, { status: 400 });
    }

    // Get this node's config
    const myConfig = await prisma.federationConfig.findUnique({
      where: { orgId },
    });

    if (!myConfig) {
      return NextResponse.json({ error: 'Federation not configured for this node' }, { status: 400 });
    }

    if (myConfig.role === 'PARTNER') {
      return NextResponse.json({ error: 'This node is already a Partner' }, { status: 400 });
    }

    // Generate a shared secret for this partnership
    const secretKey = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Create outgoing request
    const federationRequest = await prisma.federationRequest.create({
      data: {
        orgId,
        requestType: 'OUTGOING',
        requesterNodeId: myConfig.nodeId,
        requesterNodeName: myConfig.nodeName,
        requesterNodeUrl: myConfig.nodeUrl,
        targetNodeUrl,
        status: 'PENDING',
        secretKey,
        message,
        expiresAt,
      },
    });

    // Send request to target node
    try {
      const response = await fetch(`${targetNodeUrl}/api/federation/requests/incoming`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requesterNodeId: myConfig.nodeId,
          requesterNodeName: myConfig.nodeName,
          requesterNodeUrl: myConfig.nodeUrl,
          secretKey,
          message,
          expiresAt: expiresAt.toISOString(),
        }),
      });

      if (!response.ok) {
        // Update request as failed
        await prisma.federationRequest.update({
          where: { id: federationRequest.id },
          data: {
            status: 'EXPIRED',
            metadata: { error: 'Failed to reach target node' },
          },
        });
        return NextResponse.json({ error: 'Failed to reach target node' }, { status: 502 });
      }

      const targetResponse = await response.json();
      
      // Update request with target node info
      await prisma.federationRequest.update({
        where: { id: federationRequest.id },
        data: {
          targetNodeId: targetResponse.nodeId,
          metadata: { targetNodeName: targetResponse.nodeName },
        },
      });
    } catch (fetchError) {
      // Network error - update request but keep it pending
      await prisma.federationRequest.update({
        where: { id: federationRequest.id },
        data: {
          metadata: { error: 'Network error: unable to reach target node' },
        },
      });
    }

    await createAuditLog({
      orgId,
      userId: session.user.id,
      action: 'federation.request.sent',
      resourceType: 'federation_request',
      resourceId: federationRequest.id,
      details: { targetNodeUrl, message },
      ipAddress: getClientIP(request),
    });

    return NextResponse.json({ request: federationRequest });
  } catch (error) {
    console.error('Error sending partnership request:', error);
    return NextResponse.json({ error: 'Failed to send partnership request' }, { status: 500 });
  }
}
