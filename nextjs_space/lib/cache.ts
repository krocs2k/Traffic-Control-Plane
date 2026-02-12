/**
 * Event-Based Modular Caching System for Traffic Control Plane
 * 
 * Key Design Principles:
 * 1. Event-Driven Invalidation - Cache invalidated on data changes, not TTL
 * 2. Database Fallback - During cache rebuild, queries go to database
 * 3. Modular Isolation - Each module has independent cache, rebuilds don't affect others
 * 4. Change Propagation - Changes trigger targeted cache invalidation
 * 5. Async Rebuild - Cache rebuilds happen in background
 * 
 * Benefits:
 * - Zero stale data - cache always accurate or falls back to DB
 * - Reduced database load for read-heavy workloads
 * - Module isolation prevents cascading invalidations
 * - Predictable performance during cache rebuilds
 */

import { prisma } from '@/lib/db';
import {
  TrafficEndpoint,
  BackendCluster,
  Backend,
  LoadBalancerConfig,
  RoutingPolicy,
  Experiment,
  ReadReplica,
  CircuitBreaker,
  HealthCheck
} from '@prisma/client';

// ============================================
// Types
// ============================================

export type CacheModule = 
  | 'endpoints'
  | 'clusters'
  | 'backends'
  | 'loadBalancer'
  | 'routingPolicy'
  | 'experiment'
  | 'replica'
  | 'circuitBreaker'
  | 'healthCheck'
  | 'user'
  | 'organization'
  | 'federation'
  | 'generic';

export interface ModuleCacheState {
  isRebuilding: boolean;
  lastRebuildAt: number | null;
  lastChangeAt: number | null;
  version: number;              // Incremented on each change
  entries: Map<string, CacheEntry<unknown>>;
  hits: number;
  misses: number;
  dbFallbacks: number;          // Count of DB queries during rebuild
}

export interface CacheEntry<T> {
  data: T;
  version: number;              // Module version when cached
  createdAt: number;
  lastAccess: number;
  hits: number;
  tags: string[];
}

export interface ModuleStats {
  module: CacheModule;
  isRebuilding: boolean;
  entries: number;
  hits: number;
  misses: number;
  dbFallbacks: number;
  version: number;
  lastRebuildAt: number | null;
  lastChangeAt: number | null;
  hitRate: number;
}

export interface GlobalCacheStats {
  totalEntries: number;
  totalHits: number;
  totalMisses: number;
  totalDbFallbacks: number;
  overallHitRate: number;
  modulesRebuilding: number;
  uptime: number;
  modules: ModuleStats[];
}

type ClusterWithBackends = BackendCluster & {
  backends: Backend[];
  _count?: { backends: number; routingPolicies: number };
};

type EndpointWithCluster = TrafficEndpoint & {
  cluster?: ClusterWithBackends | null;
};

type RoutingPolicyWithCluster = RoutingPolicy & {
  cluster?: BackendCluster | null;
  targetCluster?: BackendCluster | null;
};

// ============================================
// Module Configuration
// ============================================

const MODULE_CONFIG: Record<CacheModule, { maxEntries: number; rebuildBatchSize: number }> = {
  endpoints: { maxEntries: 1000, rebuildBatchSize: 100 },
  clusters: { maxEntries: 500, rebuildBatchSize: 50 },
  backends: { maxEntries: 2000, rebuildBatchSize: 100 },
  loadBalancer: { maxEntries: 500, rebuildBatchSize: 50 },
  routingPolicy: { maxEntries: 500, rebuildBatchSize: 50 },
  experiment: { maxEntries: 200, rebuildBatchSize: 20 },
  replica: { maxEntries: 200, rebuildBatchSize: 20 },
  circuitBreaker: { maxEntries: 200, rebuildBatchSize: 20 },
  healthCheck: { maxEntries: 500, rebuildBatchSize: 50 },
  user: { maxEntries: 1000, rebuildBatchSize: 100 },
  organization: { maxEntries: 200, rebuildBatchSize: 20 },
  federation: { maxEntries: 100, rebuildBatchSize: 10 },
  generic: { maxEntries: 1000, rebuildBatchSize: 100 },
};

// ============================================
// Module Cache State
// ============================================

const cacheStartTime = Date.now();

// Each module has its own isolated cache state
const moduleStates: Map<CacheModule, ModuleCacheState> = new Map();

