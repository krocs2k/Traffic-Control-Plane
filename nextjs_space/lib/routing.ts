import { Backend, BackendStatus, LoadBalancerStrategy, ReadReplica, ReplicaStatus, RoutingPolicy, RoutingPolicyType } from '@prisma/client';

// ============================================
// Types
// ============================================

export interface RoutingCondition {
  type: 'header' | 'path' | 'query' | 'geo' | 'percentage' | 'time';
  key?: string;
  operator: 'equals' | 'contains' | 'regex' | 'in' | 'not_in' | 'gt' | 'lt' | 'between';
  value: string | string[] | number | number[];
}

export interface RoutingAction {
  type: 'route' | 'redirect' | 'rewrite' | 'rate_limit' | 'add_header' | 'block';
  target?: string;
  weight?: number;
  statusCode?: number;
  headers?: Record<string, string>;
}

export interface RequestContext {
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  clientIp?: string;
  geo?: {
    country?: string;
    region?: string;
    city?: string;
  };
}

export interface RoutingDecision {
  backend?: Backend;
  policy?: RoutingPolicy;
  action: RoutingAction;
  reason: string;
}

export interface LagAwareSelection {
  replica: ReadReplica;
  lagMs: number;
  reason: string;
}

// ============================================
// Routing Policy Evaluation
// ============================================

export function evaluateCondition(condition: RoutingCondition, context: RequestContext): boolean {
  const { type, key, operator, value } = condition;
  let targetValue: string | undefined;

  switch (type) {
    case 'header':
      targetValue = key ? context.headers[key.toLowerCase()] : undefined;
      break;
    case 'path':
      targetValue = context.path;
      break;
    case 'query':
      targetValue = key ? context.query[key] : undefined;
      break;
    case 'geo':
      if (key === 'country') targetValue = context.geo?.country;
      else if (key === 'region') targetValue = context.geo?.region;
      else if (key === 'city') targetValue = context.geo?.city;
      break;
    case 'percentage':
      const roll = Math.random() * 100;
      return roll < (typeof value === 'number' ? value : parseFloat(value as string));
    case 'time':
      const hour = new Date().getHours();
      if (operator === 'between' && Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number') {
        return hour >= value[0] && hour < value[1];
      }
      return false;
  }

  if (targetValue === undefined) return false;

  switch (operator) {
    case 'equals':
      return targetValue === value;
    case 'contains':
      return targetValue.includes(value as string);
    case 'regex':
      try {
        return new RegExp(value as string).test(targetValue);
      } catch {
        return false;
      }
    case 'in':
      return Array.isArray(value) && (value as string[]).includes(targetValue);
    case 'not_in':
      return Array.isArray(value) && !(value as string[]).includes(targetValue);
    case 'gt':
      return parseFloat(targetValue) > (value as number);
    case 'lt':
      return parseFloat(targetValue) < (value as number);
    default:
      return false;
  }
}

export function evaluatePolicy(
  policy: RoutingPolicy,
  context: RequestContext
): boolean {
  const conditions = policy.conditions as unknown as RoutingCondition[];
  
  if (!conditions || !Array.isArray(conditions) || conditions.length === 0) {
    return true; // No conditions means always match
  }

  // All conditions must match (AND logic)
  return conditions.every(condition => evaluateCondition(condition, context));
}

export function selectPolicy(
  policies: RoutingPolicy[],
  context: RequestContext
): RoutingPolicy | null {
  // Sort by priority (lower number = higher priority)
  const sortedPolicies = [...policies]
    .filter(p => p.isActive)
    .sort((a, b) => a.priority - b.priority);

  for (const policy of sortedPolicies) {
    if (evaluatePolicy(policy, context)) {
      return policy;
    }
  }

  return null;
}

// ============================================
// Load Balancing
// ============================================

let roundRobinIndex = 0;

