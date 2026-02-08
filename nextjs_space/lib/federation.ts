/**
 * Federation Module for Distributed Traffic Control Plane
 * 
 * Enables multiple TCP instances to work together as a federated cluster:
 * - Consistent hashing for deterministic request routing
 * - Peer discovery and health monitoring (gossip-style)
 * - Internal request forwarding between peers
 * - Bounded load balancing to prevent node overwhelm
 * 
 * Architecture:
 * - Principle Node: Primary configuration source, syncs to Partners
 * - Partner Nodes: Receive configuration from Principle, can be promoted
 * - Standalone: Not part of any federation
 */

import { prisma } from '@/lib/db';
import crypto from 'crypto';

// ============================================
// Types
// ============================================

export interface FederationPeer {
  nodeId: string;
  nodeName: string;
  nodeUrl: string;
  region?: string;
  status: 'HEALTHY' | 'UNHEALTHY' | 'UNKNOWN';
  lastHeartbeat: Date | null;
  latencyMs?: number;
  currentLoad?: number; // 0-100 percentage
  maxLoad?: number;
  capabilities?: string[];
}

export interface ConsistentHashRing {
  nodes: Map<number, string>; // hash position -> nodeId
  virtualNodes: number; // Virtual nodes per physical node
  sortedHashes: number[];
}

export interface RoutingDecision {
  targetNodeId: string;
  targetNodeUrl: string;
  shouldForward: boolean;
  reason: string;
  alternateNodes?: FederationPeer[];
}

export interface FederationStats {
  nodeId: string;
  role: string;
  peerCount: number;
  healthyPeers: number;
  totalForwarded: number;
  totalReceived: number;
  avgLatencyToPeers: number;
}

// ============================================
// Configuration
// ============================================

const FEDERATION_CONFIG = {
  virtualNodes: 150,           // Virtual nodes per physical node in hash ring
  heartbeatIntervalMs: 5000,   // Send heartbeat every 5 seconds
  heartbeatTimeoutMs: 15000,   // Consider peer dead after 15 seconds
  maxLoadThreshold: 85,        // Don't route to nodes above 85% load
  forwardTimeoutMs: 10000,     // Timeout for forwarded requests
  maxRetries: 2,               // Max retries for forwarding
  hashAlgorithm: 'md5',        // Hash algorithm for consistent hashing
};

// ============================================
// In-Memory State
// ============================================

let hashRing: ConsistentHashRing | null = null;
let peerCache: Map<string, FederationPeer> = new Map();
let localNodeId: string | null = null;
let forwardedCount = 0;
let receivedCount = 0;

// ============================================
// Consistent Hashing Implementation
// ============================================

/**
 * Generate a hash value for a given key
 */
export function hashKey(key: string): number {
  const hash = crypto.createHash(FEDERATION_CONFIG.hashAlgorithm)
    .update(key)
    .digest('hex');
  // Convert first 8 hex chars to number (32-bit hash)
  return parseInt(hash.substring(0, 8), 16);
}

/**
 * Build a consistent hash ring from a list of peers
 */
export function buildHashRing(peers: FederationPeer[]): ConsistentHashRing {
  const nodes = new Map<number, string>();
  const virtualNodes = FEDERATION_CONFIG.virtualNodes;

  for (const peer of peers) {
    // Add virtual nodes for each peer
    for (let i = 0; i < virtualNodes; i++) {
      const virtualKey = `${peer.nodeId}:${i}`;
      const hash = hashKey(virtualKey);
      nodes.set(hash, peer.nodeId);
    }
  }

  // Sort hash positions for binary search
  const sortedHashes = Array.from(nodes.keys()).sort((a, b) => a - b);

  return {
    nodes,
    virtualNodes,
    sortedHashes,
  };
}

/**
 * Find the node responsible for a given key using consistent hashing
 */