// Rebuild promises to prevent duplicate rebuilds
const rebuildPromises: Map<string, Promise<void>> = new Map();

// Initialize module states
function getModuleState(module: CacheModule): ModuleCacheState {
  let state = moduleStates.get(module);
  if (!state) {
    state = {
      isRebuilding: false,
      lastRebuildAt: null,
      lastChangeAt: null,
      version: 0,
      entries: new Map(),
      hits: 0,
      misses: 0,
      dbFallbacks: 0,
    };
    moduleStates.set(module, state);
  }
  return state;
}

// ============================================
// Core Cache Operations
// ============================================

/**
 * Get data from module cache
 * Returns null if not found or if module is rebuilding (use DB instead)
 */
export function cacheGet<T>(module: CacheModule, key: string): T | null {
  const state = getModuleState(module);
  
  // If rebuilding, signal to use database
  if (state.isRebuilding) {
    state.dbFallbacks++;
    return null;
  }
  
  const entry = state.entries.get(key) as CacheEntry<T> | undefined;
  
  if (!entry) {
    state.misses++;
    return null;
  }
  
  // Check if entry version matches current module version
  if (entry.version !== state.version) {
    // Entry is from an old version, invalidate it
    state.entries.delete(key);
    state.misses++;
    return null;
  }
  
  // Update access stats
  entry.hits++;
  entry.lastAccess = Date.now();
  state.hits++;
  
  return entry.data;
}

/**
 * Set data in module cache
 */
export function cacheSet<T>(
  module: CacheModule,
  key: string,
  data: T,
  tags: string[] = []
): void {
  const state = getModuleState(module);
  const config = MODULE_CONFIG[module];
  
  // Don't cache during rebuild - data might be changing
  if (state.isRebuilding) {
    return;
  }
  
  // Evict if at capacity
  if (state.entries.size >= config.maxEntries) {
    evictLRU(state, Math.ceil(config.maxEntries * 0.1));
  }
  
  state.entries.set(key, {
    data,
    version: state.version,
    createdAt: Date.now(),
    lastAccess: Date.now(),
    hits: 0,
    tags,
  });
}

/**
 * Get or fetch with database fallback
 * If cache miss or rebuilding, fetches from loader (database)
 */
export async function cacheGetOrFetch<T>(
  module: CacheModule,
  key: string,
  loader: () => Promise<T>,
  tags: string[] = []
): Promise<T> {
  const cached = cacheGet<T>(module, key);
  if (cached !== null) {
    return cached;
  }
  
  // Fetch from database
  const data = await loader();
  
  // Cache the result (won't cache during rebuild)
  cacheSet(module, key, data, tags);
  
  return data;
}

/**
 * Delete specific key from module cache
 */
export function cacheDelete(module: CacheModule, key: string): boolean {
  const state = getModuleState(module);
  return state.entries.delete(key);
}

/**
 * LRU eviction for a module
 */
function evictLRU(state: ModuleCacheState, count: number): void {
  const entries = Array.from(state.entries.entries())
    .sort((a, b) => a[1].lastAccess - b[1].lastAccess);
  
  for (let i = 0; i < Math.min(count, entries.length); i++) {
    state.entries.delete(entries[i][0]);
  }
}

// ============================================
// Change Events - Trigger Cache Invalidation
// ============================================

/**
 * Emit a change event for a module
 * This marks the module as needing rebuild and triggers async rebuild
 */
export function emitChange(
  module: CacheModule,
  changeType: 'create' | 'update' | 'delete',
  resourceId?: string,
  orgId?: string
): void {
  const state = getModuleState(module);
  
  // Increment version to invalidate all current cache entries
  state.version++;
  state.lastChangeAt = Date.now();
  
  // Clear the module's cache entries (they're now invalid)
  state.entries.clear();
  
  console.log(`[Cache] Change event: ${module}.${changeType}${resourceId ? ` (${resourceId})` : ''}${orgId ? ` org:${orgId}` : ''}`);
  
  // Don't auto-rebuild - let the next request populate the cache
  // This is more efficient as we only cache what's actually needed
}

/**
 * Emit change for organization-scoped data
 * Invalidates cache entries tagged with this org
 */
export function emitOrgChange(
  module: CacheModule,
  orgId: string,
  changeType: 'create' | 'update' | 'delete'
): void {
  emitChange(module, changeType, undefined, orgId);
}

