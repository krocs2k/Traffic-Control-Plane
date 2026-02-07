export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';
import { generateSlug } from '@/lib/utils';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const memberships = await prisma.organizationMember.findMany({
      where: { userId: session?.user?.id ?? '' },
      include: {
        organization: true,
      },
      orderBy: { joinedAt: 'asc' },
    });

    const organizations = memberships?.map?.((m: any) => ({
      id: m?.organization?.id ?? '',
      name: m?.organization?.name ?? '',
      slug: m?.organization?.slug ?? '',
      role: m?.role ?? 'VIEWER',
      joinedAt: m?.joinedAt,
    })) ?? [];

    return NextResponse.json({ organizations });
  } catch (error) {
    console.error('Get organizations error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch organizations' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request?.json?.();
    const { name } = body ?? {};

    if (!name || (name?.trim?.()?.length ?? 0) < 2) {
      return NextResponse.json(
        { error: 'Organization name must be at least 2 characters' },
        { status: 400 }
      );
    }

    const slug = generateSlug(name?.trim?.() ?? '') + '-' + Date.now()?.toString?.(36);

    const org = await prisma.organization.create({
      data: {
        name: name?.trim?.() ?? '',
        slug,
        members: {
          create: {
            userId: session?.user?.id ?? '',
            role: 'OWNER',
          },
        },
      },
    });

    const ipAddress = getClientIP(request);

    await createAuditLog({
      orgId: org?.id,
      userId: session?.user?.id,
      action: 'org.create',
      resourceType: 'organization',
      resourceId: org?.id,
      details: { name: org?.name, slug: org?.slug },
      ipAddress,
    });

    return NextResponse.json({
      success: true,
      organization: {
        id: org?.id ?? '',
        name: org?.name ?? '',
        slug: org?.slug ?? '',
      },
    });
  } catch (error) {
    console.error('Create organization error:', error);
    return NextResponse.json(
      { error: 'Failed to create organization' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id || !session?.user?.currentOrgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const membership = await prisma.organizationMember.findUnique({
      where: {
        orgId_userId: {
          orgId: session?.user?.currentOrgId ?? '',
          userId: session?.user?.id ?? '',
        },
      },
    });

    if (!membership || !['OWNER', 'ADMIN']?.includes?.(membership?.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request?.json?.();
    const { name, slug: newSlug } = body ?? {};

    const currentOrg = await prisma.organization.findUnique({
      where: { id: session?.user?.currentOrgId ?? '' },
    });

    const updateData: { name?: string; slug?: string } = {};
    
    if (name && name !== currentOrg?.name) {
      updateData.name = name?.trim?.() ?? '';
    }
    
    if (newSlug && newSlug !== currentOrg?.slug) {
      const existingSlug = await prisma.organization.findUnique({
        where: { slug: newSlug },
      });
      if (existingSlug) {
        return NextResponse.json(
          { error: 'This slug is already taken' },
          { status: 400 }
        );
      }
      updateData.slug = generateSlug(newSlug);
    }

    if (Object.keys(updateData ?? {})?.length === 0) {
      return NextResponse.json({ success: true, organization: currentOrg });
    }

    const org = await prisma.organization.update({
      where: { id: session?.user?.currentOrgId ?? '' },
      data: updateData,
    });

    const ipAddress = getClientIP(request);

    await createAuditLog({
      orgId: org?.id,
      userId: session?.user?.id,
      action: 'org.update',
      resourceType: 'organization',
      resourceId: org?.id,
      details: {
        before: { name: currentOrg?.name, slug: currentOrg?.slug },
        after: { name: org?.name, slug: org?.slug },
      },
      ipAddress,
    });

    return NextResponse.json({
      success: true,
      organization: {
        id: org?.id ?? '',
        name: org?.name ?? '',
        slug: org?.slug ?? '',
      },
    });
  } catch (error) {
    console.error('Update organization error:', error);
    return NextResponse.json(
      { error: 'Failed to update organization' },
      { status: 500 }
    );
  }
}
