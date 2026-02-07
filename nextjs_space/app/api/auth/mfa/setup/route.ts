import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { initiateMfaSetup, hashBackupCode } from '@/lib/mfa';
import { createAuditLog } from '@/lib/audit';

// POST - Initiate MFA setup
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (user.mfaEnabled) {
      return NextResponse.json({ error: 'MFA is already enabled' }, { status: 400 });
    }

    // Generate MFA setup data
    const setupData = await initiateMfaSetup(user.email);

    // Hash backup codes for storage
    const hashedBackupCodes = setupData.backupCodes.map(code => hashBackupCode(code));

    // Store secret and backup codes (MFA not enabled yet)
    await prisma.user.update({
      where: { id: user.id },
      data: {
        mfaSecret: setupData.secret,
        mfaBackupCodes: hashedBackupCodes,
      },
    });

    await createAuditLog({
      userId: user.id,
      orgId: session.user.currentOrgId,
      action: 'MFA_SETUP_INITIATED',
      resourceType: 'user',
      resourceId: user.id,
      details: {},
    });

    return NextResponse.json({
      qrCodeUrl: setupData.qrCodeUrl,
      backupCodes: setupData.backupCodes, // Return plain codes to user (one time only)
      message: 'Scan the QR code with your authenticator app and verify with a code',
    });
  } catch (error) {
    console.error('MFA setup error:', error);
    return NextResponse.json({ error: 'Failed to setup MFA' }, { status: 500 });
  }
}
