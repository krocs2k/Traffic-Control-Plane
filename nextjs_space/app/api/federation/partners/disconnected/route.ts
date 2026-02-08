import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';

// POST - Callback when this node is disconnected by the Principle
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { principleNodeId } = body;

    // Find this node's config
    const myConfig = await prisma.federationConfig.findFirst({
      where: {
        role: 'PARTNER',
        principleNodeId,
      },
    });

    if (!myConfig) {
      return NextResponse.json({ error: 'Not a partner of this principle' }, { status: 404 });
    }

    // Revert to standalone
    await prisma.federationConfig.update({
      where: { id: myConfig.id },
      data: {
        role: 'STANDALONE',
        principleNodeId: null,
        principleUrl: null,
      },
    });

    await createAuditLog({
      orgId: myConfig.orgId,
      action: 'federation.role.changed',
      resourceType: 'federation_config',
      details: {
        newRole: 'STANDALONE',
        reason: 'Disconnected by Principle',
        previousPrinciple: principleNodeId,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error processing disconnection:', error);
    return NextResponse.json({ error: 'Failed to process disconnection' }, { status: 500 });
  }
}