/**
 * Emit changes to multiple related modules
 * Use when a change affects multiple cache modules
 */
export function emitRelatedChanges(
  modules: CacheModule[],
  changeType: 'create' | 'update' | 'delete',
  orgId?: string
): void {
  for (const module of modules) {
    emitChange(module, changeType, undefined, orgId);
  }
}

// ============================================
// Module-Specific Invalidation Helpers
// ============================================

/**
 * Invalidate backend-related caches (backends, clusters, loadBalancer)
 */
export function invalidateBackendCaches(orgId?: string): void {
  emitRelatedChanges(['backends', 'clusters', 'loadBalancer'], 'update', orgId);
}

/**
 * Invalidate routing-related caches
 */
export function invalidateRoutingCaches(orgId?: string): void {
  emitRelatedChanges(['routingPolicy', 'endpoints'], 'update', orgId);
}

/**
 * Invalidate experiment-related caches
 */
export function invalidateExperimentCaches(orgId?: string): void {
  emitChange('experiment', 'update', undefined, orgId);
}

/**
 * Invalidate health-related caches
 */
export function invalidateHealthCaches(orgId?: string): void {
  emitRelatedChanges(['healthCheck', 'circuitBreaker'], 'update', orgId);
}

// ============================================
// Cache Statistics
// ============================================

/**
 * Get statistics for a specific module
 */
export function getModuleStats(module: CacheModule): ModuleStats {
  const state = getModuleState(module);
  const total = state.hits + state.misses;
  
  return {
    module,
    isRebuilding: state.isRebuilding,
    entries: state.entries.size,
    hits: state.hits,
    misses: state.misses,
    dbFallbacks: state.dbFallbacks,
    version: state.version,
    lastRebuildAt: state.lastRebuildAt,
    lastChangeAt: state.lastChangeAt,
    hitRate: total > 0 ? state.hits / total : 0,
  };
}

/**
 * Get global cache statistics
 */
export function getGlobalStats(): GlobalCacheStats {
  const modules = Array.from(moduleStates.keys()).map(getModuleStats);
  
  const totals = modules.reduce(
    (acc, m) => ({
      entries: acc.entries + m.entries,
      hits: acc.hits + m.hits,
      misses: acc.misses + m.misses,
      dbFallbacks: acc.dbFallbacks + m.dbFallbacks,
      rebuilding: acc.rebuilding + (m.isRebuilding ? 1 : 0),
    }),
    { entries: 0, hits: 0, misses: 0, dbFallbacks: 0, rebuilding: 0 }
  );
  
  const total = totals.hits + totals.misses;
  
  return {
    totalEntries: totals.entries,
    totalHits: totals.hits,
    totalMisses: totals.misses,
    totalDbFallbacks: totals.dbFallbacks,
    overallHitRate: total > 0 ? totals.hits / total : 0,
    modulesRebuilding: totals.rebuilding,
    uptime: Date.now() - cacheStartTime,
    modules,
  };
}

/**
 * Clear all caches for a module
 */
export function clearModuleCache(module: CacheModule): void {
  const state = getModuleState(module);
  state.entries.clear();
  state.version++;
  state.hits = 0;
  state.misses = 0;
  state.dbFallbacks = 0;
  console.log(`[Cache] Module ${module} cleared`);
}

/**
 * Clear all caches
 */
export function clearAllCaches(): void {
  for (const module of moduleStates.keys()) {
    clearModuleCache(module);
  }
  console.log('[Cache] All caches cleared');
}

// ============================================
// Convenience Functions for Common Operations
// ============================================

/**
 * Get cached clusters for an organization
 */
export async function getCachedClusters(
  orgId: string,
  includeBackends: boolean = true
): Promise<ClusterWithBackends[]> {
  const key = `org:${orgId}:clusters:${includeBackends ? 'full' : 'basic'}`;
  
  return cacheGetOrFetch(
    'clusters',
    key,
    async () => {
      return prisma.backendCluster.findMany({
        where: { orgId },
        include: includeBackends ? {
          backends: true,
          _count: { select: { backends: true, routingPolicies: true } }
        } : {
          backends: false,
          _count: { select: { backends: true, routingPolicies: true } }
        },
        orderBy: { name: 'asc' }
      }) as Promise<ClusterWithBackends[]>;
    },
    [`org:${orgId}`]
  );
}