export function findNodeForKey(ring: ConsistentHashRing, key: string): string | null {
  if (ring.sortedHashes.length === 0) return null;

  const hash = hashKey(key);
  const { sortedHashes, nodes } = ring;

  // Binary search for the first hash >= our key hash
  let left = 0;
  let right = sortedHashes.length - 1;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (sortedHashes[mid] < hash) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  // If we've gone past the end, wrap around to the first node
  const targetHash = sortedHashes[left >= sortedHashes.length ? 0 : left];
  return nodes.get(targetHash) || null;
}

/**
 * Find the next N nodes after the primary (for replication/failover)
 */
export function findReplicaNodes(ring: ConsistentHashRing, key: string, count: number): string[] {
  if (ring.sortedHashes.length === 0) return [];

  const hash = hashKey(key);
  const { sortedHashes, nodes } = ring;
  const result: string[] = [];
  const seen = new Set<string>();

  // Find starting position
  let idx = sortedHashes.findIndex(h => h >= hash);
  if (idx === -1) idx = 0;

  // Walk around the ring collecting unique nodes
  for (let i = 0; i < sortedHashes.length && result.length < count; i++) {
    const currentHash = sortedHashes[(idx + i) % sortedHashes.length];
    const nodeId = nodes.get(currentHash);
    if (nodeId && !seen.has(nodeId)) {
      seen.add(nodeId);
      result.push(nodeId);
    }
  }

  return result;
}

// ============================================
// Peer Management
// ============================================

/**
 * Initialize federation state for this node
 */
export async function initializeFederation(orgId: string): Promise<void> {
  const config = await prisma.federationConfig.findUnique({
    where: { orgId },
  });

  if (config) {
    localNodeId = config.nodeId;
    await refreshPeerList(orgId);
  }
}

/**
 * Refresh the list of federation peers from database
 */
export async function refreshPeerList(orgId: string): Promise<FederationPeer[]> {
  const config = await prisma.federationConfig.findUnique({
    where: { orgId },
  });

  if (!config || config.role === 'STANDALONE') {
    peerCache.clear();
    hashRing = null;
    return [];
  }

  const peers: FederationPeer[] = [];

  // Add self to peer list
  peers.push({
    nodeId: config.nodeId,
    nodeName: config.nodeName,
    nodeUrl: config.nodeUrl,
    status: 'HEALTHY',
    lastHeartbeat: new Date(),
    currentLoad: await getCurrentLoad(),
  });

  if (config.role === 'PRINCIPLE') {
    // Get all partners
    const partners = await prisma.federationPartner.findMany({
      where: { orgId, isActive: true },
    });

    for (const partner of partners) {
      const isHealthy = partner.lastHeartbeat && 
        (Date.now() - partner.lastHeartbeat.getTime()) < FEDERATION_CONFIG.heartbeatTimeoutMs;

      peers.push({
        nodeId: partner.nodeId,
        nodeName: partner.nodeName,
        nodeUrl: partner.nodeUrl,
        status: isHealthy ? 'HEALTHY' : 'UNHEALTHY',
        lastHeartbeat: partner.lastHeartbeat,
      });
    }
  } else if (config.role === 'PARTNER' && config.principleUrl) {
    // Add principle node
    peers.push({
      nodeId: config.principleNodeId || 'principle',
      nodeName: 'Principle',
      nodeUrl: config.principleUrl,
      status: config.lastHeartbeat && 
        (Date.now() - config.lastHeartbeat.getTime()) < FEDERATION_CONFIG.heartbeatTimeoutMs 
        ? 'HEALTHY' : 'UNKNOWN',
      lastHeartbeat: config.lastHeartbeat,
    });
  }

  // Update cache
  peerCache.clear();
  for (const peer of peers) {
    peerCache.set(peer.nodeId, peer);
  }

  // Rebuild hash ring with healthy peers
  const healthyPeers = peers.filter(p => p.status === 'HEALTHY');
  hashRing = buildHashRing(healthyPeers);

  return peers;
}

/**
 * Get current node load (0-100)
 */
async function getCurrentLoad(): Promise<number> {
  // Simple load estimation based on memory usage
  const used = process.memoryUsage();
  const heapUsedPercent = (used.heapUsed / used.heapTotal) * 100;
  return Math.round(heapUsedPercent);
}

