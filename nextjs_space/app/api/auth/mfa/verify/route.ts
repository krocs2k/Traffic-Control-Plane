import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { verifyMfaToken } from '@/lib/mfa';
import { createAuditLog } from '@/lib/audit';

// POST - Verify MFA token and enable MFA
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { token } = await request.json();

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'MFA token is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (!user.mfaSecret) {
      return NextResponse.json({ error: 'MFA setup not initiated' }, { status: 400 });
    }

    if (user.mfaEnabled) {
      return NextResponse.json({ error: 'MFA is already enabled' }, { status: 400 });
    }

    // Verify the token
    const isValid = verifyMfaToken(token, user.mfaSecret);

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid MFA token' }, { status: 400 });
    }

    // Enable MFA
    await prisma.user.update({
      where: { id: user.id },
      data: {
        mfaEnabled: true,
        mfaVerifiedAt: new Date(),
      },
    });

    await createAuditLog({
      userId: user.id,
      orgId: session.user.currentOrgId,
      action: 'MFA_ENABLED',
      resourceType: 'user',
      resourceId: user.id,
      details: { verifiedAt: new Date().toISOString() },
    });

    return NextResponse.json({
      success: true,
      message: 'MFA has been enabled successfully',
    });
  } catch (error) {
    console.error('MFA verify error:', error);
    return NextResponse.json({ error: 'Failed to verify MFA' }, { status: 500 });
  }
}
