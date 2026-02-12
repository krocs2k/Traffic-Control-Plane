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
    const archivedParam = searchParams?.get?.('archived');

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
    // Filter by archived status (default: show non-archived)
    if (archivedParam === 'true') {
      where.archived = true;
    } else if (archivedParam === 'all') {
      // Show all (no filter)
    } else {
      where.archived = false;
    }

    const [logs, total, archivedCount] = await Promise.all([
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
      prisma.auditLog.count({ 
        where: { orgId: auth?.orgId ?? '', archived: true } 
      }),
    ]);

    const auditLogs = logs?.map?.((log: any) => ({
      id: log?.id ?? '',
      action: log?.action ?? '',
      resourceType: log?.resourceType ?? '',
      resourceId: log?.resourceId,
      details: log?.details ?? {},
      ipAddress: log?.ipAddress,
      archived: log?.archived ?? false,
      archivedAt: log?.archivedAt,
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
      archivedCount,
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch audit logs' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/audit - Bulk archive/unarchive audit logs
 * Supports:
 *   - ids=[...] - Archive specific audit logs by ID
 *   - archiveAll=true - Archive all audit logs for the organization
 *   - olderThan=<date> - Archive logs older than the specified date
 *   - unarchive=true - Unarchive instead of archive
 */
export async function PATCH(request: Request) {
  try {
    const auth = await requirePermission('manage_audit');
    if (auth instanceof NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    const { ids, archiveAll, olderThan, unarchive } = body;

    const where: Record<string, unknown> = {
      orgId: auth?.orgId ?? '',
    };

    // Build where clause based on archive criteria
    if (ids && Array.isArray(ids) && ids.length > 0) {
      where.id = { in: ids };
    } else if (olderThan) {
      const date = new Date(olderThan);
      if (isNaN(date.getTime())) {
        return NextResponse.json(
          { error: 'Invalid date format for olderThan' },
          { status: 400 }
        );
      }
      where.createdAt = { lt: date };
    } else if (!archiveAll) {
      return NextResponse.json(
        { error: 'Must specify archiveAll, ids, or olderThan' },
        { status: 400 }
      );
    }

    // Update to archive or unarchive
    const result = await prisma.auditLog.updateMany({
      where,
      data: {
        archived: !unarchive,
        archivedAt: !unarchive ? new Date() : null,
      },
    });

    const action = unarchive ? 'unarchived' : 'archived';

    return NextResponse.json({
      success: true,
      count: result.count,
      message: `Successfully ${action} ${result.count} audit log(s)`,
    });
  } catch (error) {
    console.error('Archive audit logs error:', error);
    return NextResponse.json(
      { error: 'Failed to archive audit logs' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/audit - Bulk delete audit logs
 * Supports: 
 *   - deleteAll=true - Delete all audit logs for the organization
 *   - ids=[...] - Delete specific audit logs by ID
 *   - olderThan=<date> - Delete logs older than the specified date
 */
export async function DELETE(request: Request) {
  try {
    const auth = await requirePermission('manage_audit');
    if (auth instanceof NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    const { deleteAll, ids, olderThan } = body;

    const where: Record<string, unknown> = {
      orgId: auth?.orgId ?? '',
    };

    // Build where clause based on deletion type
    if (ids && Array.isArray(ids) && ids.length > 0) {
      where.id = { in: ids };
    } else if (olderThan) {
      const date = new Date(olderThan);
      if (isNaN(date.getTime())) {
        return NextResponse.json(
          { error: 'Invalid date format for olderThan' },
          { status: 400 }
        );
      }
      where.createdAt = { lt: date };
    } else if (!deleteAll) {
      return NextResponse.json(
        { error: 'Must specify deleteAll, ids, or olderThan' },
        { status: 400 }
      );
    }

    // Perform deletion
    const result = await prisma.auditLog.deleteMany({ where });

    return NextResponse.json({
      success: true,
      deleted: result.count,
      message: `Successfully deleted ${result.count} audit log(s)`,
    });
  } catch (error) {
    console.error('Delete audit logs error:', error);
    return NextResponse.json(
      { error: 'Failed to delete audit logs' },
      { status: 500 }
    );
  }
}
