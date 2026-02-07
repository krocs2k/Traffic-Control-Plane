import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { generateBackupCodes, hashBackupCode, verifyMfaToken } from '@/lib/mfa';
import { createAuditLog } from '@/lib/audit';

// POST - Generate new backup codes (requires MFA token)
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { mfaToken } = await request.json();

    if (!mfaToken) {
      return NextResponse.json({ error: 'MFA token is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (!user.mfaEnabled || !user.mfaSecret) {
      return NextResponse.json({ error: 'MFA is not enabled' }, { status: 400 });
    }

    // Verify MFA token
    const isValid = verifyMfaToken(mfaToken, user.mfaSecret);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid MFA token' }, { status: 400 });
    }

    // Generate new backup codes
    const newBackupCodes = generateBackupCodes(10);
    const hashedBackupCodes = newBackupCodes.map(code => hashBackupCode(code));

    // Update user with new backup codes
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaBackupCodes: hashedBackupCodes },
    });

    await createAuditLog({
      userId: user.id,
      orgId: session.user.currentOrgId,
      action: 'MFA_BACKUP_CODES_REGENERATED',
      resourceType: 'user',
      resourceId: user.id,
      details: { regeneratedAt: new Date().toISOString() },
    });

    return NextResponse.json({
      backupCodes: newBackupCodes,
      message: 'New backup codes generated. Store them safely.',
    });
  } catch (error) {
    console.error('Backup codes error:', error);
    return NextResponse.json({ error: 'Failed to generate backup codes' }, { status: 500 });
  }
}

// GET - Get remaining backup codes count
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { mfaBackupCodes: true, mfaEnabled: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      mfaEnabled: user.mfaEnabled,
      remainingBackupCodes: user.mfaBackupCodes.length,
    });
  } catch (error) {
    console.error('Get backup codes count error:', error);
    return NextResponse.json({ error: 'Failed to get backup codes count' }, { status: 500 });
  }
}
