/**
 * Federation Peers API
 * 
 * GET  - List all federation peers
 * POST - Add a new peer (send partnership request)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';
import { refreshPeerList, getAllPeers } from '@/lib/federation';
import crypto from 'crypto';

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

    // Refresh peer list
    await refreshPeerList(orgId);
    const peers = getAllPeers();

    // Get partners from database
    const partners = await prisma.federationPartner.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });

    // Get pending requests
    const pendingRequests = await prisma.federationRequest.findMany({
      where: { orgId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      peers,
      partners: partners.map(p => ({
        id: p.id,
        nodeId: p.nodeId,
        nodeName: p.nodeName,
        nodeUrl: p.nodeUrl,
        isActive: p.isActive,
        status: p.syncStatus,
        lastHeartbeat: p.lastHeartbeat,
        lastSyncAt: p.lastSyncAt,
        failedSyncCount: p.failedSyncCount,
      })),
      pendingRequests: pendingRequests.map(r => ({
        id: r.id,
        type: r.requestType,
        requesterNodeId: r.requesterNodeId,
        requesterNodeName: r.requesterNodeName,
        requesterNodeUrl: r.requesterNodeUrl,
        status: r.status,
        message: r.message,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
      })),
    });
  } catch (error) {
    console.error('Error fetching peers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch peers' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
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

    const membership = user.memberships[0];
    if (!['OWNER', 'ADMIN'].includes(membership.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const orgId = membership.orgId;
    const body = await request.json();
    const { targetNodeUrl, message } = body;

    if (!targetNodeUrl) {
      return NextResponse.json(
        { error: 'targetNodeUrl is required' },
        { status: 400 }
      );
    }

    // Get our config
    const config = await prisma.federationConfig.findUnique({
      where: { orgId },
    });

    if (!config) {
      return NextResponse.json(
        { error: 'Federation not configured. Please configure this node first.' },
        { status: 400 }
      );
    }

    // Generate a shared secret for this partnership
    const sharedSecret = crypto.randomBytes(32).toString('hex');

    // Create outgoing request record
    const federationRequest = await prisma.federationRequest.create({
      data: {
        orgId,
        requestType: 'OUTGOING',
        requesterNodeId: config.nodeId,
        requesterNodeName: config.nodeName,
        requesterNodeUrl: config.nodeUrl,
        targetNodeUrl,
        status: 'PENDING',
        secretKey: sharedSecret,
        message: message || `Partnership request from ${config.nodeName}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      },
    });

    // Try to send request to target node
    try {
      const response = await fetch(`${targetNodeUrl}/api/federation/requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requesterNodeId: config.nodeId,
          requesterNodeName: config.nodeName,
          requesterNodeUrl: config.nodeUrl,
          secretKey: sharedSecret,
          message: message || `Partnership request from ${config.nodeName}`,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to send partnership request');
      }

      await createAuditLog({
        orgId,
        userId: user.id,
        action: 'federation.request.sent',
        resourceType: 'federation_request',
        resourceId: federationRequest.id,
        details: { targetNodeUrl },
      });

      return NextResponse.json({
        success: true,
        message: 'Partnership request sent successfully',
        requestId: federationRequest.id,
      });
    } catch (fetchError) {
      // Update request status to indicate delivery failure
      await prisma.federationRequest.update({
        where: { id: federationRequest.id },
        data: {
          metadata: {
            deliveryError: fetchError instanceof Error ? fetchError.message : 'Unknown error',
          },
        },
      });

      return NextResponse.json({
        success: false,
        message: 'Request created but failed to deliver to target node',
        requestId: federationRequest.id,
        error: fetchError instanceof Error ? fetchError.message : 'Connection failed',
      }, { status: 202 });
    }
  } catch (error) {
    console.error('Error creating partnership request:', error);
    return NextResponse.json(
      { error: 'Failed to create partnership request' },
      { status: 500 }
    );
  }
}