export function selectBackend(
  backends: Backend[],
  strategy: LoadBalancerStrategy,
  clientIp?: string
): Backend | null {
  const healthyBackends = backends.filter(
    b => b.isActive && b.status === BackendStatus.HEALTHY
  );

  if (healthyBackends.length === 0) {
    // Fallback to draining backends if no healthy ones
    const drainingBackends = backends.filter(
      b => b.isActive && b.status === BackendStatus.DRAINING
    );
    if (drainingBackends.length > 0) {
      return drainingBackends[0];
    }
    return null;
  }

  switch (strategy) {
    case LoadBalancerStrategy.ROUND_ROBIN:
      roundRobinIndex = (roundRobinIndex + 1) % healthyBackends.length;
      return healthyBackends[roundRobinIndex];

    case LoadBalancerStrategy.LEAST_CONNECTIONS:
      return healthyBackends.reduce((min, b) => 
        b.currentConnections < min.currentConnections ? b : min
      );

    case LoadBalancerStrategy.RANDOM:
      return healthyBackends[Math.floor(Math.random() * healthyBackends.length)];

    case LoadBalancerStrategy.IP_HASH:
      if (clientIp) {
        const hash = clientIp.split('').reduce((a, b) => {
          a = ((a << 5) - a) + b.charCodeAt(0);
          return a & a;
        }, 0);
        return healthyBackends[Math.abs(hash) % healthyBackends.length];
      }
      return healthyBackends[0];

    case LoadBalancerStrategy.WEIGHTED_ROUND_ROBIN:
      const totalWeight = healthyBackends.reduce((sum, b) => sum + b.weight, 0);
      let random = Math.random() * totalWeight;
      for (const backend of healthyBackends) {
        random -= backend.weight;
        if (random <= 0) {
          return backend;
        }
      }
      return healthyBackends[healthyBackends.length - 1];

    default:
      return healthyBackends[0];
  }
}

// ============================================
// Lag-Aware Read Replica Selection
// ============================================

export function selectReadReplica(
  replicas: ReadReplica[],
  maxAcceptableLagMs?: number,
  preferredRegion?: string
): LagAwareSelection | null {
  // Filter active and healthy replicas
  const availableReplicas = replicas.filter(
    r => r.isActive && r.status !== ReplicaStatus.OFFLINE
  );

  if (availableReplicas.length === 0) {
    return null;
  }

  // Filter by acceptable lag
  const lagThreshold = maxAcceptableLagMs ?? 1000; // Default 1 second
  const lowLagReplicas = availableReplicas.filter(
    r => r.currentLagMs <= lagThreshold && r.status === ReplicaStatus.SYNCED
  );

  // If we have low-lag replicas, prefer them
  if (lowLagReplicas.length > 0) {
    // If preferred region specified, try to find one there
    if (preferredRegion) {
      const regionMatch = lowLagReplicas.find(r => r.region === preferredRegion);
      if (regionMatch) {
        return {
          replica: regionMatch,
          lagMs: regionMatch.currentLagMs,
          reason: `Selected low-lag replica in preferred region: ${preferredRegion}`
        };
      }
    }

    // Otherwise, select the one with lowest lag
    const lowestLag = lowLagReplicas.reduce((min, r) => 
      r.currentLagMs < min.currentLagMs ? r : min
    );
    return {
      replica: lowestLag,
      lagMs: lowestLag.currentLagMs,
      reason: `Selected replica with lowest lag: ${lowestLag.currentLagMs}ms`
    };
  }

  // If no low-lag replicas, check if we have any catching up
  const catchingUpReplicas = availableReplicas.filter(
    r => r.status === ReplicaStatus.CATCHING_UP
  );

  if (catchingUpReplicas.length > 0) {
    // Select one that's closest to being synced
    const closest = catchingUpReplicas.reduce((min, r) => 
      r.currentLagMs < min.currentLagMs ? r : min
    );
    return {
      replica: closest,
      lagMs: closest.currentLagMs,
      reason: `Selected catching-up replica (no synced replicas available)`
    };
  }

  // Last resort: use a lagging replica
  const laggingReplicas = availableReplicas.filter(
    r => r.status === ReplicaStatus.LAGGING
  );

  if (laggingReplicas.length > 0) {
    const best = laggingReplicas.reduce((min, r) => 
      r.currentLagMs < min.currentLagMs ? r : min
    );
    return {
      replica: best,
      lagMs: best.currentLagMs,
      reason: `Warning: Selected lagging replica (${best.currentLagMs}ms lag)`
    };
  }

  return null;
}

