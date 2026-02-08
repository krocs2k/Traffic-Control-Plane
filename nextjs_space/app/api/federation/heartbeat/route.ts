/**
 * Federation Heartbeat API
 * 
 * POST - Receive heartbeat from peer node
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { recordPeerHeartbeat } from '@/lib/federation';

export async function POST(request: NextRequest) {
  try {
    const secretKey = request.headers.get('X-Federation-Secret');
    
    if (!secretKey) {
      return NextResponse.json({ error: 'Missing secret key' }, { status: 401 });
    }

    const body = await request.json();
    const { nodeId, nodeName, load, timestamp } = body;

    if (!nodeId) {
      return NextResponse.json({ error: 'nodeId is required' }, { status: 400 });
    }

    // Find which org this secret belongs to
    const config = await prisma.federationConfig.findFirst({
      where: { secretKey },
    });

    if (!config) {
      // Check if it's a partner's secret
      const partner = await prisma.federationPartner.findFirst({
        where: { secretKey, nodeId },
      });

      if (!partner) {
        return NextResponse.json({ error: 'Invalid secret key' }, { status: 401 });
      }

      // Update partner heartbeat
      await prisma.federationPartner.update({
        where: { id: partner.id },
        data: { lastHeartbeat: new Date() },
      });

      await recordPeerHeartbeat(partner.orgId, nodeId, load);

      return NextResponse.json({
        success: true,
        ack: true,
        serverTime: Date.now(),
      });
    }

    // This is a heartbeat to us as a partner from our principle
    if (config.role === 'PARTNER' && config.principleNodeId === nodeId) {
      await prisma.federationConfig.update({
        where: { id: config.id },
        data: { lastHeartbeat: new Date() },
      });

      await recordPeerHeartbeat(config.orgId, nodeId, load);
    }

    return NextResponse.json({
      success: true,
      ack: true,
      serverTime: Date.now(),
      nodeId: config.nodeId,
    });
  } catch (error) {
    console.error('Error processing heartbeat:', error);
    return NextResponse.json(
      { error: 'Failed to process heartbeat' },
      { status: 500 }
    );
  }
}
