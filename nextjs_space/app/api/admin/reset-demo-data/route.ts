export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { createAuditLog, getClientIP } from '@/lib/audit';

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is an owner of any organization
    const ownership = await prisma.organizationMember.findFirst({
      where: {
        userId: session?.user?.id ?? '',
        role: 'OWNER',
      },
    });

    if (!ownership) {
      return NextResponse.json(
        { error: 'Only organization owners can reset demo data' },
        { status: 403 }
      );
    }

    // Delete all data except the current user
    await prisma.$transaction([
      prisma.auditLog.deleteMany({}),
      prisma.passwordResetToken.deleteMany({}),
      prisma.session.deleteMany({}),
      prisma.organizationInvite.deleteMany({}),
      prisma.organizationMember.deleteMany({}),
      prisma.organization.deleteMany({}),
      prisma.user.deleteMany({
        where: { id: { not: session?.user?.id ?? '' } },
      }),
    ]);

    // Create demo organizations
    const passwordHash = await bcrypt.hash('password123', 12);

    const acmeCorp = await prisma.organization.create({
      data: {
        name: 'Acme Corp',
        slug: 'acme-corp',
        settings: {
          theme: 'dark',
          notifications: true,
        },
      },
    });

    const techStart = await prisma.organization.create({
      data: {
        name: 'TechStart Inc',
        slug: 'techstart-inc',
        settings: {
          theme: 'light',
          notifications: true,
        },
      },
    });

    // Create demo users
    const alice = await prisma.user.create({
      data: {
        email: 'alice@acme.com',
        name: 'Alice Johnson',
        passwordHash,
        status: 'ACTIVE',
      },
    });

    const bob = await prisma.user.create({
      data: {
        email: 'bob@acme.com',
        name: 'Bob Smith',
        passwordHash,
        status: 'ACTIVE',
      },
    });

    const carol = await prisma.user.create({
      data: {
        email: 'carol@techstart.com',
        name: 'Carol Williams',
        passwordHash,
        status: 'ACTIVE',
      },
    });

    const dave = await prisma.user.create({
      data: {
        email: 'dave@techstart.com',
        name: 'Dave Brown',
        passwordHash,
        status: 'ACTIVE',
      },
    });

    const eve = await prisma.user.create({
      data: {
        email: 'eve@external.com',
        name: 'Eve Davis',
        passwordHash,
        status: 'ACTIVE',
      },
    });

    // Add current user to Acme Corp as Owner
    await prisma.organizationMember.create({
      data: {
        orgId: acmeCorp?.id ?? '',
        userId: session?.user?.id ?? '',
        role: 'OWNER',
      },
    });

    // Create memberships for Acme Corp
    await prisma.organizationMember.createMany({
      data: [
        { orgId: acmeCorp?.id ?? '', userId: alice?.id ?? '', role: 'ADMIN' },
        { orgId: acmeCorp?.id ?? '', userId: bob?.id ?? '', role: 'OPERATOR' },
        { orgId: acmeCorp?.id ?? '', userId: eve?.id ?? '', role: 'AUDITOR' },
      ],
    });

    // Create memberships for TechStart Inc
    await prisma.organizationMember.createMany({
      data: [
        { orgId: techStart?.id ?? '', userId: carol?.id ?? '', role: 'OWNER' },
        { orgId: techStart?.id ?? '', userId: dave?.id ?? '', role: 'VIEWER' },
        { orgId: techStart?.id ?? '', userId: session?.user?.id ?? '', role: 'VIEWER' },
      ],
    });

    const ipAddress = getClientIP(request);

    await createAuditLog({
      userId: session?.user?.id,
      action: 'org.create',
      resourceType: 'demo_data',
      details: { message: 'Demo data reset and reseeded' },
      ipAddress,
    });

    return NextResponse.json({
      success: true,
      message: 'Demo data has been reset and reseeded',
      organizations: [
        { name: 'Acme Corp', slug: 'acme-corp' },
        { name: 'TechStart Inc', slug: 'techstart-inc' },
      ],
      users: [
        { email: 'alice@acme.com', org: 'Acme Corp', role: 'Admin' },
        { email: 'bob@acme.com', org: 'Acme Corp', role: 'Operator' },
        { email: 'carol@techstart.com', org: 'TechStart Inc', role: 'Owner' },
        { email: 'dave@techstart.com', org: 'TechStart Inc', role: 'Viewer' },
        { email: 'eve@external.com', org: 'Acme Corp', role: 'Auditor' },
      ],
    });
  } catch (error) {
    console.error('Reset demo data error:', error);
    return NextResponse.json(
      { error: 'Failed to reset demo data' },
      { status: 500 }
    );
  }
}
