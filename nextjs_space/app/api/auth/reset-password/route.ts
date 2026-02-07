export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';
import { verifyMfaToken, verifyBackupCode } from '@/lib/mfa';

// GET - Check if MFA is required for a reset token
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json(
        { error: 'Token is required' },
        { status: 400 }
      );
    }

    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: { select: { mfaEnabled: true } } },
    });

    if (!resetToken || resetToken.usedAt || new Date() > resetToken.expiresAt) {
      return NextResponse.json(
        { error: 'Invalid or expired reset token' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      valid: true,
      mfaRequired: resetToken.user?.mfaEnabled ?? false,
    });
  } catch (error) {
    console.error('Check reset token error:', error);
    return NextResponse.json(
      { error: 'Failed to check token' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request?.json?.();
    const { token, password, mfaToken } = body ?? {};

    if (!token || !password) {
      return NextResponse.json(
        { error: 'Token and password are required' },
        { status: 400 }
      );
    }

    if ((password?.length ?? 0) < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }

    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!resetToken) {
      return NextResponse.json(
        { error: 'Invalid or expired reset token' },
        { status: 400 }
      );
    }

    if (resetToken?.usedAt) {
      return NextResponse.json(
        { error: 'This reset token has already been used' },
        { status: 400 }
      );
    }

    if (new Date() > new Date(resetToken?.expiresAt ?? 0)) {
      return NextResponse.json(
        { error: 'This reset token has expired' },
        { status: 400 }
      );
    }

    const user = resetToken.user;

    // Check if MFA is enabled and validate MFA token
    if (user?.mfaEnabled && user?.mfaSecret) {
      if (!mfaToken) {
        return NextResponse.json(
          { error: 'MFA_REQUIRED', message: 'MFA verification is required to reset password' },
          { status: 400 }
        );
      }

      // Try TOTP verification first
      const isValidTotp = verifyMfaToken(mfaToken, user.mfaSecret);
      
      if (!isValidTotp) {
        // Try backup code
        const backupResult = verifyBackupCode(mfaToken, user.mfaBackupCodes);
        
        if (backupResult.valid) {
          // Remove used backup code
          const updatedCodes = [...user.mfaBackupCodes];
          updatedCodes.splice(backupResult.index, 1);
          await prisma.user.update({
            where: { id: user.id },
            data: { mfaBackupCodes: updatedCodes },
          });
        } else {
          return NextResponse.json(
            { error: 'Invalid MFA code' },
            { status: 400 }
          );
        }
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Update password and mark token as used
    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetToken?.userId ?? '' },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetToken?.id ?? '' },
        data: { usedAt: new Date() },
      }),
    ]);

    const ipAddress = getClientIP(request);

    await createAuditLog({
      userId: resetToken?.userId,
      action: 'user.password_reset',
      resourceType: 'user',
      resourceId: resetToken?.userId,
      details: { 
        email: resetToken?.user?.email,
        mfaVerified: user?.mfaEnabled ?? false,
      },
      ipAddress,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json(
      { error: 'Failed to reset password' },
      { status: 500 }
    );
  }
}
