import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

// GET /api/recommendations - Get recommendations for the organization
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('orgId');
    const category = searchParams.get('category');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '20');

    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID required' }, { status: 400 });
    }

    // Check user has access to org
    const member = await prisma.organizationMember.findFirst({
      where: {
        orgId,
        user: { email: session.user.email }
      }
    });

    if (!member) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const where: Record<string, unknown> = { orgId };
    if (category) where.category = category;
    if (status) where.status = status;
    else where.status = 'PENDING'; // Default to pending

    const recommendations = await prisma.recommendation.findMany({
      where,
      orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });

    const counts = await prisma.recommendation.groupBy({
      by: ['category'],
      where: { orgId, status: 'PENDING' },
      _count: true,
    });

    return NextResponse.json({ recommendations, counts });
  } catch (error) {
    console.error('Error fetching recommendations:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/recommendations - Create a new recommendation (internal use)
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { orgId, category, title, description, impact, suggestedAction, resourceType, resourceId, confidence, expiresAt } = body;

    if (!orgId || !category || !title || !description) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Check user has appropriate role
    const member = await prisma.organizationMember.findFirst({
      where: {
        orgId,
        user: { email: session.user.email },
        role: { in: ['OWNER', 'ADMIN'] }
      }
    });

    if (!member) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const recommendation = await prisma.recommendation.create({
      data: {
        orgId,
        category,
        title,
        description,
        impact,
        suggestedAction: suggestedAction || {},
        resourceType,
        resourceId,
        confidence: confidence || 0.8,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      }
    });

    return NextResponse.json({ recommendation });
  } catch (error) {
    console.error('Error creating recommendation:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
