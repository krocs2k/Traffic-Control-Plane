import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const metrics = await prisma.experimentMetric.findMany({
      where: { experimentId: id },
      include: { variant: true },
      orderBy: { recordedAt: 'desc' },
      take: 500,
    });

    return NextResponse.json(metrics);
  } catch (error) {
    console.error('Error fetching experiment metrics:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
