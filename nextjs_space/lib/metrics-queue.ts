/**
 * Asynchronous Metrics Collection Queue
 * 
 * Batches metrics updates to reduce database write pressure.
 * Instead of updating the database on every request, we:
 * 1. Queue metrics in memory
 * 2. Flush to database periodically (every 5 seconds)
 * 3. Aggregate metrics before writing
 * 
 * This removes the blocking database write from the request critical path.
 */

import { prisma } from '@/lib/db';

// ============================================
// Types
// ============================================

export interface EndpointMetricEntry {
  endpointId: string;
  latencyMs: number;
  isError: boolean;
  timestamp: number;
  bytesIn?: number;
  bytesOut?: number;
}

export interface TrafficMetricEntry {
  orgId: string;
  clusterId?: string;
  backendId?: string;
  policyId?: string;
  latencyMs: number;
  isError: boolean;
  bytesIn?: number;
  bytesOut?: number;
  timestamp: number;
}

export interface MetricsQueueStats {
  endpointQueueSize: number;
  trafficQueueSize: number;
  totalFlushed: number;
  lastFlushAt: number | null;
  flushErrors: number;
}

// ============================================
// Configuration
// ============================================

const FLUSH_INTERVAL_MS = 5000; // Flush every 5 seconds
const MAX_QUEUE_SIZE = 10000;   // Prevent memory overflow
const BATCH_SIZE = 500;         // Max records per batch write

// ============================================
// Queue State
// ============================================

let endpointMetricsQueue: EndpointMetricEntry[] = [];
let trafficMetricsQueue: TrafficMetricEntry[] = [];
let flushTimeout: NodeJS.Timeout | null = null;
let isProcessing = false;

// Stats tracking
let totalFlushed = 0;
let lastFlushAt: number | null = null;
let flushErrors = 0;

// ============================================
// Queue Functions
// ============================================

/**
 * Queue an endpoint metric for batch processing
 */
export function queueEndpointMetric(entry: EndpointMetricEntry): void {
  // Prevent queue overflow
  if (endpointMetricsQueue.length >= MAX_QUEUE_SIZE) {
    // Drop oldest entries
    endpointMetricsQueue = endpointMetricsQueue.slice(-MAX_QUEUE_SIZE / 2);
  }

  endpointMetricsQueue.push(entry);
  scheduleFlush();
}

/**
 * Queue a traffic metric for batch processing
 */
export function queueTrafficMetric(entry: TrafficMetricEntry): void {
  if (trafficMetricsQueue.length >= MAX_QUEUE_SIZE) {
    trafficMetricsQueue = trafficMetricsQueue.slice(-MAX_QUEUE_SIZE / 2);
  }

  trafficMetricsQueue.push(entry);
  scheduleFlush();
}

/**
 * Convenience function to queue both endpoint and traffic metrics
 */
export function queueRequestMetrics(params: {
  endpointId: string;
  orgId: string;
  clusterId?: string;
  backendId?: string;
  policyId?: string;
  latencyMs: number;
  isError: boolean;
  bytesIn?: number;
  bytesOut?: number;
}): void {
  const timestamp = Date.now();

  queueEndpointMetric({
    endpointId: params.endpointId,
    latencyMs: params.latencyMs,
    isError: params.isError,
    timestamp,
    bytesIn: params.bytesIn,
    bytesOut: params.bytesOut,
  });

  queueTrafficMetric({
    orgId: params.orgId,
    clusterId: params.clusterId,
    backendId: params.backendId,
    policyId: params.policyId,
    latencyMs: params.latencyMs,
    isError: params.isError,
    bytesIn: params.bytesIn,
    bytesOut: params.bytesOut,
    timestamp,
  });
}

// ============================================
// Flush Logic
// ============================================

function scheduleFlush(): void {
  if (flushTimeout) return;

  flushTimeout = setTimeout(async () => {
    flushTimeout = null;
    await flushMetrics();
  }, FLUSH_INTERVAL_MS);
}

/**
 * Flush all queued metrics to the database
 */
export async function flushMetrics(): Promise<void> {
  if (isProcessing) return;
  if (endpointMetricsQueue.length === 0 && trafficMetricsQueue.length === 0) return;

  isProcessing = true;

  try {
    // Grab current queue contents and reset
    const endpointBatch = endpointMetricsQueue.splice(0, BATCH_SIZE);
    const trafficBatch = trafficMetricsQueue.splice(0, BATCH_SIZE);

    // Process endpoint metrics (aggregate by endpointId)
    await processEndpointMetrics(endpointBatch);

    // Process traffic metrics (aggregate by org/cluster/backend)
    await processTrafficMetrics(trafficBatch);

    totalFlushed += endpointBatch.length + trafficBatch.length;
    lastFlushAt = Date.now();

    // If there's more data, schedule another flush
    if (endpointMetricsQueue.length > 0 || trafficMetricsQueue.length > 0) {
      scheduleFlush();
    }
  } catch (error) {
    console.error('[MetricsQueue] Flush error:', error);
    flushErrors++;
  } finally {
    isProcessing = false;
  }
}

/**
 * Process and write endpoint metrics (aggregated updates)
 */
