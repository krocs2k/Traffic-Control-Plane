/**
 * Federation Request Actions API
 * 
 * PATCH - Accept or reject a partnership request
 * DELETE - Cancel/withdraw a request
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';
import { refreshPeerList } from '@/lib/federation';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const orgId = membership.orgId;
    const body = await request.json();
    const { action, reason } = body; // action: 'accept' | 'reject'

    if (!action || !['accept', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be "accept" or "reject"' },
        { status: 400 }
      );
    }

    // Get the request
    const federationRequest = await prisma.federationRequest.findFirst({
      where: { id, orgId, status: 'PENDING' },
    });

    if (!federationRequest) {
      return NextResponse.json(
        { error: 'Request not found or already processed' },
        { status: 404 }
      );
    }

    // Check if expired
    if (federationRequest.expiresAt < new Date()) {
      await prisma.federationRequest.update({
        where: { id },
        data: { status: 'EXPIRED' },
      });
      return NextResponse.json(
        { error: 'Request has expired' },
        { status: 410 }
      );
    }

    if (action === 'accept') {
      // Only incoming requests can be accepted
      if (federationRequest.requestType !== 'INCOMING') {
        return NextResponse.json(
          { error: 'Can only accept incoming requests' },
          { status: 400 }
        );
      }

      // Create partner record
      await prisma.federationPartner.create({
        data: {
          orgId,
          nodeId: federationRequest.requesterNodeId,
          nodeName: federationRequest.requesterNodeName,
          nodeUrl: federationRequest.requesterNodeUrl,
          secretKey: federationRequest.secretKey,
          isActive: true,
          syncStatus: 'PENDING',
        },
      });

      // Update request status
      await prisma.federationRequest.update({
        where: { id },
        data: {
          status: 'ACKNOWLEDGED',
          acknowledgedAt: new Date(),
        },
      });

      // Notify the requester (best effort)
      try {
        await fetch(`${federationRequest.requesterNodeUrl}/api/federation/requests/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: federationRequest.id,
            status: 'ACKNOWLEDGED',
            secretKey: federationRequest.secretKey,
          }),
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        // Non-critical failure
        console.warn('Failed to notify requester of acceptance');
      }

      await createAuditLog({
        orgId,
        userId: user.id,
        action: 'federation.request.accepted',
        resourceType: 'federation_request',
        resourceId: id,
        details: {
          partnerNodeId: federationRequest.requesterNodeId,
          partnerNodeName: federationRequest.requesterNodeName,
        },
      });

      // Refresh peer list
      await refreshPeerList(orgId);

      return NextResponse.json({
        success: true,
        message: 'Partnership request accepted',
        partner: {
          nodeId: federationRequest.requesterNodeId,
          nodeName: federationRequest.requesterNodeName,
          nodeUrl: federationRequest.requesterNodeUrl,
        },
      });
    } else {
      // Reject
      await prisma.federationRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          rejectedAt: new Date(),
          rejectionReason: reason || 'Rejected by administrator',
        },
      });

      // Notify the requester (best effort)
      if (federationRequest.requestType === 'INCOMING') {
        try {
          await fetch(`${federationRequest.requesterNodeUrl}/api/federation/requests/callback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requestId: federationRequest.id,
              status: 'REJECTED',
              reason: reason || 'Rejected by administrator',
            }),
            signal: AbortSignal.timeout(5000),
          });
        } catch {
          console.warn('Failed to notify requester of rejection');
        }
      }

      await createAuditLog({
        orgId,
        userId: user.id,
        action: 'federation.request.rejected',
        resourceType: 'federation_request',
        resourceId: id,
        details: {
          requesterNodeId: federationRequest.requesterNodeId,
          reason,
        },
      });

      return NextResponse.json({
        success: true,
        message: 'Partnership request rejected',
      });
    }
  } catch (error) {
    console.error('Error processing request:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const orgId = user.memberships[0].orgId;

    // Cancel/delete the request
    const deleted = await prisma.federationRequest.updateMany({
      where: { id, orgId, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });

    if (deleted.count === 0) {
      return NextResponse.json(
        { error: 'Request not found or already processed' },
        { status: 404 }
      );
    }

    await createAuditLog({
      orgId,
      userId: user.id,
      action: 'federation.request.cancelled',
      resourceType: 'federation_request',
      resourceId: id,
    });

    return NextResponse.json({
      success: true,
      message: 'Request cancelled',
    });
  } catch (error) {
    console.error('Error cancelling request:', error);
    return NextResponse.json(
      { error: 'Failed to cancel request' },
      { status: 500 }
    );
  }
}