/**
 * Record a heartbeat from a peer
 */
export async function recordPeerHeartbeat(
  orgId: string,
  peerNodeId: string,
  load?: number,
  latencyMs?: number
): Promise<void> {
  const peer = peerCache.get(peerNodeId);
  if (peer) {
    peer.lastHeartbeat = new Date();
    peer.status = 'HEALTHY';
    if (load !== undefined) peer.currentLoad = load;
    if (latencyMs !== undefined) peer.latencyMs = latencyMs;
  }

  // Update database
  await prisma.federationPartner.updateMany({
    where: { orgId, nodeId: peerNodeId },
    data: {
      lastHeartbeat: new Date(),
    },
  }).catch(() => {});
}

// ============================================
// Request Routing
// ============================================

/**
 * Determine which node should handle a request
 */
export function routeRequest(
  affinityKey: string,
  requestType?: string
): RoutingDecision {
  // If no federation or no hash ring, handle locally
  if (!hashRing || !localNodeId) {
    return {
      targetNodeId: localNodeId || 'local',
      targetNodeUrl: '',
      shouldForward: false,
      reason: 'No federation configured',
    };
  }

  // Find the responsible node using consistent hashing
  const targetNodeId = findNodeForKey(hashRing, affinityKey);

  if (!targetNodeId) {
    return {
      targetNodeId: localNodeId,
      targetNodeUrl: '',
      shouldForward: false,
      reason: 'No node found in hash ring',
    };
  }

  // If it's us, handle locally
  if (targetNodeId === localNodeId) {
    return {
      targetNodeId,
      targetNodeUrl: '',
      shouldForward: false,
      reason: 'Consistent hash maps to local node',
    };
  }

  // Check if target node is healthy and not overloaded
  const targetPeer = peerCache.get(targetNodeId);
  if (!targetPeer || targetPeer.status !== 'HEALTHY') {
    // Fallback to handling locally
    return {
      targetNodeId: localNodeId,
      targetNodeUrl: '',
      shouldForward: false,
      reason: `Target node ${targetNodeId} unhealthy, handling locally`,
      alternateNodes: getAlternateNodes(affinityKey, targetNodeId),
    };
  }

  if (targetPeer.currentLoad && targetPeer.currentLoad > FEDERATION_CONFIG.maxLoadThreshold) {
    // Node is overloaded, check alternates
    const alternates = getAlternateNodes(affinityKey, targetNodeId);
    const availableAlternate = alternates.find(
      p => p.status === 'HEALTHY' && (!p.currentLoad || p.currentLoad <= FEDERATION_CONFIG.maxLoadThreshold)
    );

    if (availableAlternate) {
      return {
        targetNodeId: availableAlternate.nodeId,
        targetNodeUrl: availableAlternate.nodeUrl,
        shouldForward: availableAlternate.nodeId !== localNodeId,
        reason: `Primary node overloaded, routing to alternate`,
        alternateNodes: alternates,
      };
    }

    // All nodes overloaded, handle locally
    return {
      targetNodeId: localNodeId,
      targetNodeUrl: '',
      shouldForward: false,
      reason: 'All nodes overloaded, handling locally',
    };
  }

  // Forward to target node
  return {
    targetNodeId,
    targetNodeUrl: targetPeer.nodeUrl,
    shouldForward: true,
    reason: 'Consistent hash routing to peer',
  };
}

/**
 * Get alternate nodes for failover
 */
function getAlternateNodes(key: string, excludeNodeId: string): FederationPeer[] {
  if (!hashRing) return [];

  const replicaNodeIds = findReplicaNodes(hashRing, key, 3);
  return replicaNodeIds
    .filter(id => id !== excludeNodeId)
    .map(id => peerCache.get(id))
    .filter((p): p is FederationPeer => p !== undefined);
}

// ============================================
// Request Forwarding
// ============================================

/**
 * Forward a request to another federation node
 */