async function processEndpointMetrics(entries: EndpointMetricEntry[]): Promise<void> {
  if (entries.length === 0) return;

  // Aggregate by endpointId
  const aggregated = new Map<string, {
    totalRequests: number;
    totalErrors: number;
    totalLatency: number;
    lastRequestAt: Date;
  }>();

  for (const entry of entries) {
    const existing = aggregated.get(entry.endpointId) || {
      totalRequests: 0,
      totalErrors: 0,
      totalLatency: 0,
      lastRequestAt: new Date(0),
    };

    existing.totalRequests++;
    if (entry.isError) existing.totalErrors++;
    existing.totalLatency += entry.latencyMs;
    
    const entryDate = new Date(entry.timestamp);
    if (entryDate > existing.lastRequestAt) {
      existing.lastRequestAt = entryDate;
    }

    aggregated.set(entry.endpointId, existing);
  }

  // Batch update endpoints
  const updatePromises = Array.from(aggregated.entries()).map(
    ([endpointId, stats]) =>
      prisma.trafficEndpoint.update({
        where: { id: endpointId },
        data: {
          totalRequests: { increment: stats.totalRequests },
          totalErrors: { increment: stats.totalErrors },
          avgLatencyMs: stats.totalLatency / stats.totalRequests, // Running average (simplified)
          lastRequestAt: stats.lastRequestAt,
        },
      }).catch((err) => {
        console.error(`[MetricsQueue] Failed to update endpoint ${endpointId}:`, err.message);
      })
  );

  await Promise.all(updatePromises);
}

/**
 * Process and write traffic metrics (create aggregated records)
 */
async function processTrafficMetrics(entries: TrafficMetricEntry[]): Promise<void> {
  if (entries.length === 0) return;

  // Aggregate by composite key: orgId + clusterId + backendId
  const aggregated = new Map<string, {
    orgId: string;
    clusterId?: string;
    backendId?: string;
    policyId?: string;
    requestCount: number;
    errorCount: number;
    totalLatency: number;
    bytesIn: bigint;
    bytesOut: bigint;
    minLatency: number;
    maxLatency: number;
    latencies: number[];
  }>();

  for (const entry of entries) {
    const key = `${entry.orgId}:${entry.clusterId || ''}:${entry.backendId || ''}`;
    const existing = aggregated.get(key) || {
      orgId: entry.orgId,
      clusterId: entry.clusterId,
      backendId: entry.backendId,
      policyId: entry.policyId,
      requestCount: 0,
      errorCount: 0,
      totalLatency: 0,
      bytesIn: BigInt(0),
      bytesOut: BigInt(0),
      minLatency: Infinity,
      maxLatency: 0,
      latencies: [],
    };

    existing.requestCount++;
    if (entry.isError) existing.errorCount++;
    existing.totalLatency += entry.latencyMs;
    existing.bytesIn += BigInt(entry.bytesIn || 0);
    existing.bytesOut += BigInt(entry.bytesOut || 0);
    existing.minLatency = Math.min(existing.minLatency, entry.latencyMs);
    existing.maxLatency = Math.max(existing.maxLatency, entry.latencyMs);
    existing.latencies.push(entry.latencyMs);

    aggregated.set(key, existing);
  }

  // Create traffic metric records
  const now = new Date();
  const createData = Array.from(aggregated.values()).map((stats) => {
    // Calculate percentiles
    const sorted = stats.latencies.sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;

    return {
      orgId: stats.orgId,
      clusterId: stats.clusterId || null,
      backendId: stats.backendId || null,
      policyId: stats.policyId || null,
      requestCount: stats.requestCount,
      errorCount: stats.errorCount,
      avgLatencyMs: stats.totalLatency / stats.requestCount,
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      p99LatencyMs: p99,
      bytesIn: stats.bytesIn,
      bytesOut: stats.bytesOut,
      period: '1m',
      recordedAt: now,
    };
  });

  if (createData.length > 0) {
    await prisma.trafficMetric.createMany({
      data: createData,
    }).catch((err) => {
      console.error('[MetricsQueue] Failed to create traffic metrics:', err.message);
    });
  }
}

// ============================================
// Stats & Management
// ============================================

/**
 * Get current queue statistics
 */
export function getMetricsQueueStats(): MetricsQueueStats {
  return {
    endpointQueueSize: endpointMetricsQueue.length,
    trafficQueueSize: trafficMetricsQueue.length,
    totalFlushed,
    lastFlushAt,
    flushErrors,
  };
}

/**
 * Force immediate flush (useful for graceful shutdown)
 */
export async function forceFlush(): Promise<void> {
  if (flushTimeout) {
    clearTimeout(flushTimeout);
    flushTimeout = null;
  }
  await flushMetrics();
}

/**
 * Clear all queued metrics (use sparingly)
 */
export function clearMetricsQueue(): void {
  endpointMetricsQueue = [];
  trafficMetricsQueue = [];
  if (flushTimeout) {
    clearTimeout(flushTimeout);
    flushTimeout = null;
  }
}

/**
 * Reset stats counters
 */
export function resetMetricsStats(): void {
  totalFlushed = 0;
  lastFlushAt = null;
  flushErrors = 0;
}
