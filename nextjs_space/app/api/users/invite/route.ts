export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';
import { generateToken } from '@/lib/utils';
import { Role } from '@prisma/client';

export async function POST(request: Request) {
  try {
    const auth = await requirePermission('manage_users');
    if (auth instanceof NextResponse) return auth;

    const body = await request?.json?.();
    const { email, role = 'VIEWER' } = body ?? {};

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    const normalizedEmail = email?.toLowerCase?.()?.trim?.() ?? '';

    // Check if user already exists in the organization
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        memberships: {
          where: { orgId: auth?.orgId ?? '' },
        },
      },
    });

    if (existingUser && (existingUser?.memberships?.length ?? 0) > 0) {
      return NextResponse.json(
        { error: 'This user is already a member of this organization' },
        { status: 400 }
      );
    }

    // Check if there's already a pending invite
    const existingInvite = await prisma.organizationInvite.findUnique({
      where: {
        orgId_email: {
          orgId: auth?.orgId ?? '',
          email: normalizedEmail,
        },
      },
    });

    if (existingInvite && !existingInvite?.usedAt && new Date() < new Date(existingInvite?.expiresAt ?? 0)) {
      return NextResponse.json(
        { error: 'An invitation has already been sent to this email' },
        { status: 400 }
      );
    }

    // Validate role - admins can't invite owners
    if (role === 'OWNER' && auth?.orgRole !== 'OWNER') {
      return NextResponse.json(
        { error: 'Only owners can invite other owners' },
        { status: 403 }
      );
    }

    const validRoles: Role[] = ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER', 'AUDITOR'];
    if (!validRoles?.includes?.(role)) {
      return NextResponse.json(
        { error: 'Invalid role' },
        { status: 400 }
      );
    }

    // Create or update invite
    const token = generateToken(32);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    if (existingInvite) {
      await prisma.organizationInvite.update({
        where: { id: existingInvite?.id ?? '' },
        data: {
          token,
          role,
          expiresAt,
          usedAt: null,
          invitedById: auth?.userId ?? '',
        },
      });
    } else {
      await prisma.organizationInvite.create({
        data: {
          orgId: auth?.orgId ?? '',
          email: normalizedEmail,
          role,
          token,
          expiresAt,
          invitedById: auth?.userId ?? '',
        },
      });
    }

    const ipAddress = getClientIP(request);

    await createAuditLog({
      orgId: auth?.orgId,
      userId: auth?.userId,
      action: 'user.invite',
      resourceType: 'organizationInvite',
      details: {
        email: normalizedEmail,
        role,
      },
      ipAddress,
    });

    // In production, send email with invite link
    console.log(`Invite token for ${normalizedEmail}: ${token}`);
    console.log(`Invite link: ${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/invite?token=${token}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Invite user error:', error);
    return NextResponse.json(
      { error: 'Failed to send invitation' },
      { status: 500 }
    );
  }
}
