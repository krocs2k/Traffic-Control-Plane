export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sessions = await prisma.session.findMany({
      where: {
        userId: session?.user?.id ?? '',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get current session token for comparison
    const currentToken = request?.headers?.get?.('cookie')
      ?.split?.(';')
      ?.find?.((c) => c?.trim?.()?.startsWith?.('next-auth.session-token='))
      ?.split?.('=')?.[1];

    const sessionList = sessions?.map?.((s: any) => ({
      id: s?.id ?? '',
      ipAddress: s?.ipAddress,
      userAgent: s?.userAgent,
      createdAt: s?.createdAt,
      expiresAt: s?.expiresAt,
      isCurrent: s?.token === currentToken,
    })) ?? [];

    return NextResponse.json({ sessions: sessionList });
  } catch (error) {
    console.error('Get sessions error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sessions' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request?.url ?? '');
    const sessionId = searchParams?.get?.('sessionId');
    const revokeAll = searchParams?.get?.('all') === 'true';

    const ipAddress = getClientIP(request);

    if (revokeAll) {
      // Revoke all sessions except current
      const currentToken = request?.headers?.get?.('cookie')
        ?.split?.(';')
        ?.find?.((c) => c?.trim?.()?.startsWith?.('next-auth.session-token='))
        ?.split?.('=')?.[1];

      await prisma.session.deleteMany({
        where: {
          userId: session?.user?.id ?? '',
          token: { not: currentToken ?? '' },
        },
      });

      await createAuditLog({
        userId: session?.user?.id,
        action: 'session.revoke_all',
        resourceType: 'session',
        details: { reason: 'User revoked all sessions' },
        ipAddress,
      });

      return NextResponse.json({ success: true });
    }

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    const targetSession = await prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!targetSession || targetSession?.userId !== session?.user?.id) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    await prisma.session.delete({
      where: { id: sessionId },
    });

    await createAuditLog({
      userId: session?.user?.id,
      action: 'session.revoke',
      resourceType: 'session',
      resourceId: sessionId,
      details: { reason: 'User revoked session' },
      ipAddress,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Revoke session error:', error);
    return NextResponse.json(
      { error: 'Failed to revoke session' },
      { status: 500 }
    );
  }
}
