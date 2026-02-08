import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';
import crypto from 'crypto';

// GET - Get this node's federation configuration
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

    // Get federation config for this org
    let config = await prisma.federationConfig.findUnique({
      where: { orgId },
    });

    // Get partners (if Principle)
    const partners = await prisma.federationPartner.findMany({
      where: { orgId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    // Get pending requests
    const pendingRequests = await prisma.federationRequest.findMany({
      where: {
        orgId,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get recent sync logs
    const recentSyncs = await prisma.federationSyncLog.findMany({
      where: { orgId },
      orderBy: { startedAt: 'desc' },
      take: 10,
      include: { partner: { select: { nodeName: true, nodeUrl: true } } },
    });

    return NextResponse.json({
      config,
      partners,
      pendingRequests,
      recentSyncs,
    });
  } catch (error) {
    console.error('Error fetching federation config:', error);
    return NextResponse.json({ error: 'Failed to fetch federation config' }, { status: 500 });
  }
}

// POST - Initialize or update federation configuration
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
    const { nodeName, nodeUrl } = body;

    if (!nodeName || !nodeUrl) {
      return NextResponse.json({ error: 'Node name and URL are required' }, { status: 400 });
    }

    // Check if config exists
    let config = await prisma.federationConfig.findUnique({
      where: { orgId },
    });

    const secretKey = crypto.randomBytes(32).toString('hex');

    if (config) {
      // Update existing config
      config = await prisma.federationConfig.update({
        where: { orgId },
        data: {
          nodeName,
          nodeUrl,
          updatedAt: new Date(),
        },
      });

      await createAuditLog({
        orgId,
        userId: session.user.id,
        action: 'federation.config.updated',
        resourceType: 'federation_config',
        resourceId: config.id,
        details: { nodeName, nodeUrl },
        ipAddress: getClientIP(request),
      });
    } else {
      // Create new config
      config = await prisma.federationConfig.create({
        data: {
          orgId,
          nodeName,
          nodeUrl,
          secretKey,
          role: 'STANDALONE',
        },
      });

      await createAuditLog({
        orgId,
        userId: session.user.id,
        action: 'federation.config.created',
        resourceType: 'federation_config',
        resourceId: config.id,
        details: { nodeName, nodeUrl },
        ipAddress: getClientIP(request),
      });
    }

    return NextResponse.json({ config });
  } catch (error) {
    console.error('Error updating federation config:', error);
    return NextResponse.json({ error: 'Failed to update federation config' }, { status: 500 });
  }
}