/**
 * Get cached endpoints for an organization
 */
export async function getCachedEndpoints(
  orgId: string
): Promise<EndpointWithCluster[]> {
  const key = `org:${orgId}:endpoints`;
  
  return cacheGetOrFetch<EndpointWithCluster[]>(
    'endpoints',
    key,
    async () => {
      const endpoints = await prisma.trafficEndpoint.findMany({
        where: { orgId },
        include: {
          cluster: {
            include: { backends: true }
          }
        },
        orderBy: { name: 'asc' }
      });
      return endpoints as EndpointWithCluster[];
    },
    [`org:${orgId}`]
  );
}

/**
 * Get cached routing policies for an organization
 */
export async function getCachedRoutingPolicies(
  orgId: string
): Promise<RoutingPolicyWithCluster[]> {
  const key = `org:${orgId}:policies`;
  
  return cacheGetOrFetch<RoutingPolicyWithCluster[]>(
    'routingPolicy',
    key,
    async () => {
      const policies = await prisma.routingPolicy.findMany({
        where: { orgId },
        include: {
          cluster: true
        },
        orderBy: { priority: 'asc' }
      });
      return policies as RoutingPolicyWithCluster[];
    },
    [`org:${orgId}`]
  );
}

/**
 * Get cached load balancer configs for an organization
 */
export async function getCachedLoadBalancerConfigs(
  orgId: string
): Promise<LoadBalancerConfig[]> {
  const key = `org:${orgId}:lb-configs`;
  
  return cacheGetOrFetch(
    'loadBalancer',
    key,
    async () => {
      // First get cluster IDs for this org
      const clusters = await prisma.backendCluster.findMany({
        where: { orgId },
        select: { id: true }
      });
      const clusterIds = clusters.map(c => c.id);
      
      // Then get load balancer configs for those clusters
      return prisma.loadBalancerConfig.findMany({
        where: { clusterId: { in: clusterIds } },
        include: { cluster: true }
      });
    },
    [`org:${orgId}`]
  );
}

/**
 * Get cached experiments for an organization
 */
export async function getCachedExperiments(
  orgId: string
): Promise<Experiment[]> {
  const key = `org:${orgId}:experiments`;
  
  return cacheGetOrFetch(
    'experiment',
    key,
    async () => {
      return prisma.experiment.findMany({
        where: { orgId },
        include: {
          variants: true,
          metrics: { take: 10, orderBy: { recordedAt: 'desc' } }
        },
        orderBy: { createdAt: 'desc' }
      });
    },
    [`org:${orgId}`]
  );
}

/**
 * Get cached replicas for an organization
 */
export async function getCachedReplicas(
  orgId: string
): Promise<ReadReplica[]> {
  const key = `org:${orgId}:replicas`;
  
  return cacheGetOrFetch(
    'replica',
    key,
    async () => {
      return prisma.readReplica.findMany({
        where: { orgId },
        orderBy: { name: 'asc' }
      });
    },
    [`org:${orgId}`]
  );
}

/**
 * Get cached health checks for an organization
 */
export async function getCachedHealthChecks(
  orgId: string
): Promise<HealthCheck[]> {
  const key = `org:${orgId}:health-checks`;
  
  return cacheGetOrFetch(
    'healthCheck',
    key,
    async () => {
      // First get backend IDs for this org's clusters
      const backends = await prisma.backend.findMany({
        where: { cluster: { orgId } },
        select: { id: true }
      });
      const backendIds = backends.map(b => b.id);
      
      // Then get health checks for those backends
      return prisma.healthCheck.findMany({
        where: { backendId: { in: backendIds } },
        orderBy: { checkedAt: 'desc' },
        take: 100
      });
    },
    [`org:${orgId}`]
  );
}

// ============================================
// Proxy-specific Cache Functions
// ============================================

/**
 * Get a single cached endpoint by slug (for proxy routing)
 */
export async function getCachedEndpoint(
  slug: string
): Promise<EndpointWithCluster | null> {
  const key = `endpoint:slug:${slug}`;
  
  return cacheGetOrFetch<EndpointWithCluster | null>(
    'endpoints',
    key,
    async () => {
      const endpoint = await prisma.trafficEndpoint.findUnique({
        where: { slug },
        include: {
          cluster: {
            include: { backends: true }
          }
        }
      });
      return endpoint as EndpointWithCluster | null;
    }
  );
}

