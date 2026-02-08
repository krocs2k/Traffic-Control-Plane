/**
 * Federation Partnership Requests API
 * 
 * GET  - List incoming partnership requests
 * POST - Receive a partnership request from another node
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { memberships: true },
    });

    if (!user || user.memberships.length === 0) {
      return NextResponse.json({ error: 'No organization found' }, { status: 404 });
    }

    const orgId = user.memberships[0].orgId;

    // Get all requests (both incoming and outgoing)
    const requests = await prisma.federationRequest.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json({
      requests: requests.map(r => ({
        id: r.id,
        type: r.requestType,
        requesterNodeId: r.requesterNodeId,
        requesterNodeName: r.requesterNodeName,
        requesterNodeUrl: r.requesterNodeUrl,
        targetNodeUrl: r.targetNodeUrl,
        status: r.status,
        message: r.message,
        rejectionReason: r.rejectionReason,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
        acknowledgedAt: r.acknowledgedAt,
        rejectedAt: r.rejectedAt,
      })),
    });
  } catch (error) {
    console.error('Error fetching requests:', error);
    return NextResponse.json(
      { error: 'Failed to fetch requests' },
      { status: 500 }
    );
  }
}

// Receive incoming partnership request (from another TCP node)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      requesterNodeId,
      requesterNodeName,
      requesterNodeUrl,
      secretKey,
      message,
    } = body;

    if (!requesterNodeId || !requesterNodeName || !requesterNodeUrl || !secretKey) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Find a config to attach this request to
    // In a real scenario, you'd determine which org based on target URL or other factors
    const configs = await prisma.federationConfig.findMany({
      where: { isActive: true },
      take: 1,
    });

    if (configs.length === 0) {
      return NextResponse.json(
        { error: 'No federation configuration found on this node' },
        { status: 404 }
      );
    }

    const config = configs[0];

    // Check if we already have a request from this node
    const existingRequest = await prisma.federationRequest.findFirst({
      where: {
        orgId: config.orgId,
        requesterNodeId,
        status: 'PENDING',
      },
    });

    if (existingRequest) {
      return NextResponse.json(
        { error: 'A pending request from this node already exists' },
        { status: 409 }
      );
    }

    // Check if already a partner
    const existingPartner = await prisma.federationPartner.findFirst({
      where: {
        orgId: config.orgId,
        nodeId: requesterNodeId,
      },
    });

    if (existingPartner) {
      return NextResponse.json(
        { error: 'This node is already a partner' },
        { status: 409 }
      );
    }

    // Create incoming request
    const federationRequest = await prisma.federationRequest.create({
      data: {
        orgId: config.orgId,
        requestType: 'INCOMING',
        requesterNodeId,
        requesterNodeName,
        requesterNodeUrl,
        targetNodeId: config.nodeId,
        targetNodeUrl: config.nodeUrl,
        status: 'PENDING',
        secretKey,
        message: message || `Partnership request from ${requesterNodeName}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      },
    });

    await createAuditLog({
      orgId: config.orgId,
      action: 'federation.request.received',
      resourceType: 'federation_request',
      resourceId: federationRequest.id,
      details: { requesterNodeId, requesterNodeName, requesterNodeUrl },
    });

    return NextResponse.json({
      success: true,
      message: 'Partnership request received',
      requestId: federationRequest.id,
    });
  } catch (error) {
    console.error('Error receiving partnership request:', error);
    return NextResponse.json(
      { error: 'Failed to process partnership request' },
      { status: 500 }
    );
  }
}
