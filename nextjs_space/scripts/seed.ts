import { PrismaClient, Role, BackendStatus, LoadBalancerStrategy, RoutingPolicyType, ReplicaStatus, NotificationType, NotificationSeverity, RecommendationCategory, RecommendationStatus, CircuitBreakerState, RateLimitType, HealthCheckStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create password hash for demo users
  const passwordHash = await bcrypt.hash('password123', 12);
  const testPasswordHash = await bcrypt.hash('johndoe123', 12);

  // Create test user first (required for auth testing)
  const testUser = await prisma.user.upsert({
    where: { email: 'john@doe.com' },
    update: {},
    create: {
      email: 'john@doe.com',
      name: 'John Doe',
      passwordHash: testPasswordHash,
      status: 'ACTIVE',
    },
  });
  console.log('Created test user:', testUser.email);

  // Create demo organizations
  const acmeCorp = await prisma.organization.upsert({
    where: { slug: 'acme-corp' },
    update: {},
    create: {
      name: 'Acme Corp',
      slug: 'acme-corp',
      settings: {
        theme: 'dark',
        notifications: true,
      },
    },
  });
  console.log('Created organization:', acmeCorp.name);

  const techStart = await prisma.organization.upsert({
    where: { slug: 'techstart-inc' },
    update: {},
    create: {
      name: 'TechStart Inc',
      slug: 'techstart-inc',
      settings: {
        theme: 'light',
        notifications: true,
      },
    },
  });
  console.log('Created organization:', techStart.name);

  // Create demo users
  const alice = await prisma.user.upsert({
    where: { email: 'alice@acme.com' },
    update: {},
    create: {
      email: 'alice@acme.com',
      name: 'Alice Johnson',
      passwordHash,
      status: 'ACTIVE',
    },
  });

  const bob = await prisma.user.upsert({
    where: { email: 'bob@acme.com' },
    update: {},
    create: {
      email: 'bob@acme.com',
      name: 'Bob Smith',
      passwordHash,
      status: 'ACTIVE',
    },
  });

  const carol = await prisma.user.upsert({
    where: { email: 'carol@techstart.com' },
    update: {},
    create: {
      email: 'carol@techstart.com',
      name: 'Carol Williams',
      passwordHash,
      status: 'ACTIVE',
    },
  });

  const dave = await prisma.user.upsert({
    where: { email: 'dave@techstart.com' },
    update: {},
    create: {
      email: 'dave@techstart.com',
      name: 'Dave Brown',
      passwordHash,
      status: 'ACTIVE',
    },
  });

  const eve = await prisma.user.upsert({
    where: { email: 'eve@external.com' },
    update: {},
    create: {
      email: 'eve@external.com',
      name: 'Eve Davis',
      passwordHash,
      status: 'ACTIVE',
    },
  });

  console.log('Created demo users: Alice, Bob, Carol, Dave, Eve');

  // Create organization memberships
  // Test user is Owner of Acme Corp
  await prisma.organizationMember.upsert({
    where: {
      orgId_userId: {
        orgId: acmeCorp.id,
        userId: testUser.id,
      },
    },
    update: {},
    create: {
      orgId: acmeCorp.id,
      userId: testUser.id,
      role: 'OWNER' as Role,
    },
  });

  // Alice is Admin at Acme Corp
  await prisma.organizationMember.upsert({
    where: {
      orgId_userId: {
        orgId: acmeCorp.id,
        userId: alice.id,
      },
    },
    update: {},
    create: {
      orgId: acmeCorp.id,
      userId: alice.id,
      role: 'ADMIN' as Role,
      invitedById: testUser.id,
    },
  });

  // Bob is Operator at Acme Corp
  await prisma.organizationMember.upsert({
    where: {
      orgId_userId: {
        orgId: acmeCorp.id,
        userId: bob.id,
      },
    },
    update: {},
    create: {
      orgId: acmeCorp.id,
      userId: bob.id,
      role: 'OPERATOR' as Role,
      invitedById: alice.id,
    },
  });

  // Eve is Auditor at Acme Corp
  await prisma.organizationMember.upsert({
    where: {
      orgId_userId: {
        orgId: acmeCorp.id,
        userId: eve.id,
      },
    },
    update: {},
    create: {
      orgId: acmeCorp.id,
      userId: eve.id,
      role: 'AUDITOR' as Role,
      invitedById: testUser.id,
    },
  });

  // Carol is Owner of TechStart Inc
  await prisma.organizationMember.upsert({
    where: {
      orgId_userId: {
        orgId: techStart.id,
        userId: carol.id,
      },
    },
    update: {},
    create: {
      orgId: techStart.id,
      userId: carol.id,
      role: 'OWNER' as Role,
    },
  });

  // Dave is Viewer at TechStart Inc
  await prisma.organizationMember.upsert({
    where: {
      orgId_userId: {
        orgId: techStart.id,
        userId: dave.id,
      },
    },
    update: {},
    create: {
      orgId: techStart.id,
      userId: dave.id,
      role: 'VIEWER' as Role,
      invitedById: carol.id,
    },
  });

  // Test user is also a Viewer at TechStart Inc
  await prisma.organizationMember.upsert({
    where: {
      orgId_userId: {
        orgId: techStart.id,
        userId: testUser.id,
      },
    },
    update: {},
    create: {
      orgId: techStart.id,
      userId: testUser.id,
      role: 'VIEWER' as Role,
      invitedById: carol.id,
    },
  });

  console.log('Created organization memberships');

  // Create some audit logs
  await prisma.auditLog.createMany({
    data: [
      {
        orgId: acmeCorp.id,
        userId: testUser.id,
        action: 'org.create',
        resourceType: 'organization',
        resourceId: acmeCorp.id,
        details: { name: 'Acme Corp' },
      },
      {
        orgId: acmeCorp.id,
        userId: testUser.id,
        action: 'user.invite',
        resourceType: 'organizationInvite',
        details: { email: 'alice@acme.com', role: 'ADMIN' },
      },
      {
        orgId: acmeCorp.id,
        userId: alice.id,
        action: 'user.invite',
        resourceType: 'organizationInvite',
        details: { email: 'bob@acme.com', role: 'OPERATOR' },
      },
      {
        orgId: techStart.id,
        userId: carol.id,
        action: 'org.create',
        resourceType: 'organization',
        resourceId: techStart.id,
        details: { name: 'TechStart Inc' },
      },
    ],
  });

  console.log('Created audit log entries');

  // ============================================
  // Traffic Control Demo Data
  // ============================================

  // Create Backend Clusters for Acme Corp
  const productionCluster = await prisma.backendCluster.upsert({
    where: { orgId_name: { orgId: acmeCorp.id, name: 'production-api' } },
    update: {},
    create: {
      orgId: acmeCorp.id,
      name: 'production-api',
      description: 'Production API servers with round-robin load balancing',
      strategy: LoadBalancerStrategy.ROUND_ROBIN,
      healthCheck: { path: '/health', intervalMs: 30000, timeoutMs: 5000, unhealthyThreshold: 3 },
      isActive: true,
    },
  });

  const canaryCluster = await prisma.backendCluster.upsert({
    where: { orgId_name: { orgId: acmeCorp.id, name: 'canary-api' } },
    update: {},
    create: {
      orgId: acmeCorp.id,
      name: 'canary-api',
      description: 'Canary deployment for testing new releases',
      strategy: LoadBalancerStrategy.WEIGHTED_ROUND_ROBIN,
      healthCheck: { path: '/health', intervalMs: 15000, timeoutMs: 3000, unhealthyThreshold: 2 },
      isActive: true,
    },
  });

  const stagingCluster = await prisma.backendCluster.upsert({
    where: { orgId_name: { orgId: acmeCorp.id, name: 'staging-api' } },
    update: {},
    create: {
      orgId: acmeCorp.id,
      name: 'staging-api',
      description: 'Staging environment for QA testing',
      strategy: LoadBalancerStrategy.LEAST_CONNECTIONS,
      isActive: true,
    },
  });

  console.log('Created backend clusters');

  // Create Backends for Production Cluster
  const backends = [
    { clusterId: productionCluster.id, name: 'prod-api-1', host: 'api-1.acme-prod.internal', port: 443, weight: 100, status: BackendStatus.HEALTHY },
    { clusterId: productionCluster.id, name: 'prod-api-2', host: 'api-2.acme-prod.internal', port: 443, weight: 100, status: BackendStatus.HEALTHY },
    { clusterId: productionCluster.id, name: 'prod-api-3', host: 'api-3.acme-prod.internal', port: 443, weight: 100, status: BackendStatus.HEALTHY },
    { clusterId: productionCluster.id, name: 'prod-api-4', host: 'api-4.acme-prod.internal', port: 443, weight: 50, status: BackendStatus.DRAINING },
    { clusterId: canaryCluster.id, name: 'canary-api-1', host: 'canary-1.acme-prod.internal', port: 443, weight: 100, status: BackendStatus.HEALTHY },
    { clusterId: canaryCluster.id, name: 'canary-api-2', host: 'canary-2.acme-prod.internal', port: 443, weight: 100, status: BackendStatus.HEALTHY },
    { clusterId: stagingCluster.id, name: 'staging-api-1', host: 'api-1.acme-staging.internal', port: 443, weight: 100, status: BackendStatus.HEALTHY },
    { clusterId: stagingCluster.id, name: 'staging-api-2', host: 'api-2.acme-staging.internal', port: 443, weight: 100, status: BackendStatus.MAINTENANCE },
  ];

  for (const backend of backends) {
    await prisma.backend.upsert({
      where: { id: `${backend.clusterId}-${backend.name}` },
      update: { status: backend.status, weight: backend.weight },
      create: {
        clusterId: backend.clusterId,
        name: backend.name,
        host: backend.host,
        port: backend.port,
        protocol: 'https',
        weight: backend.weight,
        status: backend.status,
        healthCheckPath: '/health',
        maxConnections: 1000,
        currentConnections: Math.floor(Math.random() * 200),
        tags: ['production'],
        isActive: true,
      },
    });
  }

  console.log('Created backends');

  // Create Routing Policies for Acme Corp
  const policies = [
    {
      orgId: acmeCorp.id,
      name: 'canary-release-v2',
      description: 'Route 10% of traffic to canary for v2.0 release testing',
      type: RoutingPolicyType.CANARY,
      priority: 10,
      clusterId: canaryCluster.id,
      conditions: [{ type: 'percentage', operator: 'lt', value: 10 }],
      actions: { type: 'route', target: 'canary-api' },
      isActive: true,
    },
    {
      orgId: acmeCorp.id,
      name: 'beta-users',
      description: 'Route beta users to canary based on header',
      type: RoutingPolicyType.HEADER_BASED,
      priority: 5,
      clusterId: canaryCluster.id,
      conditions: [{ type: 'header', key: 'X-Beta-User', operator: 'equals', value: 'true' }],
      actions: { type: 'route', target: 'canary-api' },
      isActive: true,
    },
    {
      orgId: acmeCorp.id,
      name: 'geo-routing-eu',
      description: 'Route EU traffic to EU backends',
      type: RoutingPolicyType.GEOGRAPHIC,
      priority: 20,
      clusterId: productionCluster.id,
      conditions: [{ type: 'geo', key: 'region', operator: 'in', value: ['EU', 'Europe'] }],
      actions: { type: 'route', addHeaders: { 'X-Region': 'EU' } },
      isActive: true,
    },
    {
      orgId: acmeCorp.id,
      name: 'api-v1-routing',
      description: 'Route /api/v1/* paths to production',
      type: RoutingPolicyType.PATH_BASED,
      priority: 50,
      clusterId: productionCluster.id,
      conditions: [{ type: 'path', operator: 'regex', value: '^/api/v1/.*' }],
      actions: { type: 'route', target: 'production-api' },
      isActive: true,
    },
    {
      orgId: acmeCorp.id,
      name: 'failover-policy',
      description: 'Automatic failover to backup cluster',
      type: RoutingPolicyType.FAILOVER,
      priority: 100,
      clusterId: productionCluster.id,
      conditions: [],
      actions: { type: 'failover', primary: 'production-api', backup: 'staging-api' },
      isActive: false,
    },
    {
      orgId: acmeCorp.id,
      name: 'weighted-ab-test',
      description: '80/20 A/B test split',
      type: RoutingPolicyType.WEIGHTED,
      priority: 30,
      clusterId: productionCluster.id,
      conditions: [{ type: 'header', key: 'X-AB-Test', operator: 'equals', value: 'enabled' }],
      actions: { type: 'weighted', weights: { A: 80, B: 20 } },
      isActive: true,
    },
  ];

  for (const policy of policies) {
    await prisma.routingPolicy.upsert({
      where: { orgId_name: { orgId: policy.orgId, name: policy.name } },
      update: { isActive: policy.isActive, priority: policy.priority },
      create: policy,
    });
  }

  console.log('Created routing policies');

  // Create Read Replicas for Acme Corp
  const replicas = [
    { orgId: acmeCorp.id, name: 'replica-us-east-1', host: 'replica-1.db.acme.internal', port: 5432, region: 'us-east-1', maxAcceptableLagMs: 1000, currentLagMs: 45, status: ReplicaStatus.SYNCED },
    { orgId: acmeCorp.id, name: 'replica-us-west-2', host: 'replica-2.db.acme.internal', port: 5432, region: 'us-west-2', maxAcceptableLagMs: 1000, currentLagMs: 120, status: ReplicaStatus.SYNCED },
    { orgId: acmeCorp.id, name: 'replica-eu-west-1', host: 'replica-3.db.acme.internal', port: 5432, region: 'eu-west-1', maxAcceptableLagMs: 2000, currentLagMs: 850, status: ReplicaStatus.LAGGING },
    { orgId: acmeCorp.id, name: 'replica-ap-southeast-1', host: 'replica-4.db.acme.internal', port: 5432, region: 'ap-southeast-1', maxAcceptableLagMs: 3000, currentLagMs: 2100, status: ReplicaStatus.CATCHING_UP },
  ];

  for (const replica of replicas) {
    const created = await prisma.readReplica.upsert({
      where: { orgId_name: { orgId: replica.orgId, name: replica.name } },
      update: { currentLagMs: replica.currentLagMs, status: replica.status },
      create: {
        ...replica,
        lastHealthCheck: new Date(),
        isActive: true,
      },
    });

    // Add some lag metrics history
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      await prisma.lagMetric.create({
        data: {
          replicaId: created.id,
          lagMs: replica.currentLagMs + Math.floor(Math.random() * 100) - 50,
          recordedAt: new Date(now - i * 60000), // Every minute for last 10 mins
        },
      });
    }
  }

  console.log('Created read replicas with lag metrics');

  // Add more audit logs for traffic control actions
  await prisma.auditLog.createMany({
    data: [
      {
        orgId: acmeCorp.id,
        userId: testUser.id,
        action: 'backend_cluster.create',
        resourceType: 'backend_cluster',
        resourceId: productionCluster.id,
        details: { name: 'production-api', strategy: 'ROUND_ROBIN' },
      },
      {
        orgId: acmeCorp.id,
        userId: alice.id,
        action: 'routing_policy.create',
        resourceType: 'routing_policy',
        details: { name: 'canary-release-v2', type: 'CANARY' },
      },
      {
        orgId: acmeCorp.id,
        userId: bob.id,
        action: 'backend.update',
        resourceType: 'backend',
        details: { name: 'prod-api-4', status: 'DRAINING' },
      },
      {
        orgId: acmeCorp.id,
        userId: alice.id,
        action: 'read_replica.create',
        resourceType: 'read_replica',
        details: { name: 'replica-us-east-1', region: 'us-east-1' },
      },
    ],
  });

  // Create Notifications
  console.log('Creating notifications...');
  await prisma.notification.deleteMany({ where: { orgId: acmeCorp.id } });
  await prisma.notification.createMany({
    data: [
      {
        orgId: acmeCorp.id,
        type: 'BACKEND_HEALTH',
        severity: 'WARNING',
        title: 'Backend Server High Latency',
        message: 'prod-api-2 is experiencing higher than normal latency (250ms avg). Consider investigating or scaling.',
        resourceType: 'backend',
        isRead: false,
      },
      {
        orgId: acmeCorp.id,
        type: 'REPLICA_LAG',
        severity: 'ERROR',
        title: 'Read Replica Lagging',
        message: 'replica-eu-west-1 has exceeded the maximum acceptable lag threshold (1500ms > 1000ms).',
        resourceType: 'replica',
        isRead: false,
      },
      {
        orgId: acmeCorp.id,
        type: 'POLICY_CHANGE',
        severity: 'INFO',
        title: 'Routing Policy Updated',
        message: 'The canary-release-v2 routing policy was updated by alice@acme.com.',
        resourceType: 'policy',
        isRead: true,
      },
      {
        orgId: acmeCorp.id,
        type: 'SECURITY',
        severity: 'WARNING',
        title: 'Multiple Failed Login Attempts',
        message: 'Detected 5 failed login attempts for user bob@acme.com from IP 192.168.1.100.',
        resourceType: 'user',
        isRead: false,
      },
      {
        orgId: acmeCorp.id,
        type: 'SYSTEM',
        severity: 'INFO',
        title: 'Scheduled Maintenance',
        message: 'System maintenance scheduled for Saturday 2AM-4AM UTC. Expect brief interruptions.',
        isRead: true,
      },
      {
        orgId: acmeCorp.id,
        type: 'BACKEND_HEALTH',
        severity: 'CRITICAL',
        title: 'Backend Server Offline',
        message: 'prod-api-4 has failed health checks and is marked as DRAINING. Traffic is being rerouted.',
        resourceType: 'backend',
        isRead: false,
      },
    ],
  });

  // Create Recommendations
  console.log('Creating recommendations...');
  await prisma.recommendation.deleteMany({ where: { orgId: acmeCorp.id } });
  await prisma.recommendation.createMany({
    data: [
      {
        orgId: acmeCorp.id,
        category: 'PERFORMANCE',
        title: 'Enable Connection Pooling',
        description: 'Your backend servers are handling a high number of short-lived connections. Enabling connection pooling could reduce overhead and improve response times by 15-20%.',
        impact: 'Potential 15-20% latency reduction',
        confidence: 0.85,
        resourceType: 'cluster',
        suggestedAction: { type: 'enable_pooling', maxConnections: 100 },
        status: 'PENDING',
      },
      {
        orgId: acmeCorp.id,
        category: 'RELIABILITY',
        title: 'Add Read Replica in Asia Pacific',
        description: 'Traffic analysis shows increasing requests from APAC region. Adding a read replica in ap-northeast-1 would reduce latency for 23% of your read traffic.',
        impact: 'Reduce APAC read latency by 60%',
        confidence: 0.92,
        resourceType: 'replica',
        suggestedAction: { type: 'create_replica', region: 'ap-northeast-1' },
        status: 'PENDING',
      },
      {
        orgId: acmeCorp.id,
        category: 'COST',
        title: 'Consolidate Staging Backends',
        description: 'The staging-api cluster has 3 backends but averages only 5% utilization. Consider reducing to 1 backend to save resources.',
        impact: 'Estimated 66% cost reduction for staging',
        confidence: 0.78,
        resourceType: 'cluster',
        suggestedAction: { type: 'scale_down', targetCount: 1 },
        status: 'PENDING',
      },
      {
        orgId: acmeCorp.id,
        category: 'CONFIGURATION',
        title: 'Optimize Health Check Intervals',
        description: 'Current health check interval (30s) may be too slow to detect failures promptly. Consider reducing to 10s for production backends.',
        impact: 'Faster failure detection',
        confidence: 0.88,
        resourceType: 'cluster',
        suggestedAction: { type: 'update_health_check', intervalMs: 10000 },
        status: 'PENDING',
      },
      {
        orgId: acmeCorp.id,
        category: 'SECURITY',
        title: 'Enable Rate Limiting on API Routes',
        description: 'Your path-based routing policy /api/v1 lacks rate limiting. This could expose your service to abuse or DDoS attacks.',
        impact: 'Improved security posture',
        confidence: 0.95,
        resourceType: 'policy',
        suggestedAction: { type: 'add_rate_limit', requests: 100, window: '1m' },
        status: 'PENDING',
      },
    ],
  });

  // Get all backends for circuit breakers
  const allBackends = await prisma.backend.findMany({
    where: { cluster: { orgId: acmeCorp.id } },
  });

  // Create Circuit Breakers
  console.log('Creating circuit breakers...');
  const circuitBreakers = await Promise.all([
    prisma.circuitBreaker.upsert({
      where: { orgId_name: { orgId: acmeCorp.id, name: 'API Gateway Breaker' } },
      update: {},
      create: {
        orgId: acmeCorp.id,
        name: 'API Gateway Breaker',
        targetType: 'backend',
        targetId: allBackends[0]?.id || 'backend-1',
        state: 'CLOSED',
        failureThreshold: 5,
        successThreshold: 3,
        timeoutMs: 30000,
        halfOpenMaxRequests: 3,
        failureCount: 0,
        successCount: 0,
        isActive: true,
      },
    }),
    prisma.circuitBreaker.upsert({
      where: { orgId_name: { orgId: acmeCorp.id, name: 'Payment Service Breaker' } },
      update: {},
      create: {
        orgId: acmeCorp.id,
        name: 'Payment Service Breaker',
        targetType: 'backend',
        targetId: allBackends[1]?.id || 'backend-2',
        state: 'CLOSED',
        failureThreshold: 3,
        successThreshold: 2,
        timeoutMs: 15000,
        halfOpenMaxRequests: 2,
        failureCount: 1,
        successCount: 5,
        isActive: true,
      },
    }),
    prisma.circuitBreaker.upsert({
      where: { orgId_name: { orgId: acmeCorp.id, name: 'Legacy System Breaker' } },
      update: {},
      create: {
        orgId: acmeCorp.id,
        name: 'Legacy System Breaker',
        targetType: 'backend',
        targetId: allBackends[2]?.id || 'backend-3',
        state: 'HALF_OPEN',
        failureThreshold: 10,
        successThreshold: 5,
        timeoutMs: 60000,
        halfOpenMaxRequests: 5,
        failureCount: 8,
        successCount: 2,
        lastStateChange: new Date(Date.now() - 5 * 60 * 1000),
        isActive: true,
      },
    }),
  ]);
  console.log(`Created ${circuitBreakers.length} circuit breakers`);

  // Create Rate Limit Rules
  console.log('Creating rate limit rules...');
  const rateLimits = await Promise.all([
    prisma.rateLimitRule.upsert({
      where: { orgId_name: { orgId: acmeCorp.id, name: 'Global API Rate Limit' } },
      update: {},
      create: {
        orgId: acmeCorp.id,
        name: 'Global API Rate Limit',
        description: 'Default rate limit for all API requests',
        type: 'REQUESTS_PER_MINUTE',
        limit: 1000,
        windowMs: 60000,
        burstLimit: 1200,
        scope: 'global',
        action: 'reject',
        isActive: true,
        priority: 100,
      },
    }),
    prisma.rateLimitRule.upsert({
      where: { orgId_name: { orgId: acmeCorp.id, name: 'Per-IP Rate Limit' } },
      update: {},
      create: {
        orgId: acmeCorp.id,
        name: 'Per-IP Rate Limit',
        description: 'Rate limit per IP address to prevent abuse',
        type: 'REQUESTS_PER_MINUTE',
        limit: 100,
        windowMs: 60000,
        burstLimit: 150,
        scope: 'ip',
        action: 'reject',
        isActive: true,
        priority: 50,
      },
    }),
    prisma.rateLimitRule.upsert({
      where: { orgId_name: { orgId: acmeCorp.id, name: 'Auth Endpoint Limit' } },
      update: {},
      create: {
        orgId: acmeCorp.id,
        name: 'Auth Endpoint Limit',
        description: 'Stricter rate limit for authentication endpoints',
        type: 'REQUESTS_PER_MINUTE',
        limit: 10,
        windowMs: 60000,
        scope: 'ip',
        matchConditions: [{ path: '/api/auth/*' }],
        action: 'reject',
        isActive: true,
        priority: 10,
      },
    }),
    prisma.rateLimitRule.upsert({
      where: { orgId_name: { orgId: acmeCorp.id, name: 'High Traffic Route' } },
      update: {},
      create: {
        orgId: acmeCorp.id,
        name: 'High Traffic Route',
        description: 'Higher limits for high-traffic public endpoints',
        type: 'REQUESTS_PER_SECOND',
        limit: 500,
        windowMs: 1000,
        burstLimit: 750,
        scope: 'route',
        matchConditions: [{ path: '/api/public/*' }],
        action: 'throttle',
        isActive: true,
        priority: 75,
      },
    }),
  ]);
  console.log(`Created ${rateLimits.length} rate limit rules`);

  // Create sample Health Checks
  console.log('Creating sample health checks...');
  const healthCheckData: Array<{
    backendId?: string;
    replicaId?: string;
    endpoint: string;
    status: HealthCheckStatus;
    responseTime: number;
    statusCode: number;
    errorMessage: string | null;
    checkedAt: Date;
  }> = [];
  const healthStatuses: HealthCheckStatus[] = ['HEALTHY', 'HEALTHY', 'HEALTHY', 'DEGRADED', 'UNHEALTHY'];
  
  for (const backend of allBackends) {
    for (let i = 0; i < 5; i++) {
      const status = healthStatuses[Math.floor(Math.random() * healthStatuses.length)];
      const responseTime = status === 'HEALTHY' ? 30 + Math.random() * 70 : 150 + Math.random() * 200;
      
      healthCheckData.push({
        backendId: backend.id,
        endpoint: `https://${backend.host}:${backend.port}/health`,
        status,
        responseTime: Math.floor(responseTime),
        statusCode: status === 'HEALTHY' ? 200 : status === 'DEGRADED' ? 200 : 503,
        errorMessage: status === 'UNHEALTHY' ? 'Connection refused' : null,
        checkedAt: new Date(Date.now() - i * 5 * 60 * 1000),
      });
    }
  }
  
  const allReplicas = await prisma.readReplica.findMany({ where: { orgId: acmeCorp.id } });
  for (const replica of allReplicas) {
    for (let i = 0; i < 3; i++) {
      const status = Math.random() > 0.2 ? 'HEALTHY' : 'UNHEALTHY';
      healthCheckData.push({
        replicaId: replica.id,
        endpoint: `postgres://${replica.host}:${replica.port}`,
        status: status as HealthCheckStatus,
        responseTime: Math.floor(20 + Math.random() * 50),
        statusCode: status === 'HEALTHY' ? 200 : 0,
        errorMessage: null,
        checkedAt: new Date(Date.now() - i * 10 * 60 * 1000),
      });
    }
  }
  
  await prisma.healthCheck.createMany({ data: healthCheckData });
  console.log(`Created ${healthCheckData.length} health check records`);

  // Create sample Traffic Metrics
  console.log('Creating sample traffic metrics...');
  const metricsData: Array<{
    orgId: string;
    clusterId?: string;
    requestCount: number;
    errorCount: number;
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    bytesIn: bigint;
    bytesOut: bigint;
    period: string;
    recordedAt: Date;
  }> = [];
  const clustersList = await prisma.backendCluster.findMany({ where: { orgId: acmeCorp.id } });
  
  // Generate hourly metrics for the last 24 hours
  for (let i = 0; i < 24; i++) {
    const recordedAt = new Date(Date.now() - i * 60 * 60 * 1000);
    const baseRequests = Math.floor(1000 + Math.random() * 4000);
    const errRate = Math.random() * 0.05;
    const avgLatency = 30 + Math.random() * 70;
    
    // Overall org metrics
    metricsData.push({
      orgId: acmeCorp.id,
      requestCount: baseRequests,
      errorCount: Math.floor(baseRequests * errRate),
      avgLatencyMs: avgLatency,
      p50LatencyMs: avgLatency * 0.8,
      p95LatencyMs: avgLatency * 1.5,
      p99LatencyMs: avgLatency * 2.5,
      bytesIn: BigInt(baseRequests * 1024),
      bytesOut: BigInt(baseRequests * 4096),
      period: '1h',
      recordedAt,
    });
    
    // Per-cluster metrics
    for (const cluster of clustersList) {
      const clusterRequests = Math.floor(baseRequests * (0.2 + Math.random() * 0.3));
      metricsData.push({
        orgId: acmeCorp.id,
        clusterId: cluster.id,
        requestCount: clusterRequests,
        errorCount: Math.floor(clusterRequests * Math.random() * 0.03),
        avgLatencyMs: avgLatency * (0.8 + Math.random() * 0.4),
        p50LatencyMs: avgLatency * 0.7,
        p95LatencyMs: avgLatency * 1.4,
        p99LatencyMs: avgLatency * 2.2,
        bytesIn: BigInt(clusterRequests * 1024),
        bytesOut: BigInt(clusterRequests * 4096),
        period: '1h',
        recordedAt,
      });
    }
  }
  
  await prisma.trafficMetric.createMany({ data: metricsData });
  console.log(`Created ${metricsData.length} traffic metric records`);

  // Create metric snapshot
  await prisma.metricSnapshot.create({
    data: {
      orgId: acmeCorp.id,
      totalRequests: BigInt(50000),
      totalErrors: BigInt(1250),
      avgResponseTime: 65.5,
      healthyBackends: allBackends.filter(b => b.status === 'HEALTHY').length,
      unhealthyBackends: allBackends.filter(b => b.status !== 'HEALTHY').length,
      activeConnections: Math.floor(100 + Math.random() * 400),
      requestsPerSecond: 58.3,
      errorRate: 2.5,
    },
  });
  console.log('Created metric snapshot');

  console.log('\nSeeding completed successfully!');
  console.log('\nDemo Organizations:');
  console.log('  - Acme Corp (acme-corp)');
  console.log('  - TechStart Inc (techstart-inc)');
  console.log('\nDemo Users (all passwords: password123):');
  console.log('  - alice@acme.com (Admin at Acme Corp)');
  console.log('  - bob@acme.com (Operator at Acme Corp)');
  console.log('  - carol@techstart.com (Owner at TechStart Inc)');
  console.log('  - dave@techstart.com (Viewer at TechStart Inc)');
  console.log('  - eve@external.com (Auditor at Acme Corp)');
  console.log('\nTraffic Control Demo Data:');
  console.log('  Backend Clusters: production-api, canary-api, staging-api');
  console.log('  Routing Policies: canary-release-v2, beta-users, geo-routing-eu, and more');
  console.log('  Read Replicas: us-east-1, us-west-2, eu-west-1, ap-southeast-1');
  console.log('  Circuit Breakers: API Gateway Breaker, Payment Service Breaker, Legacy System Breaker');
  console.log('  Rate Limits: Global API, Per-IP, Auth Endpoint, High Traffic Route');
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
