export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import {
  getGlobalStats,
  clearAllCaches,
  clearModuleCache,
  emitOrgChange,
  getModuleStats,
  type CacheModule,
} from '@/lib/cache';

const VALID_MODULES: CacheModule[] = [
  'endpoints',
  'clusters',
  'backends',
  'loadBalancer',
  'routingPolicy',
  'experiment',
  'replica',
  'circuitBreaker',
  'healthCheck',
  'user',
  'organization',
  'federation',
  'generic',
];

/**
 * GET /api/cache - Get cache statistics
 */
export async function GET(request: Request) {
  try {
    const auth = await requirePermission('view_metrics');
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(request.url);
    const module = searchParams.get('module') as CacheModule | null;

    if (module && VALID_MODULES.includes(module)) {
      const stats = getModuleStats(module);
      return NextResponse.json({ success: true, stats });
    }

    const stats = getGlobalStats();
    return NextResponse.json({ success: true, stats });
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
 *   - clearModule: Clear a specific module's cache
 *   - invalidateOrg: Invalidate all caches for an organization
 *   - invalidateModule: Invalidate a specific module for an organization
 */
export async function POST(request: Request) {
  try {
    const auth = await requirePermission('manage_system');
    if (auth instanceof NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    const { action, module, orgId } = body;

    switch (action) {
      case 'clear':
        clearAllCaches();
        return NextResponse.json({
          success: true,
          message: 'All caches cleared',
        });

      case 'clearModule':
        if (!module || !VALID_MODULES.includes(module)) {
          return NextResponse.json(
            { error: `Invalid module. Valid modules: ${VALID_MODULES.join(', ')}` },
            { status: 400 }
          );
        }
        clearModuleCache(module);
        return NextResponse.json({
          success: true,
          message: `Cache cleared for module: ${module}`,
        });

      case 'invalidateOrg':
        const targetOrgId = orgId || auth.orgId;
        if (!targetOrgId) {
          return NextResponse.json(
            { error: 'Organization ID required' },
            { status: 400 }
          );
        }
        // Invalidate all modules for the organization
        for (const mod of VALID_MODULES) {
          emitOrgChange(mod, targetOrgId, 'update');
        }
        return NextResponse.json({
          success: true,
          message: `All caches invalidated for organization: ${targetOrgId}`,
        });

      case 'invalidateModule':
        if (!module || !VALID_MODULES.includes(module)) {
          return NextResponse.json(
            { error: `Invalid module. Valid modules: ${VALID_MODULES.join(', ')}` },
            { status: 400 }
          );
        }
        const modOrgId = orgId || auth.orgId;
        if (modOrgId) {
          emitOrgChange(module, modOrgId, 'update');
        } else {
          clearModuleCache(module);
        }
        return NextResponse.json({
          success: true,
          message: `Cache invalidated for module: ${module}`,
        });

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: clear, clearModule, invalidateOrg, invalidateModule' },
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
