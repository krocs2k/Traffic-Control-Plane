/**
 * Federation Configuration & Status API
 * 
 * GET  - Get federation configuration and status
 * POST - Initialize/update federation configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';
import { getFederationStats, getAllPeers, refreshPeerList } from '@/lib/federation';
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

    // Get federation config
    const config = await prisma.federationConfig.findUnique({
      where: { orgId },
    });

    if (!config) {
      return NextResponse.json({
        configured: false,
        role: 'STANDALONE',
        message: 'Federation not configured',
      });
    }

    // Get stats and peers
    const stats = await getFederationStats(orgId);
    const peers = getAllPeers();

    // Get partners if Principle
    let partners: Array<{
      nodeId: string;
      nodeName: string;
      nodeUrl: string;
      isActive: boolean;
      lastSyncAt: Date | null;
      lastHeartbeat: Date | null;
      syncStatus: string;
    }> = [];
    if (config.role === 'PRINCIPLE') {
      partners = await prisma.federationPartner.findMany({
        where: { orgId },
        select: {
          nodeId: true,
          nodeName: true,
          nodeUrl: true,
          isActive: true,
          lastSyncAt: true,
          lastHeartbeat: true,
          syncStatus: true,
        },
      });
    }

    // Get pending requests
    const pendingRequests = await prisma.federationRequest.findMany({
      where: { orgId, status: 'PENDING' },
    });

    return NextResponse.json({
      configured: true,
      config: {
        nodeId: config.nodeId,
        nodeName: config.nodeName,
        nodeUrl: config.nodeUrl,
        role: config.role,
        principleNodeId: config.principleNodeId,
        principleUrl: config.principleUrl,
        isActive: config.isActive,
        lastHeartbeat: config.lastHeartbeat,
      },
      stats,
      peers,
      partners,
      pendingRequests: pendingRequests.length,
    });
  } catch (error) {
    console.error('Error fetching federation config:', error);
    return NextResponse.json(
      { error: 'Failed to fetch federation configuration' },
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
    const { nodeName, nodeUrl, role } = body;

    if (!nodeName || !nodeUrl) {
      return NextResponse.json(
        { error: 'nodeName and nodeUrl are required' },
        { status: 400 }
      );
    }

    // Check for existing config
    const existingConfig = await prisma.federationConfig.findUnique({
      where: { orgId },
    });

    const secretKey = existingConfig?.secretKey || crypto.randomBytes(32).toString('hex');
    const nodeId = existingConfig?.nodeId || `tcp-${crypto.randomBytes(8).toString('hex')}`;

    const config = await prisma.federationConfig.upsert({
      where: { orgId },
      update: {
        nodeName,
        nodeUrl,
        role: role || 'STANDALONE',
        updatedAt: new Date(),
      },
      create: {
        orgId,
        nodeId,
        nodeName,
        nodeUrl,
        role: role || 'STANDALONE',
        secretKey,
      },
    });

    await createAuditLog({
      orgId,
      userId: user.id,
      action: 'federation.configured',
      resourceType: 'federation',
      resourceId: config.id,
      details: { nodeName, nodeUrl, role: role || 'STANDALONE' },
    });

    // Initialize federation state
    await refreshPeerList(orgId);

    return NextResponse.json({
      success: true,
      config: {
        nodeId: config.nodeId,
        nodeName: config.nodeName,
        nodeUrl: config.nodeUrl,
        role: config.role,
        secretKey: config.secretKey,
      },
    });
  } catch (error) {
    console.error('Error configuring federation:', error);
    return NextResponse.json(
      { error: 'Failed to configure federation' },
      { status: 500 }
    );
  }
}
