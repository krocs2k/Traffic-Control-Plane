import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// In-memory cache for custom domain mappings (refreshed periodically)
let domainCache: Map<string, string> = new Map();
let lastCacheRefresh = 0;
const CACHE_TTL = 60000; // 1 minute

// List of internal paths that should never be proxied
const INTERNAL_PATHS = [
  '/api/',
  '/_next/',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/dashboard',
  '/audit',
  '/organization',
  '/profile',
  '/users',
  '/e/', // Already an endpoint path
];

// List of known internal hostnames (the actual app domains)
const INTERNAL_HOSTNAMES = [
  'localhost',
  '127.0.0.1',
  // Add your actual app domains here
];

export async function middleware(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const hostname = host.split(':')[0]; // Remove port if present
  const pathname = request.nextUrl.pathname;

  // Skip internal paths
  if (INTERNAL_PATHS.some(path => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // Skip if this is a known internal hostname
  if (INTERNAL_HOSTNAMES.some(h => hostname.includes(h))) {
    return NextResponse.next();
  }

  // Skip if hostname ends with known platform domains (configurable via env)
  const platformDomains = process.env.PLATFORM_DOMAINS?.split(',') || [];
  if (platformDomains.some(domain => hostname.endsWith(domain.trim()))) {
    return NextResponse.next();
  }

  // Check if this hostname is mapped to an endpoint
  // For custom domains, rewrite to the endpoint handler
  try {
    // Refresh cache if needed
    if (Date.now() - lastCacheRefresh > CACHE_TTL) {
      await refreshDomainCache(request);
    }

    const endpointSlug = domainCache.get(hostname);
    
    if (endpointSlug) {
      // Rewrite the request to the endpoint handler
      const url = request.nextUrl.clone();
      url.pathname = `/e/${endpointSlug}${pathname}`;
      
      // Preserve original host in a header for the handler
      const response = NextResponse.rewrite(url);
      response.headers.set('X-Original-Host', host);
      response.headers.set('X-Custom-Domain', hostname);
      return response;
    }
  } catch (error) {
    console.error('Middleware error:', error);
    // On error, continue to normal routing
  }

  return NextResponse.next();
}

async function refreshDomainCache(request: NextRequest) {
  try {
    // Build internal API URL - always use http for internal requests
    const internalHost = request.headers.get('host') || 'localhost:3000';
    
    // Use http for local/internal requests to avoid SSL issues
    const apiUrl = `http://${internalHost}/api/endpoints/domains`;
    
    // Fetch custom domain mappings from internal API
    const response = await fetch(apiUrl, {
      headers: {
        'X-Internal-Request': 'true',
      },
    });

    if (response.ok) {
      const data = await response.json();
      const newCache = new Map<string, string>();
      
      for (const mapping of data.mappings || []) {
        if (mapping.customDomain && mapping.slug) {
          newCache.set(mapping.customDomain, mapping.slug);
        }
      }
      
      domainCache = newCache;
      lastCacheRefresh = Date.now();
    }
  } catch (error) {
    // Silently handle errors during cache refresh - the proxy will still work
    // console.error('Failed to refresh domain cache:', error);
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, favicon.svg (favicon files)
     * - public files (images, etc)
     */
    '/((?!_next/static|_next/image|favicon.ico|favicon.svg|.*\\.png$|.*\\.jpg$|.*\\.svg$).*)',
  ],
};
