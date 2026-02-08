import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { createAuditLog, getClientIP } from '@/lib/audit';

// Generate a unique slug
function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30);
  const suffix = Math.random().toString(36).substring(2, 8);
  return `${base}-${suffix}`;
}

// GET /api/endpoints - List all endpoints for the org
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: {
        memberships: {
          include: { organization: true }
        }
      }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const orgIds = user.memberships.map(m => m.orgId);

    const endpoints = await prisma.trafficEndpoint.findMany({
      where: { orgId: { in: orgIds } },
      orderBy: { createdAt: 'desc' }
    });

    // Fetch related cluster and policy info
    const clusterIds = endpoints.map(e => e.clusterId).filter(Boolean) as string[];
    const policyIds = endpoints.map(e => e.policyId).filter(Boolean) as string[];

    const [clusters, policies] = await Promise.all([
      prisma.backendCluster.findMany({
        where: { id: { in: clusterIds } },
        select: { id: true, name: true, strategy: true }
      }),
      prisma.routingPolicy.findMany({
        where: { id: { in: policyIds } },
        select: { id: true, name: true, type: true }
      })
    ]);

    const clusterMap = new Map(clusters.map(c => [c.id, c]));
    const policyMap = new Map(policies.map(p => [p.id, p]));

    const endpointsWithRelations = endpoints.map(e => ({
      ...e,
      totalRequests: Number(e.totalRequests),
      totalErrors: Number(e.totalErrors),
      cluster: e.clusterId ? clusterMap.get(e.clusterId) : null,
      policy: e.policyId ? policyMap.get(e.policyId) : null
    }));

    return NextResponse.json(endpointsWithRelations);
  } catch (error) {
    console.error('Error fetching endpoints:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/endpoints - Create a new endpoint
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: {
        memberships: {
          where: { role: { in: ['OWNER', 'ADMIN', 'OPERATOR'] } }
        }
      }
    });

    if (!user || user.memberships.length === 0) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const {
      name,
      description,
      type,
      clusterId,
      policyId,
      config,
      orgId,
      customDomain,
      proxyMode,
      sessionAffinity,
      affinityCookieName,
      affinityHeaderName,
      affinityTtlSeconds,
      connectTimeout,
      readTimeout,
      writeTimeout,
      rewriteHostHeader,
      rewriteLocationHeader,
      rewriteCookieDomain,
      rewriteCorsHeaders,
      preserveHostHeader,
      stripPathPrefix,
      addPathPrefix,
      websocketEnabled,
    } = body;

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    // Use provided orgId or default to first membership
    const targetOrgId = orgId || user.memberships[0]?.orgId;
    if (!targetOrgId) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 400 });
    }

    // Verify user has access to the org
    const hasMembership = user.memberships.some(m => m.orgId === targetOrgId);
    if (!hasMembership) {
      return NextResponse.json({ error: 'Access denied to organization' }, { status: 403 });
    }

    // Check if custom domain is already in use
    if (customDomain) {
      const existingDomain = await prisma.trafficEndpoint.findUnique({
        where: { customDomain }
      });
      if (existingDomain) {
        return NextResponse.json({ error: 'Custom domain is already in use' }, { status: 400 });
      }
    }

    // Generate unique slug
    let slug = generateSlug(name);
    let slugExists = await prisma.trafficEndpoint.findUnique({ where: { slug } });
    while (slugExists) {
      slug = generateSlug(name);
      slugExists = await prisma.trafficEndpoint.findUnique({ where: { slug } });
    }

    const endpoint = await prisma.trafficEndpoint.create({
      data: {
        orgId: targetOrgId,
        name,
        slug,
        description: description || null,
        type: type || 'LOAD_BALANCE',
        clusterId: clusterId || null,
        policyId: policyId || null,
        config: config || {},
        isActive: true,
        customDomain: customDomain || null,
        proxyMode: proxyMode || 'REVERSE_PROXY',
        sessionAffinity: sessionAffinity || 'NONE',
        affinityCookieName: affinityCookieName || '_tcp_affinity',
        affinityHeaderName: affinityHeaderName || null,
        affinityTtlSeconds: affinityTtlSeconds ?? 3600,
        connectTimeout: connectTimeout ?? 5000,
        readTimeout: readTimeout ?? 30000,
        writeTimeout: writeTimeout ?? 30000,
        rewriteHostHeader: rewriteHostHeader ?? true,
        rewriteLocationHeader: rewriteLocationHeader ?? true,
        rewriteCookieDomain: rewriteCookieDomain ?? true,
        rewriteCorsHeaders: rewriteCorsHeaders ?? true,
        preserveHostHeader: preserveHostHeader ?? false,
        stripPathPrefix: stripPathPrefix || null,
        addPathPrefix: addPathPrefix || null,
        websocketEnabled: websocketEnabled ?? true,
      }
    });

    await createAuditLog({
      orgId: targetOrgId,
      userId: user.id,
      action: 'endpoint.created',
      resourceType: 'endpoint',
      resourceId: endpoint.id,
      details: { name, slug, type, proxyMode, sessionAffinity, customDomain },
      ipAddress: getClientIP(request)
    });

    return NextResponse.json({
      ...endpoint,
      totalRequests: Number(endpoint.totalRequests),
      totalErrors: Number(endpoint.totalErrors)
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating endpoint:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
