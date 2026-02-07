export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';

export async function POST(request: Request) {
  try {
    const body = await request?.json?.();
    const { token, password } = body ?? {};

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
      details: { email: resetToken?.user?.email },
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
