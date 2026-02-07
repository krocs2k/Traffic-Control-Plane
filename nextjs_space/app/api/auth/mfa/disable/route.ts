import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { verifyMfaToken } from '@/lib/mfa';
import bcrypt from 'bcryptjs';
import { createAuditLog } from '@/lib/audit';

// POST - Disable MFA (requires MFA token or password)
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { mfaToken, password } = await request.json();

    if (!mfaToken && !password) {
      return NextResponse.json({ error: 'MFA token or password is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (!user.mfaEnabled) {
      return NextResponse.json({ error: 'MFA is not enabled' }, { status: 400 });
    }

    // Verify using MFA token
    if (mfaToken) {
      const isValid = verifyMfaToken(mfaToken, user.mfaSecret || '');
      if (!isValid) {
        return NextResponse.json({ error: 'Invalid MFA token' }, { status: 400 });
      }
    } else if (password) {
      // Verify using password as fallback
      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        return NextResponse.json({ error: 'Invalid password' }, { status: 400 });
      }
    }

    // Disable MFA
    await prisma.user.update({
      where: { id: user.id },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
        mfaBackupCodes: [],
        mfaVerifiedAt: null,
      },
    });

    await createAuditLog({
      userId: user.id,
      orgId: session.user.currentOrgId,
      action: 'MFA_DISABLED',
      resourceType: 'user',
      resourceId: user.id,
      details: { disabledAt: new Date().toISOString() },
    });

    return NextResponse.json({
      success: true,
      message: 'MFA has been disabled',
    });
  } catch (error) {
    console.error('MFA disable error:', error);
    return NextResponse.json({ error: 'Failed to disable MFA' }, { status: 500 });
  }
}
