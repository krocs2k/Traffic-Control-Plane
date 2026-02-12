export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requirePermission, requireAuth } from '@/lib/rbac';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';
import { Role } from '@prisma/client';

export async function GET(request: Request) {
  try {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(request?.url ?? '');
    const page = Math.max(1, parseInt(searchParams?.get?.('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams?.get?.('limit') ?? '20', 10)));
    const search = searchParams?.get?.('search') ?? '';
    const roleFilter = searchParams?.get?.('role');

    const where: Record<string, unknown> = { orgId: auth?.orgId ?? '' };
    
    // Build search/filter conditions
    const andConditions: Record<string, unknown>[] = [];
    if (search) {
      andConditions.push({
        OR: [
          { user: { email: { contains: search, mode: 'insensitive' } } },
          { user: { name: { contains: search, mode: 'insensitive' } } },
        ],
      });
    }
    if (roleFilter) {
      andConditions.push({ role: roleFilter });
    }
    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    const [members, total] = await Promise.all([
      prisma.organizationMember.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              avatarUrl: true,
              status: true,
            },
          },
          invitedBy: {
            select: { name: true },
          },
        },
        orderBy: { joinedAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.organizationMember.count({ where }),
    ]);

    const users = members?.map?.((m: any) => ({
      id: m?.id ?? '',
      userId: m?.user?.id ?? '',
      email: m?.user?.email ?? '',
      name: m?.user?.name ?? '',
      avatarUrl: m?.user?.avatarUrl,
      role: m?.role ?? 'VIEWER',
      status: m?.user?.status ?? 'ACTIVE',
      joinedAt: m?.joinedAt,
      invitedBy: m?.invitedBy?.name ? { name: m?.invitedBy?.name } : null,
    })) ?? [];

    return NextResponse.json({
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get users error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requirePermission('manage_users');
    if (auth instanceof NextResponse) return auth;

    const body = await request?.json?.();
    const { memberId, role, status } = body ?? {};

    if (!memberId) {
      return NextResponse.json(
        { error: 'Member ID is required' },
        { status: 400 }
      );
    }

    const member = await prisma.organizationMember.findUnique({
      where: { id: memberId },
      include: { user: true },
    });

    if (!member || member?.orgId !== auth?.orgId) {
      return NextResponse.json(
        { error: 'Member not found' },
        { status: 404 }
      );
    }

    // Prevent modifying owners unless you're an owner
    if (member?.role === 'OWNER' && auth?.orgRole !== 'OWNER') {
      return NextResponse.json(
        { error: 'Only owners can modify other owners' },
        { status: 403 }
      );
    }

    // Prevent the last owner from being demoted
    if (role && role !== 'OWNER' && member?.role === 'OWNER') {
      const ownerCount = await prisma.organizationMember.count({
        where: {
          orgId: auth?.orgId ?? '',
          role: 'OWNER',
        },
      });
      if (ownerCount <= 1) {
        return NextResponse.json(
          { error: 'Cannot remove the last owner' },
          { status: 400 }
        );
      }
    }

    const updateData: { role?: Role } = {};
    const details: Record<string, unknown> = {
      targetUserId: member?.userId,
      targetUserEmail: member?.user?.email,
    };

    if (role && role !== member?.role) {
      updateData.role = role;
      details.before = { role: member?.role };
      details.after = { role };
    }

    // Update user status separately
    if (status && status !== member?.user?.status) {
      await prisma.user.update({
        where: { id: member?.userId ?? '' },
        data: { status },
      });

      const ipAddress = getClientIP(request);
      await createAuditLog({
        orgId: auth?.orgId,
        userId: auth?.userId,
        action: 'user.status_change',
        resourceType: 'user',
        resourceId: member?.userId,
        details: {
          targetUserId: member?.userId,
          targetUserEmail: member?.user?.email,
          before: { status: member?.user?.status },
          after: { status },
        },
        ipAddress,
      });
    }

    if (Object.keys(updateData ?? {})?.length > 0) {
      await prisma.organizationMember.update({
        where: { id: memberId },
        data: updateData,
      });

      const ipAddress = getClientIP(request);
      await createAuditLog({
        orgId: auth?.orgId,
        userId: auth?.userId,
        action: 'user.role_change',
        resourceType: 'organizationMember',
        resourceId: memberId,
        details,
        ipAddress,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update user error:', error);
    return NextResponse.json(
      { error: 'Failed to update user' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requirePermission('manage_users');
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(request?.url ?? '');
    const memberId = searchParams?.get?.('memberId');

    if (!memberId) {
      return NextResponse.json(
        { error: 'Member ID is required' },
        { status: 400 }
      );
    }

    const member = await prisma.organizationMember.findUnique({
      where: { id: memberId },
      include: { user: true },
    });

    if (!member || member?.orgId !== auth?.orgId) {
      return NextResponse.json(
        { error: 'Member not found' },
        { status: 404 }
      );
    }

    // Prevent removing owners unless you're an owner
    if (member?.role === 'OWNER' && auth?.orgRole !== 'OWNER') {
      return NextResponse.json(
        { error: 'Only owners can remove other owners' },
        { status: 403 }
      );
    }

    // Prevent the last owner from being removed
    if (member?.role === 'OWNER') {
      const ownerCount = await prisma.organizationMember.count({
        where: {
          orgId: auth?.orgId ?? '',
          role: 'OWNER',
        },
      });
      if (ownerCount <= 1) {
        return NextResponse.json(
          { error: 'Cannot remove the last owner' },
          { status: 400 }
        );
      }
    }

    // Prevent removing yourself
    if (member?.userId === auth?.userId) {
      return NextResponse.json(
        { error: 'You cannot remove yourself from the organization' },
        { status: 400 }
      );
    }

    await prisma.organizationMember.delete({
      where: { id: memberId },
    });

    const ipAddress = getClientIP(request);

    await createAuditLog({
      orgId: auth?.orgId,
      userId: auth?.userId,
      action: 'user.remove',
      resourceType: 'organizationMember',
      resourceId: memberId,
      details: {
        targetUserId: member?.userId,
        targetUserEmail: member?.user?.email,
        role: member?.role,
      },
      ipAddress,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Remove user error:', error);
    return NextResponse.json(
      { error: 'Failed to remove user' },
      { status: 500 }
    );
  }
}
