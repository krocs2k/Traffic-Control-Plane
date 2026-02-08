import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';

// POST - Receive notification to become the new Principle
export async function POST(request: NextRequest) {
  try {
    const secretKey = request.headers.get('X-Federation-Secret');
    const body = await request.json();
    const { previousPrincipleId, previousPrincipleUrl, partners } = body;

    // Find this node's config
    const myConfig = await prisma.federationConfig.findFirst({
      where: { role: 'PARTNER', principleNodeId: previousPrincipleId },
    });

    if (!myConfig) {
      return NextResponse.json({ error: 'Not a partner of this principle' }, { status: 403 });
    }

    const orgId = myConfig.orgId;

    // Update this node to be Principle
    await prisma.federationConfig.update({
      where: { id: myConfig.id },
      data: {
        role: 'PRINCIPLE',
        principleNodeId: null,
        principleUrl: null,
      },
    });

    // Add the previous Principle as a Partner
    await prisma.federationPartner.create({
      data: {
        orgId,
        nodeId: previousPrincipleId,
        nodeName: 'Previous Principle',
        nodeUrl: previousPrincipleUrl,
        secretKey: secretKey || myConfig.secretKey,
        isActive: true,
      },
    });

    // Add transferred partners
    if (partners?.length) {
      for (const partner of partners) {
        await prisma.federationPartner.create({
          data: {
            orgId,
            nodeId: partner.nodeId,
            nodeName: partner.nodeName,
            nodeUrl: partner.nodeUrl,
            secretKey: partner.secretKey,
            isActive: true,
          },
        });

        // Notify each transferred partner of the new Principle
        try {
          await fetch(`${partner.nodeUrl}/api/federation/promote/new-principle`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Federation-Secret': partner.secretKey,
            },
            body: JSON.stringify({
              newPrincipleId: myConfig.nodeId,
              newPrincipleName: myConfig.nodeName,
              newPrincipleUrl: myConfig.nodeUrl,
            }),
          });
        } catch (notifyError) {
          console.error(`Failed to notify partner ${partner.nodeName}:`, notifyError);
        }
      }
    }

    await createAuditLog({
      orgId,
      action: 'federation.role.changed',
      resourceType: 'federation_config',
      details: {
        newRole: 'PRINCIPLE',
        previousPrincipleId,
        partnersInherited: partners?.length || 0,
      },
    });

    return NextResponse.json({
      success: true,
      newRole: 'PRINCIPLE',
      partnersCount: (partners?.length || 0) + 1,
    });
  } catch (error) {
    console.error('Error becoming principle:', error);
    return NextResponse.json({ error: 'Failed to become principle' }, { status: 500 });
  }
}
