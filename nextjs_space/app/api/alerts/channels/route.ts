import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';

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

    const channels = await prisma.alertChannel.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(channels);
  } catch (error) {
    console.error('Error fetching alert channels:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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

    const orgId = user.memberships[0].orgId;
    const body = await request.json();

    const { name, type, config } = body;

    if (!name || !type) {
      return NextResponse.json({ error: 'Name and type are required' }, { status: 400 });
    }

    const channel = await prisma.alertChannel.create({
      data: {
        orgId,
        name,
        type,
        config: config || {},
      },
    });

    await createAuditLog({
      orgId,
      userId: user.id,
      action: 'alert.channel.created',
      resourceType: 'alert_channel',
      resourceId: channel.id,
      details: { name, type },
    });

    return NextResponse.json(channel);
  } catch (error) {
    console.error('Error creating alert channel:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
