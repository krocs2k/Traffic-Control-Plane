export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';
import { generateToken } from '@/lib/utils';

export async function POST(request: Request) {
  try {
    const body = await request?.json?.();
    const { email } = body ?? {};

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    const normalizedEmail = email?.toLowerCase?.()?.trim?.() ?? '';

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    // Always return success to prevent email enumeration
    if (!user) {
      return NextResponse.json({ success: true });
    }

    // Invalidate any existing tokens
    await prisma.passwordResetToken.updateMany({
      where: {
        userId: user?.id ?? '',
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    });

    // Create new reset token (expires in 1 hour)
    const token = generateToken(32);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.passwordResetToken.create({
      data: {
        userId: user?.id ?? '',
        token,
        expiresAt,
      },
    });

    const ipAddress = getClientIP(request);

    await createAuditLog({
      userId: user?.id,
      action: 'user.password_reset_request',
      resourceType: 'user',
      resourceId: user?.id,
      details: { email: normalizedEmail },
      ipAddress,
    });

    // In production, send email with reset link
    // For now, log the token (placeholder for email sending)
    console.log(`Password reset token for ${normalizedEmail}: ${token}`);
    console.log(`Reset link: ${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/reset-password?token=${token}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}
