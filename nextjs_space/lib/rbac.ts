import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from './auth-options';
import { prisma } from './db';
import { Role } from '@prisma/client';
import { hasPermission } from './types';

export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  orgId: string;
  orgRole: Role;
}

export async function requireAuth(): Promise<AuthContext | NextResponse> {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!session?.user?.currentOrgId || !session?.user?.currentOrgRole) {
    return NextResponse.json({ error: 'No organization selected' }, { status: 400 });
  }

  return {
    userId: session?.user?.id ?? '',
    email: session?.user?.email ?? '',
    name: session?.user?.name ?? '',
    orgId: session?.user?.currentOrgId ?? '',
    orgRole: session?.user?.currentOrgRole ?? 'VIEWER',
  };
}

export async function requirePermission(permission: string): Promise<AuthContext | NextResponse> {
  const auth = await requireAuth();
  
  if (auth instanceof NextResponse) {
    return auth;
  }

  if (!hasPermission(auth?.orgRole, permission)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return auth;
}

export async function requireRole(roles: Role[]): Promise<AuthContext | NextResponse> {
  const auth = await requireAuth();
  
  if (auth instanceof NextResponse) {
    return auth;
  }

  if (!roles?.includes?.(auth?.orgRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return auth;
}

export async function requireOrgMembership(orgId: string, userId: string): Promise<{ role: Role } | null> {
  const membership = await prisma.organizationMember.findUnique({
    where: {
      orgId_userId: { orgId, userId },
    },
  });
  
  if (!membership) return null;
  return { role: membership?.role ?? 'VIEWER' };
}
