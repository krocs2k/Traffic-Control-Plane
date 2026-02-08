/**
 * Federation Statistics API
 * 
 * GET - Get detailed federation statistics and cache metrics
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { getFederationStats, getAllPeers } from '@/lib/federation';
import { getAllCacheStats } from '@/lib/cache';
import { getMetricsQueueStats } from '@/lib/metrics-queue';

export async function GET(request: NextRequest) {
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

    // Get federation stats
    const federationStats = await getFederationStats(orgId);
    const peers = getAllPeers();

    // Get cache stats
    const cacheStats = getAllCacheStats();

    // Get metrics queue stats
    const metricsQueueStats = getMetricsQueueStats();

    // Get recent sync logs
    const recentSyncLogs = await prisma.federationSyncLog.findMany({
      where: { orgId },
      orderBy: { startedAt: 'desc' },
      take: 10,
      include: {
        partner: {
          select: { nodeName: true, nodeUrl: true },
        },
      },
    });

    // Memory usage
    const memoryUsage = process.memoryUsage();

    return NextResponse.json({
      federation: federationStats,
      peers: peers.map(p => ({
        ...p,
        isLocal: federationStats?.nodeId === p.nodeId,
      })),
      cache: cacheStats,
      metricsQueue: metricsQueueStats,
      recentSyncs: recentSyncLogs.map(log => ({
        id: log.id,
        partnerName: log.partner?.nodeName,
        direction: log.direction,
        syncType: log.syncType,
        status: log.status,
        entitiesSynced: log.entitiesSynced,
        durationMs: log.durationMs,
        startedAt: log.startedAt,
        completedAt: log.completedAt,
        errorMessage: log.errorMessage,
      })),
      system: {
        heapUsedMB: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        rssMB: Math.round(memoryUsage.rss / 1024 / 1024),
        externalMB: Math.round(memoryUsage.external / 1024 / 1024),
        uptime: process.uptime(),
      },
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch statistics' },
      { status: 500 }
    );
  }
}