/**
 * Get a single cached cluster by ID (for proxy routing)
 */
export async function getCachedCluster(
  clusterId: string
): Promise<ClusterWithBackends | null> {
  const key = `cluster:id:${clusterId}`;
  
  return cacheGetOrFetch(
    'clusters',
    key,
    async () => {
      return prisma.backendCluster.findUnique({
        where: { id: clusterId },
        include: { backends: true }
      }) as Promise<ClusterWithBackends | null>;
    }
  );
}

/**
 * Get load balancer config for a cluster (for proxy routing)
 */
export async function getCachedLoadBalancerConfig(
  clusterId: string
): Promise<LoadBalancerConfig | null> {
  const key = `lb-config:cluster:${clusterId}`;
  
  return cacheGetOrFetch(
    'loadBalancer',
    key,
    async () => {
      return prisma.loadBalancerConfig.findUnique({
        where: { clusterId }
      });
    }
  );
}

// Affinity cache for session stickiness (simple in-memory store)
const affinityCache = new Map<string, { backendId: string; expiresAt: number }>();

/**
 * Get cached affinity mapping for a key (for sticky sessions)
 * @param endpointId - The endpoint ID
 * @param affinityKey - The affinity key (e.g., client IP + path)
 */
export function getCachedAffinity(endpointId: string, affinityKey?: string): string | null {
  const key = affinityKey ? `${endpointId}:${affinityKey}` : endpointId;
  const entry = affinityCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    affinityCache.delete(key);
    return null;
  }
  return entry.backendId;
}

/**
 * Set affinity mapping (for sticky sessions)
 * @param endpointId - The endpoint ID
 * @param affinityKey - The affinity key (e.g., client IP + path)
 * @param backendId - The backend to stick to
 * @param ttlSeconds - TTL in seconds (default: 3600)
 */
export async function setCachedAffinity(
  endpointId: string,
  affinityKey: string,
  backendId: string,
  ttlSeconds: number = 3600
): Promise<void> {
  const key = `${endpointId}:${affinityKey}`;
  affinityCache.set(key, {
    backendId,
    expiresAt: Date.now() + (ttlSeconds * 1000)
  });
  
  // Cleanup old entries periodically
  if (affinityCache.size > 10000) {
    const now = Date.now();
    for (const [k, v] of affinityCache.entries()) {
      if (v.expiresAt < now) {
        affinityCache.delete(k);
      }
    }
  }
}

// ============================================
// Legacy Compatibility Layer
// ============================================

// These functions maintain backwards compatibility with existing code

export interface LegacyCacheEntry<T> {
  data: T;
  expiresAt: number;
  staleAt: number;
  hits: number;
  frequency: number;
  lastAccess: number;
  createdAt: number;
  size: number;
  tags: string[];
}

export interface LegacyCacheStats {
  hits: number;
  misses: number;
  staleHits: number;
  size: number;
  hitRate: number;
  memoryUsageMB: number;
  avgLatencyMs: number;
  evictions: number;
}

export interface LegacyGlobalCacheStats {
  totalHits: number;
  totalMisses: number;
  totalSize: number;
  totalMemoryMB: number;
  overallHitRate: number;
  caches: Record<string, LegacyCacheStats>;
  uptime: number;
  lastCleanup: number | null;
}

// Legacy CacheStore class for backwards compatibility
export class CacheStore<T> {
  private module: CacheModule;
  
  constructor(name: string, _ttlMs: number, _maxSize: number, _staleTtlMs?: number) {
    // Map old cache names to new modules
    this.module = this.mapNameToModule(name);
  }
  
  private mapNameToModule(name: string): CacheModule {
    const mapping: Record<string, CacheModule> = {
      'endpoints': 'endpoints',
      'clusters': 'clusters',
      'backends': 'backends',
      'loadBalancer': 'loadBalancer',
      'affinity': 'generic',
      'federation': 'federation',
      'routingPolicy': 'routingPolicy',
      'experiment': 'experiment',
      'healthCheck': 'healthCheck',
      'replica': 'replica',
      'user': 'user',
      'organization': 'organization',
      'metrics': 'generic',
    };
    return mapping[name] || 'generic';
  }
  
  get(key: string): { data: T; isStale: boolean } | null {
    const data = cacheGet<T>(this.module, key);
    if (data === null) return null;
    return { data, isStale: false };
  }
  
