import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// POST - Receive heartbeat from a Partner or send heartbeat to Principle
export async function POST(request: NextRequest) {
  try {
    const secretKey = request.headers.get('X-Federation-Secret');
    const body = await request.json();
    const { nodeId, nodeUrl, role } = body;

    if (role === 'PARTNER') {
      // This is a heartbeat from a Partner to Principle
      const partner = await prisma.federationPartner.findFirst({
        where: { nodeId, secretKey: secretKey || undefined },
      });

      if (partner) {
        await prisma.federationPartner.update({
          where: { id: partner.id },
          data: { lastHeartbeat: new Date() },
        });

        return NextResponse.json({
          success: true,
          role: 'PRINCIPLE',
          timestamp: new Date().toISOString(),
        });
      }

      return NextResponse.json({ error: 'Unknown partner' }, { status: 404 });
    } else if (role === 'PRINCIPLE') {
      // This is a heartbeat from Principle to Partner
      const myConfig = await prisma.federationConfig.findFirst({
        where: {
          role: 'PARTNER',
          principleNodeId: nodeId,
        },
      });

      if (myConfig) {
        await prisma.federationConfig.update({
          where: { id: myConfig.id },
          data: { lastHeartbeat: new Date() },
        });

        return NextResponse.json({
          success: true,
          role: 'PARTNER',
          timestamp: new Date().toISOString(),
        });
      }

      return NextResponse.json({ error: 'Not a partner of this principle' }, { status: 404 });
    }

    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  } catch (error) {
    console.error('Error processing heartbeat:', error);
    return NextResponse.json({ error: 'Failed to process heartbeat' }, { status: 500 });
  }
}

// GET - Check heartbeat status for all partners (Principle) or Principle (Partner)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('orgId');

    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID required' }, { status: 400 });
    }

    const config = await prisma.federationConfig.findUnique({
      where: { orgId },
    });

    if (!config) {
      return NextResponse.json({ error: 'Federation not configured' }, { status: 404 });
    }

    if (config.role === 'PRINCIPLE') {
      // Get heartbeat status of all partners
      const partners = await prisma.federationPartner.findMany({
        where: { orgId },
        select: {
          id: true,
          nodeId: true,
          nodeName: true,
          lastHeartbeat: true,
          isActive: true,
        },
      });

      const now = new Date();
      const heartbeatStatus = partners.map((p) => ({
        ...p,
        isAlive: p.lastHeartbeat && (now.getTime() - p.lastHeartbeat.getTime()) < 60000, // 60 seconds
        secondsSinceLastHeartbeat: p.lastHeartbeat
          ? Math.floor((now.getTime() - p.lastHeartbeat.getTime()) / 1000)
          : null,
      }));

      return NextResponse.json({ role: 'PRINCIPLE', partners: heartbeatStatus });
    } else if (config.role === 'PARTNER') {
      // Get heartbeat status from Principle
      const now = new Date();
      const isAlive = config.lastHeartbeat && (now.getTime() - config.lastHeartbeat.getTime()) < 60000;

      return NextResponse.json({
        role: 'PARTNER',
        principle: {
          nodeId: config.principleNodeId,
          url: config.principleUrl,
          lastHeartbeat: config.lastHeartbeat,
          isAlive,
          secondsSinceLastHeartbeat: config.lastHeartbeat
            ? Math.floor((now.getTime() - config.lastHeartbeat.getTime()) / 1000)
            : null,
        },
      });
    }

    return NextResponse.json({ role: 'STANDALONE', message: 'Not part of a federation' });
  } catch (error) {
    console.error('Error checking heartbeat:', error);
    return NextResponse.json({ error: 'Failed to check heartbeat' }, { status: 500 });
  }
}
