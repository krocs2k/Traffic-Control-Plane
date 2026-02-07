export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const auth = await requirePermission('view_audit');
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(request?.url ?? '');
    const page = parseInt(searchParams?.get?.('page') ?? '1', 10);
    const limit = parseInt(searchParams?.get?.('limit') ?? '50', 10);
    const action = searchParams?.get?.('action');
    const userId = searchParams?.get?.('userId');
    const resourceType = searchParams?.get?.('resourceType');

    const where: Record<string, unknown> = {
      orgId: auth?.orgId ?? '',
    };

    if (action) {
      where.action = action;
    }
    if (userId) {
      where.userId = userId;
    }
    if (resourceType) {
      where.resourceType = resourceType;
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    const auditLogs = logs?.map?.((log: any) => ({
      id: log?.id ?? '',
      action: log?.action ?? '',
      resourceType: log?.resourceType ?? '',
      resourceId: log?.resourceId,
      details: log?.details ?? {},
      ipAddress: log?.ipAddress,
      createdAt: log?.createdAt,
      user: log?.user
        ? {
            id: log?.user?.id ?? '',
            name: log?.user?.name ?? '',
            email: log?.user?.email ?? '',
          }
        : null,
    })) ?? [];

    return NextResponse.json({
      auditLogs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch audit logs' },
      { status: 500 }
    );
  }
}