  getData(key: string): T | null {
    return cacheGet<T>(this.module, key);
  }
  
  set(key: string, data: T, options?: { ttlOverride?: number; tags?: string[] }): void {
    cacheSet(this.module, key, data, options?.tags);
  }
  
  async getOrSet(
    key: string,
    loader: () => Promise<T>,
    options?: { ttlOverride?: number; tags?: string[] }
  ): Promise<T> {
    return cacheGetOrFetch(this.module, key, loader, options?.tags);
  }
  
  delete(key: string): boolean {
    return cacheDelete(this.module, key);
  }
  
  invalidatePattern(pattern: string): number {
    // For the new system, we just clear the module on pattern invalidation
    emitChange(this.module, 'update');
    return 1;
  }
  
  invalidateByTag(tag: string): number {
    emitChange(this.module, 'update');
    return 1;
  }
  
  invalidateByOrg(orgId: string): number {
    emitOrgChange(this.module, orgId, 'update');
    return 1;
  }
  
  clear(): void {
    clearModuleCache(this.module);
  }
  
  getStats(): LegacyCacheStats {
    const stats = getModuleStats(this.module);
    return {
      hits: stats.hits,
      misses: stats.misses,
      staleHits: 0,
      size: stats.entries,
      hitRate: stats.hitRate,
      memoryUsageMB: 0,
      avgLatencyMs: 0,
      evictions: 0,
    };
  }
  
  has(key: string): boolean {
    return cacheGet(this.module, key) !== null;
  }
  
  keys(): string[] {
    const state = getModuleState(this.module);
    return Array.from(state.entries.keys());
  }
}

// Legacy cache instances for backwards compatibility
export const endpointCache = new CacheStore<EndpointWithCluster[]>('endpoints', 30000, 1000);
export const clusterCache = new CacheStore<ClusterWithBackends[]>('clusters', 30000, 500);
export const loadBalancerCache = new CacheStore<LoadBalancerConfig[]>('loadBalancer', 60000, 500);
export const federationCache = new CacheStore<unknown>('federation', 10000, 100);
export const routingPolicyCache = new CacheStore<RoutingPolicyWithCluster[]>('routingPolicy', 45000, 500);
export const experimentCache = new CacheStore<Experiment[]>('experiment', 30000, 200);
export const healthCheckCache = new CacheStore<HealthCheck[]>('healthCheck', 15000, 500);
export const replicaCache = new CacheStore<ReadReplica[]>('replica', 20000, 200);
export const userCache = new CacheStore<unknown>('user', 120000, 1000);
export const organizationCache = new CacheStore<unknown>('organization', 180000, 200);

// Legacy global stats function
export function getLegacyGlobalStats(): LegacyGlobalCacheStats {
  const stats = getGlobalStats();
  const caches: Record<string, LegacyCacheStats> = {};
  
  for (const m of stats.modules) {
    caches[m.module] = {
      hits: m.hits,
      misses: m.misses,
      staleHits: 0,
      size: m.entries,
      hitRate: m.hitRate,
      memoryUsageMB: 0,
      avgLatencyMs: 0,
      evictions: 0,
    };
  }
  
  return {
    totalHits: stats.totalHits,
    totalMisses: stats.totalMisses,
    totalSize: stats.totalEntries,
    totalMemoryMB: 0,
    overallHitRate: stats.overallHitRate,
    caches,
    uptime: stats.uptime,
    lastCleanup: null,
  };
}

// ============================================
// Exported Helper Functions
// ============================================

/**
 * Helper to get cached data with automatic org tagging
 */
export async function getCached<T>(
  module: CacheModule,
  key: string,
  loader: () => Promise<T>,
  orgId?: string
): Promise<T> {
  const tags = orgId ? [`org:${orgId}`] : [];
  return cacheGetOrFetch(module, key, loader, tags);
}

/**
 * Helper to invalidate organization cache for a module
 */
export function invalidateOrgCache(module: CacheModule, orgId: string): void {
  emitOrgChange(module, orgId, 'update');
}

/**
 * Check if a module's cache is currently being rebuilt
 */
export function isModuleRebuilding(module: CacheModule): boolean {
  return getModuleState(module).isRebuilding;
}

/**
 * Get the current version of a module's cache
 */
export function getModuleVersion(module: CacheModule): number {
  return getModuleState(module).version;
}
