import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';

const SYSTEM_PROMPT = `You are a traffic management and infrastructure optimization expert. Analyze the provided infrastructure configuration and generate actionable recommendations.

For each recommendation, provide:
1. A clear, concise title
2. A detailed description of the issue or optimization opportunity
3. The expected impact (performance improvement, cost savings, reliability increase, etc.)
4. A confidence score (0.0 to 1.0) based on how certain you are about the recommendation
5. The category: PERFORMANCE, RELIABILITY, COST, SECURITY, or CONFIGURATION

Focus on:
- Backend health and load balancing optimization
- Routing policy efficiency and potential conflicts
- Read replica lag issues and regional distribution
- Security best practices
- Resource utilization patterns

Respond in JSON format with an array of recommendations:
{
  "recommendations": [
    {
      "category": "PERFORMANCE|RELIABILITY|COST|SECURITY|CONFIGURATION",
      "title": "Short descriptive title",
      "description": "Detailed explanation of the recommendation",
      "impact": "Expected impact or benefit",
      "confidence": 0.85,
      "resourceType": "backend|replica|policy|cluster|null",
      "resourceId": "id or null",
      "suggestedAction": { "type": "action_type", "details": {} }
    }
  ]
}

Generate 3-7 relevant recommendations based on the analysis. Be specific and actionable.`;

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { orgId } = body;

    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID required' }, { status: 400 });
    }

    // Check user has appropriate role
    const member = await prisma.organizationMember.findFirst({
      where: {
        orgId,
        user: { email: session.user.email },
        role: { in: ['OWNER', 'ADMIN', 'OPERATOR'] }
      }
    });

    if (!member) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Gather current infrastructure state
    const [clusters, backends, policies, replicas, recentNotifications] = await Promise.all([
      prisma.backendCluster.findMany({
        where: { orgId },
        include: { backends: true }
      }),
      prisma.backend.findMany({
        where: { cluster: { orgId } },
        include: { cluster: true }
      }),
      prisma.routingPolicy.findMany({ where: { orgId } }),
      prisma.readReplica.findMany({
        where: { orgId },
        include: { lagMetrics: { take: 10, orderBy: { recordedAt: 'desc' } } }
      }),
      prisma.notification.findMany({
        where: { orgId, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        take: 20,
        orderBy: { createdAt: 'desc' }
      })
    ]);

    // Build context for AI
    const infraContext = {
      summary: {
        totalClusters: clusters.length,
        totalBackends: backends.length,
        healthyBackends: backends.filter(b => b.status === 'HEALTHY').length,
        unhealthyBackends: backends.filter(b => b.status === 'UNHEALTHY').length,
        drainingBackends: backends.filter(b => b.status === 'DRAINING').length,
        totalPolicies: policies.length,
        activePolicies: policies.filter(p => p.isActive).length,
        totalReplicas: replicas.length,
        syncedReplicas: replicas.filter(r => r.status === 'SYNCED').length,
        laggingReplicas: replicas.filter(r => r.status === 'LAGGING' || r.status === 'CATCHING_UP').length,
        offlineReplicas: replicas.filter(r => r.status === 'OFFLINE').length,
        recentAlerts: recentNotifications.filter(n => n.severity === 'ERROR' || n.severity === 'CRITICAL').length,
      },
      clusters: clusters.map(c => ({
        id: c.id,
        name: c.name,
        strategy: c.strategy,
        isActive: c.isActive,
        backendCount: c.backends.length,
        healthyCount: c.backends.filter(b => b.status === 'HEALTHY').length,
      })),
      backends: backends.map(b => ({
        id: b.id,
        name: b.name,
        clusterName: b.cluster.name,
        status: b.status,
        weight: b.weight,
        currentConnections: b.currentConnections,
        maxConnections: b.maxConnections,
      })),
      policies: policies.map(p => ({
        id: p.id,
        name: p.name,
        type: p.type,
        priority: p.priority,
        isActive: p.isActive,
        conditionsCount: Array.isArray(p.conditions) ? (p.conditions as unknown[]).length : 0,
      })),
      replicas: replicas.map(r => ({
        id: r.id,
        name: r.name,
        region: r.region,
        status: r.status,
        currentLagMs: r.currentLagMs,
        maxAcceptableLagMs: r.maxAcceptableLagMs,
        isOverLagThreshold: r.currentLagMs > r.maxAcceptableLagMs,
        avgRecentLag: r.lagMetrics.length > 0 ? Math.round(r.lagMetrics.reduce((a, m) => a + m.lagMs, 0) / r.lagMetrics.length) : null,
      })),
      recentIssues: recentNotifications.slice(0, 10).map(n => ({
        type: n.type,
        severity: n.severity,
        title: n.title,
        createdAt: n.createdAt,
      })),
    };

    // Use configurable LLM API endpoint (OpenAI-compatible)
    const llmBaseUrl = process.env.LLM_API_BASE_URL || 'https://api.openai.com/v1';
    const llmApiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
    const llmModel = process.env.LLM_MODEL || 'gpt-4o-mini';

    if (!llmApiKey) {
      return NextResponse.json({ error: 'LLM API key not configured' }, { status: 500 });
    }

    const response = await fetch(`${llmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${llmApiKey}`
      },
      body: JSON.stringify({
        model: llmModel,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Analyze this infrastructure configuration and generate recommendations:\n\n${JSON.stringify(infraContext, null, 2)}` }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('LLM API error:', error);
      return NextResponse.json({ error: 'Failed to generate recommendations' }, { status: 500 });
    }

    const llmResult = await response.json();
    const content = llmResult.choices?.[0]?.message?.content;
    
    let recommendations: Array<{
      category: string;
      title: string;
      description: string;
      impact?: string;
      confidence?: number;
      resourceType?: string;
      resourceId?: string;
      suggestedAction?: Prisma.InputJsonValue;
    }> = [];
    
    try {
      const parsed = JSON.parse(content);
      recommendations = parsed.recommendations || [];
    } catch (e) {
      console.error('Failed to parse LLM response:', e);
      return NextResponse.json({ error: 'Failed to parse recommendations' }, { status: 500 });
    }

    // Store recommendations in database
    const createdRecommendations = await Promise.all(
      recommendations.map(rec =>
        prisma.recommendation.create({
          data: {
            orgId,
            category: rec.category as 'PERFORMANCE' | 'RELIABILITY' | 'COST' | 'SECURITY' | 'CONFIGURATION',
            title: rec.title,
            description: rec.description,
            impact: rec.impact || null,
            confidence: rec.confidence || 0.8,
            resourceType: rec.resourceType || null,
            resourceId: rec.resourceId || null,
            suggestedAction: rec.suggestedAction || {},
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Expire in 7 days
          }
        })
      )
    );

    return NextResponse.json({ 
      recommendations: createdRecommendations,
      context: infraContext.summary 
    });
  } catch (error) {
    console.error('Error generating recommendations:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
