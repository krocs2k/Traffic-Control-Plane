import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';

// POST - Receive notification that there's a new Principle
export async function POST(request: NextRequest) {
  try {
    const secretKey = request.headers.get('X-Federation-Secret');
    const body = await request.json();
    const { newPrincipleId, newPrincipleName, newPrincipleUrl } = body;

    // Find this node's config
    const myConfig = await prisma.federationConfig.findFirst({
      where: { role: 'PARTNER' },
    });

    if (!myConfig) {
      return NextResponse.json({ error: 'Not a partner' }, { status: 403 });
    }

    // Update to point to new Principle
    await prisma.federationConfig.update({
      where: { id: myConfig.id },
      data: {
        principleNodeId: newPrincipleId,
        principleUrl: newPrincipleUrl,
      },
    });

    await createAuditLog({
      orgId: myConfig.orgId,
      action: 'federation.role.changed',
      resourceType: 'federation_config',
      details: {
        event: 'New Principle assigned',
        newPrincipleId,
        newPrincipleName,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating to new principle:', error);
    return NextResponse.json({ error: 'Failed to update principle' }, { status: 500 });
  }
}
