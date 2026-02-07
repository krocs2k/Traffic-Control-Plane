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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    const experiment = await prisma.experiment.findUnique({
      where: { id },
      include: { variants: true },
    });

    if (!experiment) {
      return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
    }

    // Generate sample metrics for each variant
    const metricsToCreate = [];
    for (const variant of experiment.variants) {
      const baseLatency = variant.isControl ? 45 : 35 + Math.random() * 20;
      const baseErrorRate = variant.isControl ? 0.02 : 0.01 + Math.random() * 0.015;
      
      metricsToCreate.push({
        experimentId: id,
        variantId: variant.id,
        requestCount: Math.floor(1000 + Math.random() * 5000),
        errorCount: Math.floor((1000 + Math.random() * 5000) * baseErrorRate),
        avgLatencyMs: baseLatency + Math.random() * 10,
        p50LatencyMs: baseLatency * 0.8,
        p95LatencyMs: baseLatency * 1.8,
        p99LatencyMs: baseLatency * 2.5,
        conversionRate: 0.03 + Math.random() * 0.02,
      });
    }

    const createdMetrics = await prisma.experimentMetric.createMany({
      data: metricsToCreate,
    });

    return NextResponse.json({ created: createdMetrics.count });
  } catch (error) {
    console.error('Error generating experiment metrics:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
