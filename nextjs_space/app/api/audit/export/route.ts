import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { hasPermission } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: {
        memberships: {
          include: { organization: true },
        },
      },
    });

    if (!user || user.memberships.length === 0) {
      return NextResponse.json({ error: 'No organization found' }, { status: 404 });
    }

    const membership = user.memberships[0];
    const userRole = membership.role;

    // Check permission
    if (!hasPermission(userRole, 'view_audit')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const orgId = membership.orgId;
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const archived = searchParams.get('archived');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // Build where clause
    const where: Record<string, unknown> = { orgId };
    if (action) where.action = action;
    
    if (archived === 'true') {
      where.archived = true;
    } else if (archived === 'false') {
      where.archived = false;
    }
    // If archived is not specified or 'all', don't filter by archived status

    // Date range filter
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        (where.createdAt as Record<string, Date>).gte = new Date(startDate);
      }
      if (endDate) {
        const endDateTime = new Date(endDate);
        endDateTime.setHours(23, 59, 59, 999);
        (where.createdAt as Record<string, Date>).lte = endDateTime;
      }
    }

    // Fetch all audit logs (limited to prevent memory issues)
    const auditLogs = await prisma.auditLog.findMany({
      where,
      include: {
        user: {
          select: { email: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10000, // Limit to 10k records
    });

    // Generate CSV
    const headers = [
      'ID',
      'Timestamp',
      'Action',
      'User Email',
      'User Name',
      'Resource Type',
      'Resource ID',
      'IP Address',
      'Archived',
      'Details',
    ];

    const escapeCSV = (value: string | null | undefined): string => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      // If value contains comma, newline, or double quote, wrap in quotes and escape quotes
      if (str.includes(',') || str.includes('\n') || str.includes('"')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = auditLogs.map((log) => [
      escapeCSV(log.id),
      escapeCSV(log.createdAt.toISOString()),
      escapeCSV(log.action),
      escapeCSV(log.user?.email),
      escapeCSV(log.user?.name),
      escapeCSV(log.resourceType),
      escapeCSV(log.resourceId),
      escapeCSV(log.ipAddress),
      escapeCSV(log.archived ? 'Yes' : 'No'),
      escapeCSV(JSON.stringify(log.details)),
    ]);

    const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

    // Generate filename with current date
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const filename = `audit-log-${dateStr}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error exporting audit logs:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
