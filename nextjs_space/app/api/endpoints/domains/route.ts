import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// Internal API for fetching custom domain mappings (used by middleware)
export async function GET(request: NextRequest) {
  // Check if this is an internal request from middleware
  const isInternal = request.headers.get('X-Internal-Request') === 'true';
  
  // For security, only allow internal requests or authenticated users
  if (!isInternal) {
    // Could add auth check here if needed
  }

  try {
    const endpoints = await prisma.trafficEndpoint.findMany({
      where: {
        isActive: true,
        customDomain: {
          not: null,
        },
      },
      select: {
        slug: true,
        customDomain: true,
      },
    });

    return NextResponse.json({
      mappings: endpoints.map(e => ({
        customDomain: e.customDomain,
        slug: e.slug,
      })),
    });
  } catch (error) {
    console.error('Error fetching domain mappings:', error);
    return NextResponse.json({ mappings: [] });
  }
}
