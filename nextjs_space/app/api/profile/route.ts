export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { createAuditLog, getClientIP } from '@/lib/audit';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session?.user?.id ?? '' },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        mfaEnabled: true,
        status: true,
        createdAt: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Get profile error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch profile' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request?.json?.();
    const { name, avatarUrl } = body ?? {};

    const currentUser = await prisma.user.findUnique({
      where: { id: session?.user?.id ?? '' },
    });

    if (!currentUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const updateData: { name?: string; avatarUrl?: string | null } = {};
    const details: Record<string, unknown> = {};

    if (name !== undefined && name !== currentUser?.name) {
      updateData.name = name?.trim?.() ?? '';
      details.before = { ...(details?.before ?? {}), name: currentUser?.name };
      details.after = { ...(details?.after ?? {}), name: updateData?.name };
    }

    if (avatarUrl !== undefined && avatarUrl !== currentUser?.avatarUrl) {
      updateData.avatarUrl = avatarUrl;
      details.before = { ...(details?.before ?? {}), avatarUrl: currentUser?.avatarUrl };
      details.after = { ...(details?.after ?? {}), avatarUrl };
    }

    if (Object.keys(updateData ?? {})?.length === 0) {
      return NextResponse.json({ success: true, user: currentUser });
    }

    const user = await prisma.user.update({
      where: { id: session?.user?.id ?? '' },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        mfaEnabled: true,
        status: true,
      },
    });

    const ipAddress = getClientIP(request);

    await createAuditLog({
      userId: session?.user?.id,
      action: 'user.profile_update',
      resourceType: 'user',
      resourceId: session?.user?.id,
      details,
      ipAddress,
    });

    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error('Update profile error:', error);
    return NextResponse.json(
      { error: 'Failed to update profile' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request?.json?.();
    const { currentPassword, newPassword } = body ?? {};

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'Current and new passwords are required' },
        { status: 400 }
      );
    }

    if ((newPassword?.length ?? 0) < 8) {
      return NextResponse.json(
        { error: 'New password must be at least 8 characters' },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session?.user?.id ?? '' },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const isValid = await bcrypt.compare(currentPassword, user?.passwordHash ?? '');
    if (!isValid) {
      return NextResponse.json(
        { error: 'Current password is incorrect' },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: session?.user?.id ?? '' },
      data: { passwordHash },
    });

    const ipAddress = getClientIP(request);

    await createAuditLog({
      userId: session?.user?.id,
      action: 'user.password_change',
      resourceType: 'user',
      resourceId: session?.user?.id,
      ipAddress,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Change password error:', error);
    return NextResponse.json(
      { error: 'Failed to change password' },
      { status: 500 }
    );
  }
}
