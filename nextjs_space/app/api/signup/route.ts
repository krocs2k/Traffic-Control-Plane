export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';
import { generateSlug } from '@/lib/utils';

export async function POST(request: Request) {
  try {
    const body = await request?.json?.();
    const { name, email, password } = body ?? {};

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: 'Name, email, and password are required' },
        { status: 400 }
      );
    }

    if ((password?.length ?? 0) < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }

    const normalizedEmail = email?.toLowerCase?.()?.trim?.() ?? '';

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Create user with a personal organization
    const user = await prisma.user.create({
      data: {
        name: name?.trim?.() ?? '',
        email: normalizedEmail,
        passwordHash,
      },
    });

    // Create a personal organization for the user
    const orgName = `${name?.trim?.() ?? 'My'}'s Organization`;
    const org = await prisma.organization.create({
      data: {
        name: orgName,
        slug: generateSlug(orgName) + '-' + user?.id?.slice?.(0, 6),
        members: {
          create: {
            userId: user?.id ?? '',
            role: 'OWNER',
          },
        },
      },
    });

    const ipAddress = getClientIP(request);

    await createAuditLog({
      orgId: org?.id,
      userId: user?.id,
      action: 'user.register',
      resourceType: 'user',
      resourceId: user?.id,
      details: { email: normalizedEmail },
      ipAddress,
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user?.id ?? '',
        email: user?.email ?? '',
        name: user?.name ?? '',
      },
    });
  } catch (error) {
    console.error('Signup error:', error);
    return NextResponse.json(
      { error: 'Failed to create account' },
      { status: 500 }
    );
  }
}
