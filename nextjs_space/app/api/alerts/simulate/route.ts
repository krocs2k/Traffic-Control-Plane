import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

// Simulate alerts based on active rules
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { memberships: true },
    });

    if (!user || user.memberships.length === 0) {
      return NextResponse.json({ error: 'No organization found' }, { status: 404 });
    }

    const orgId = user.memberships[0].orgId;

    // Get all active rules
    const rules = await prisma.alertRule.findMany({
      where: { orgId, isActive: true },
    });

    const simulatedAlerts = [];

    for (const rule of rules) {
      // Randomly decide if this rule should trigger (30% chance)
      if (Math.random() < 0.3) {
        // Generate a metric value that violates the threshold
        let metricValue: number;
        const threshold = rule.threshold;
        
        switch (rule.condition) {
          case '>':
            metricValue = threshold * (1.1 + Math.random() * 0.5);
            break;
          case '>=':
            metricValue = threshold * (1 + Math.random() * 0.5);
            break;
          case '<':
            metricValue = threshold * (0.5 + Math.random() * 0.4);
            break;
          case '<=':
            metricValue = threshold * (0.4 + Math.random() * 0.5);
            break;
          default:
            metricValue = threshold * 1.2;
        }

        const alert = await prisma.alert.create({
          data: {
            orgId,
            ruleId: rule.id,
            severity: rule.severity,
            title: `${rule.name} - ${rule.metric} threshold exceeded`,
            message: `${rule.metric} is ${metricValue.toFixed(2)} which is ${rule.condition} ${threshold}`,
            metricValue,
            threshold,
            targetType: rule.targetType,
            targetId: rule.targetId,
          },
        });

        simulatedAlerts.push(alert);
      }
    }

    return NextResponse.json({
      message: `Simulated ${simulatedAlerts.length} alerts`,
      alerts: simulatedAlerts,
    });
  } catch (error) {
    console.error('Error simulating alerts:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
