import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';

// GET - List all federation partners
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

    const partners = await prisma.federationPartner.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      include: {
        syncLogs: {
          orderBy: { startedAt: 'desc' },
          take: 5,
        },
      },
    });

    return NextResponse.json({ partners });
  } catch (error) {
    console.error('Error fetching partners:', error);
    return NextResponse.json({ error: 'Failed to fetch partners' }, { status: 500 });
  }
}

// DELETE - Remove a partner
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const orgId = session.user.currentOrgId;
    if (!orgId) {
      return NextResponse.json({ error: 'No organization selected' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const partnerId = searchParams.get('id');

    if (!partnerId) {
      return NextResponse.json({ error: 'Partner ID required' }, { status: 400 });
    }

    const partner = await prisma.federationPartner.findFirst({
      where: { id: partnerId, orgId },
    });

    if (!partner) {
      return NextResponse.json({ error: 'Partner not found' }, { status: 404 });
    }

    // Remove the partner
    await prisma.federationPartner.delete({
      where: { id: partnerId },
    });

    // Notify the partner node that they've been removed
    try {
      await fetch(`${partner.nodeUrl}/api/federation/partners/disconnected`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ principleNodeId: (await prisma.federationConfig.findUnique({ where: { orgId } }))?.nodeId }),
      });
    } catch (notifyError) {
      console.error('Failed to notify partner of disconnection:', notifyError);
    }

    await createAuditLog({
      orgId,
      userId: session.user.id,
      action: 'federation.partner.removed',
      resourceType: 'federation_partner',
      resourceId: partnerId,
      details: { nodeName: partner.nodeName, nodeId: partner.nodeId },
      ipAddress: getClientIP(request),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing partner:', error);
    return NextResponse.json({ error: 'Failed to remove partner' }, { status: 500 });
  }
}