// ============================================
// Canary & Blue/Green Deployment Helpers
// ============================================

export interface CanaryConfig {
  stableWeight: number;
  canaryWeight: number;
  stableBackends: string[];
  canaryBackends: string[];
}

export interface BlueGreenConfig {
  activeColor: 'blue' | 'green';
  blueBackends: string[];
  greenBackends: string[];
}

export function selectCanaryBackend(
  backends: Backend[],
  config: CanaryConfig
): { backend: Backend | null; isCanary: boolean } {
  const roll = Math.random() * 100;
  const isCanary = roll < config.canaryWeight;
  
  const targetIds = isCanary ? config.canaryBackends : config.stableBackends;
  const targetBackends = backends.filter(
    b => targetIds.includes(b.id) && b.isActive && b.status === BackendStatus.HEALTHY
  );

  if (targetBackends.length === 0) {
    // Fallback to other set
    const fallbackIds = isCanary ? config.stableBackends : config.canaryBackends;
    const fallbackBackends = backends.filter(
      b => fallbackIds.includes(b.id) && b.isActive && b.status === BackendStatus.HEALTHY
    );
    return {
      backend: fallbackBackends[0] ?? null,
      isCanary: !isCanary
    };
  }

  return {
    backend: targetBackends[Math.floor(Math.random() * targetBackends.length)],
    isCanary
  };
}

export function selectBlueGreenBackend(
  backends: Backend[],
  config: BlueGreenConfig
): Backend | null {
  const activeIds = config.activeColor === 'blue' 
    ? config.blueBackends 
    : config.greenBackends;
  
  const activeBackends = backends.filter(
    b => activeIds.includes(b.id) && b.isActive && b.status === BackendStatus.HEALTHY
  );

  if (activeBackends.length === 0) {
    // Fallback to inactive color
    const fallbackIds = config.activeColor === 'blue' 
      ? config.greenBackends 
      : config.blueBackends;
    const fallbackBackends = backends.filter(
      b => fallbackIds.includes(b.id) && b.isActive && b.status === BackendStatus.HEALTHY
    );
    return fallbackBackends[0] ?? null;
  }

  return activeBackends[Math.floor(Math.random() * activeBackends.length)];
}

// ============================================
// Utility Functions
// ============================================

export function formatBackendUrl(backend: Backend): string {
  return `${backend.protocol}://${backend.host}:${backend.port}`;
}

export function calculateHealthScore(backend: Backend): number {
  let score = 100;

  // Reduce score based on status
  if (backend.status === BackendStatus.UNHEALTHY) score -= 100;
  else if (backend.status === BackendStatus.DRAINING) score -= 50;
  else if (backend.status === BackendStatus.MAINTENANCE) score -= 75;

  // Reduce score based on connection utilization
  if (backend.maxConnections && backend.maxConnections > 0) {
    const utilization = backend.currentConnections / backend.maxConnections;
    if (utilization > 0.9) score -= 30;
    else if (utilization > 0.7) score -= 15;
    else if (utilization > 0.5) score -= 5;
  }

  return Math.max(0, score);
}

export function formatReplicaLag(lagMs: number): string {
  if (lagMs < 1000) return `${lagMs}ms`;
  if (lagMs < 60000) return `${(lagMs / 1000).toFixed(1)}s`;
  return `${(lagMs / 60000).toFixed(1)}m`;
}
