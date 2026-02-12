export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import {
  getGlobalCacheStats,
  clearAllCaches,
  warmCachesForOrg,
  warmCriticalCaches,
  invalidateOrgCache,
  startCacheCleanup,
  stopCacheCleanup,
} from '@/lib/cache';

/**
 * GET /api/cache - Get cache statistics
 */
export async function GET() {
  try {
    const auth = await requirePermission('view_metrics');
    if (auth instanceof NextResponse) return auth;

    const stats = getGlobalCacheStats();

    return NextResponse.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('Get cache stats error:', error);
    return NextResponse.json(
      { error: 'Failed to get cache statistics' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/cache - Cache management operations
 * Actions:
 *   - clear: Clear all caches
 *   - warm: Warm caches for the organization
 *   - warmCritical: Warm critical caches
 *   - invalidate: Invalidate caches for the organization
 *   - startCleanup: Start background cleanup
 *   - stopCleanup: Stop background cleanup
 */
export async function POST(request: Request) {
  try {
    const auth = await requirePermission('manage_system');
    if (auth instanceof NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    const { action } = body;

    switch (action) {
      case 'clear':
        clearAllCaches();
        return NextResponse.json({
          success: true,
          message: 'All caches cleared',
        });

      case 'warm':
        if (auth.orgId) {
          await warmCachesForOrg(auth.orgId);
        }
        return NextResponse.json({
          success: true,
          message: 'Caches warmed for organization',
        });

      case 'warmCritical':
        await warmCriticalCaches();
        return NextResponse.json({
          success: true,
          message: 'Critical caches warmed',
        });

      case 'invalidate':
        if (auth.orgId) {
          invalidateOrgCache(auth.orgId);
        }
        return NextResponse.json({
          success: true,
          message: 'Organization caches invalidated',
        });

      case 'startCleanup':
        startCacheCleanup();
        return NextResponse.json({
          success: true,
          message: 'Background cleanup started',
        });

      case 'stopCleanup':
        stopCacheCleanup();
        return NextResponse.json({
          success: true,
          message: 'Background cleanup stopped',
        });

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: clear, warm, warmCritical, invalidate, startCleanup, stopCleanup' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Cache operation error:', error);
    return NextResponse.json(
      { error: 'Cache operation failed' },
      { status: 500 }
    );
  }
}