export async function forwardRequest(
  targetUrl: string,
  request: Request,
  retryCount: number = 0
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    FEDERATION_CONFIG.forwardTimeoutMs
  );

  try {
    const forwardUrl = new URL(request.url);
    forwardUrl.host = new URL(targetUrl).host;

    const headers = new Headers(request.headers);
    headers.set('X-Federation-Forwarded', 'true');
    headers.set('X-Federation-Source', localNodeId || 'unknown');
    headers.set('X-Federation-Hop', String((parseInt(headers.get('X-Federation-Hop') || '0')) + 1));

    // Prevent infinite forwarding loops
    const hopCount = parseInt(headers.get('X-Federation-Hop') || '0');
    if (hopCount > 3) {
      throw new Error('Too many federation hops');
    }

    const response = await fetch(forwardUrl.toString(), {
      method: request.method,
      headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' 
        ? await request.clone().arrayBuffer() 
        : undefined,
      signal: controller.signal,
    });

    forwardedCount++;
    return response;
  } catch (error) {
    if (retryCount < FEDERATION_CONFIG.maxRetries) {
      return forwardRequest(targetUrl, request, retryCount + 1);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Handle an incoming forwarded request
 */
export function isForwardedRequest(headers: Headers): boolean {
  return headers.get('X-Federation-Forwarded') === 'true';
}

export function recordReceivedForward(): void {
  receivedCount++;
}

// ============================================
// Heartbeat / Health Check
// ============================================

/**
 * Send heartbeat to all peers
 */
export async function sendHeartbeatToAll(orgId: string): Promise<void> {
  const config = await prisma.federationConfig.findUnique({
    where: { orgId },
  });

  if (!config || config.role === 'STANDALONE') return;

  const currentLoad = await getCurrentLoad();
  const heartbeatData = {
    nodeId: config.nodeId,
    nodeName: config.nodeName,
    load: currentLoad,
    timestamp: Date.now(),
  };

  for (const [nodeId, peer] of peerCache.entries()) {
    if (nodeId === config.nodeId) continue; // Skip self

    try {
      const startTime = Date.now();
      const response = await fetch(`${peer.nodeUrl}/api/federation/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Federation-Secret': config.secretKey,
        },
        body: JSON.stringify(heartbeatData),
        signal: AbortSignal.timeout(5000),
      });

      const latencyMs = Date.now() - startTime;

      if (response.ok) {
        peer.status = 'HEALTHY';
        peer.lastHeartbeat = new Date();
        peer.latencyMs = latencyMs;
      } else {
        peer.status = 'UNHEALTHY';
      }
    } catch {
      peer.status = 'UNHEALTHY';
    }
  }

  // Rebuild hash ring with updated peer status
  const healthyPeers = Array.from(peerCache.values()).filter(p => p.status === 'HEALTHY');
  hashRing = buildHashRing(healthyPeers);
}

// ============================================
// Statistics
// ============================================

/**
 * Get federation statistics
 */
export async function getFederationStats(orgId: string): Promise<FederationStats | null> {
  const config = await prisma.federationConfig.findUnique({
    where: { orgId },
  });

  if (!config) return null;

  const peers = Array.from(peerCache.values());
  const healthyPeers = peers.filter(p => p.status === 'HEALTHY');
  const latencies = peers
    .filter(p => p.latencyMs !== undefined)
    .map(p => p.latencyMs as number);

  return {
    nodeId: config.nodeId,
    role: config.role,
    peerCount: peers.length,
    healthyPeers: healthyPeers.length,
    totalForwarded: forwardedCount,
    totalReceived: receivedCount,
    avgLatencyToPeers: latencies.length > 0 
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length 
      : 0,
  };
}

/**
 * Get all peers (for dashboard)
 */
export function getAllPeers(): FederationPeer[] {
  return Array.from(peerCache.values());
}

/**
 * Get local node ID
 */
export function getLocalNodeId(): string | null {
  return localNodeId;
}

/**
 * Check if request should be handled locally
 */
export function shouldHandleLocally(headers: Headers): boolean {
  // If already forwarded, don't forward again
  if (isForwardedRequest(headers)) {
    return true;
  }
  return false;
}
