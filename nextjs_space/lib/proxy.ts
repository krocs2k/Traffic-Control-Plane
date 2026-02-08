import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { LoadBalancerStrategy, BackendStatus, SessionAffinityMode, ProxyMode } from '@prisma/client';
import crypto from 'crypto';

// Types
export interface Backend {
  id: string;
  host: string;
  port: number;
  protocol: string;
  weight: number;
  status: BackendStatus;
  currentConnections: number;
  maxConnections: number | null;
}

export interface EndpointConfig {
  id: string;
  slug: string;
  name: string;
  customDomain: string | null;
  proxyMode: ProxyMode;
  sessionAffinity: SessionAffinityMode;
  affinityCookieName: string;
  affinityHeaderName: string | null;
  affinityTtlSeconds: number;
  connectTimeout: number;
  readTimeout: number;
  writeTimeout: number;
  rewriteHostHeader: boolean;
  rewriteLocationHeader: boolean;
  rewriteCookieDomain: boolean;
  rewriteCorsHeaders: boolean;
  preserveHostHeader: boolean;
  stripPathPrefix: string | null;
  addPathPrefix: string | null;
  forwardHeaders: string[];
  websocketEnabled: boolean;
}

export interface ProxyContext {
  endpoint: EndpointConfig;
  backend: Backend;
  clientIp: string;
  originalHost: string;
  originalProtocol: string;
  originalPath: string;
  targetUrl: string;
  affinityKey: string | null;
}

// Round-robin counter per cluster (in-memory)
const roundRobinCounters: Map<string, number> = new Map();

// ============================================
// Client Identification
// ============================================

export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip') || '127.0.0.1';
}

export function hashString(str: string): string {
  return crypto.createHash('sha256').update(str).digest('hex').substring(0, 32);
}

// ============================================
// Session Affinity
// ============================================

export function getAffinityKey(
  request: NextRequest,
  endpoint: EndpointConfig,
  clientIp: string
): string | null {
  switch (endpoint.sessionAffinity) {
    case 'NONE':
      return null;

    case 'COOKIE': {
      const cookies = request.headers.get('cookie') || '';
      const cookieMatch = cookies.match(new RegExp(`${endpoint.affinityCookieName}=([^;]+)`));
      return cookieMatch ? cookieMatch[1] : null;
    }

    case 'IP_HASH':
      return hashString(clientIp);

    case 'HEADER': {
      if (!endpoint.affinityHeaderName) return null;
      const headerValue = request.headers.get(endpoint.affinityHeaderName);
      return headerValue ? hashString(headerValue) : null;
    }

    default:
      return null;
  }
}

export async function getAffinityBackend(
  endpointId: string,
  affinityKey: string
): Promise<string | null> {
  const mapping = await prisma.affinityMapping.findUnique({
    where: {
      endpointId_clientKey: {
        endpointId,
        clientKey: affinityKey,
      },
    },
  });

  if (mapping && mapping.expiresAt > new Date()) {
    return mapping.backendId;
  }

  // Clean up expired mapping
  if (mapping) {
    await prisma.affinityMapping.delete({
      where: { id: mapping.id },
    }).catch(() => {});
  }

  return null;
}

export async function setAffinityMapping(
  endpointId: string,
  affinityKey: string,
  backendId: string,
  ttlSeconds: number
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await prisma.affinityMapping.upsert({
    where: {
      endpointId_clientKey: {
        endpointId,
        clientKey: affinityKey,
      },
    },
    update: {
      backendId,
      expiresAt,
    },
    create: {
      endpointId,
      clientKey: affinityKey,
      backendId,
      expiresAt,
    },
  });
}

// ============================================
// Load Balancing
// ============================================

export function selectBackend(
  backends: Backend[],
  strategy: LoadBalancerStrategy,
  clusterId: string,
  clientIp?: string,
  preferredBackendId?: string | null
): Backend | null {
  // Filter to healthy backends
  const healthyBackends = backends.filter(b => b.status === 'HEALTHY');

  if (healthyBackends.length === 0) return null;

  // If we have a preferred backend (from affinity) and it's healthy, use it
  if (preferredBackendId) {
    const preferred = healthyBackends.find(b => b.id === preferredBackendId);
    if (preferred) return preferred;
  }

  if (healthyBackends.length === 1) return healthyBackends[0];

  switch (strategy) {
    case 'ROUND_ROBIN': {
      const counter = roundRobinCounters.get(clusterId) || 0;
      const selected = healthyBackends[counter % healthyBackends.length];
      roundRobinCounters.set(clusterId, counter + 1);
      return selected;
    }

    case 'LEAST_CONNECTIONS': {
      return healthyBackends.reduce((min, b) =>
        b.currentConnections < min.currentConnections ? b : min
      );
    }

    case 'RANDOM': {
      return healthyBackends[Math.floor(Math.random() * healthyBackends.length)];
    }

    case 'IP_HASH': {
      if (!clientIp) return healthyBackends[0];
      const hash = clientIp.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      return healthyBackends[hash % healthyBackends.length];
    }

    case 'WEIGHTED_ROUND_ROBIN': {
      const totalWeight = healthyBackends.reduce((sum, b) => sum + b.weight, 0);
      let random = Math.random() * totalWeight;
      for (const backend of healthyBackends) {
        random -= backend.weight;
        if (random <= 0) return backend;
      }
      return healthyBackends[0];
    }

    default:
      return healthyBackends[0];
  }
}

// ============================================
// URL and Path Manipulation
// ============================================

export function buildTargetUrl(
  backend: Backend,
  originalPath: string,
  endpoint: EndpointConfig
): string {
  let path = originalPath;

  // Strip endpoint slug from path (e.g., /e/api-main -> /)
  const slugPattern = new RegExp(`^/e/${endpoint.slug}(/|$)`);
  path = path.replace(slugPattern, '/');

  // Strip prefix if configured
  if (endpoint.stripPathPrefix) {
    const stripPattern = new RegExp(`^${endpoint.stripPathPrefix}`);
    path = path.replace(stripPattern, '');
  }

  // Add prefix if configured
  if (endpoint.addPathPrefix) {
    path = endpoint.addPathPrefix + path;
  }

  // Ensure path starts with /
  if (!path.startsWith('/')) {
    path = '/' + path;
  }

  return `${backend.protocol}://${backend.host}:${backend.port}${path}`;
}

// ============================================
// Header Rewriting
// ============================================

export function buildProxyHeaders(
  request: NextRequest,
  endpoint: EndpointConfig,
  backend: Backend,
  clientIp: string
): Headers {
  const headers = new Headers();

  // Copy original headers (except hop-by-hop headers)
  const hopByHopHeaders = [
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailers', 'transfer-encoding', 'upgrade', 'host'
  ];

  request.headers.forEach((value, key) => {
    if (!hopByHopHeaders.includes(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  // Set Host header
  if (endpoint.preserveHostHeader) {
    headers.set('Host', request.headers.get('host') || '');
  } else if (endpoint.rewriteHostHeader) {
    headers.set('Host', `${backend.host}:${backend.port}`);
  }

  // Add forwarding headers
  const originalHost = request.headers.get('host') || '';
  const originalProto = request.headers.get('x-forwarded-proto') || 
                        (request.nextUrl.protocol === 'https:' ? 'https' : 'http');

  if (endpoint.forwardHeaders.includes('X-Forwarded-For')) {
    const existingForwarded = request.headers.get('x-forwarded-for');
    headers.set('X-Forwarded-For', existingForwarded ? `${existingForwarded}, ${clientIp}` : clientIp);
  }

  if (endpoint.forwardHeaders.includes('X-Forwarded-Proto')) {
    headers.set('X-Forwarded-Proto', originalProto);
  }

  if (endpoint.forwardHeaders.includes('X-Forwarded-Host')) {
    headers.set('X-Forwarded-Host', originalHost);
  }

  if (endpoint.forwardHeaders.includes('X-Real-IP')) {
    headers.set('X-Real-IP', clientIp);
  }

  // Add custom proxy headers
  headers.set('X-Proxy-Endpoint', endpoint.slug);
  headers.set('X-Proxy-Backend', backend.id);

  return headers;
}

export function rewriteResponseHeaders(
  responseHeaders: Headers,
  endpoint: EndpointConfig,
  backend: Backend,
  originalHost: string,
  originalProtocol: string
): Headers {
  const headers = new Headers();
  const backendOrigin = `${backend.protocol}://${backend.host}:${backend.port}`;
  const proxyOrigin = `${originalProtocol}://${originalHost}`;

  responseHeaders.forEach((value, key) => {
    let newValue = value;
    const keyLower = key.toLowerCase();

    // Rewrite Location headers (redirects)
    if (keyLower === 'location' && endpoint.rewriteLocationHeader) {
      newValue = rewriteUrl(value, backend, originalHost, originalProtocol, endpoint.slug);
    }

    // Rewrite Set-Cookie domain
    if (keyLower === 'set-cookie' && endpoint.rewriteCookieDomain) {
      // Remove or replace domain attribute
      newValue = value
        .replace(/domain=[^;]+;?/gi, '')
        .replace(/;\s*$/, '');
      
      // If backend set a specific domain, we might need to map it
      if (value.toLowerCase().includes('domain=')) {
        // Extract the original domain and map to proxy domain
        const domainMatch = originalHost.match(/^(?:[^:]+)/)?.[0] || originalHost;
        if (!newValue.toLowerCase().includes('domain=')) {
          newValue += `; Domain=${domainMatch}`;
        }
      }
    }

    // Rewrite CORS headers
    if (endpoint.rewriteCorsHeaders) {
      if (keyLower === 'access-control-allow-origin') {
        // Replace backend origin with proxy origin, or keep * as is
        if (value !== '*' && value.includes(backend.host)) {
          newValue = proxyOrigin;
        }
      }
    }

    // Rewrite any embedded URLs in content-related headers
    if (keyLower === 'content-location' || keyLower === 'link') {
      newValue = rewriteUrl(value, backend, originalHost, originalProtocol, endpoint.slug);
    }

    headers.append(key, newValue);
  });

  return headers;
}

export function rewriteUrl(
  url: string,
  backend: Backend,
  originalHost: string,
  originalProtocol: string,
  endpointSlug: string
): string {
  const backendOrigins = [
    `${backend.protocol}://${backend.host}:${backend.port}`,
    `${backend.protocol}://${backend.host}`,
    `//${backend.host}:${backend.port}`,
    `//${backend.host}`,
  ];

  let result = url;

  for (const origin of backendOrigins) {
    if (result.startsWith(origin)) {
      result = result.replace(origin, `${originalProtocol}://${originalHost}`);
      break;
    }
  }

  return result;
}

// ============================================
// Response Body Rewriting (for SMART mode)
// ============================================

export function shouldRewriteBody(contentType: string | null): boolean {
  if (!contentType) return false;
  const rewritableTypes = [
    'text/html',
    'text/css',
    'application/javascript',
    'application/json',
    'text/javascript',
    'application/xml',
    'text/xml',
  ];
  return rewritableTypes.some(type => contentType.includes(type));
}

export function rewriteResponseBody(
  body: string,
  backend: Backend,
  originalHost: string,
  originalProtocol: string
): string {
  const backendPatterns = [
    `${backend.protocol}://${backend.host}:${backend.port}`,
    `${backend.protocol}://${backend.host}`,
    `\\/\\/${backend.host}:${backend.port}`, // JSON escaped
    `\\/\\/${backend.host}`,
  ];

  let result = body;
  const proxyOrigin = `${originalProtocol}://${originalHost}`;

  for (const pattern of backendPatterns) {
    const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    result = result.replace(regex, proxyOrigin);
  }

  return result;
}

// ============================================
// Smart Mode Detection
// ============================================

export interface SmartModeDecision {
  shouldProxy: boolean;
  shouldRedirect: boolean;
  reason: string;
}

export function analyzeForSmartMode(
  request: NextRequest,
  responseHeaders: Headers,
  statusCode: number
): SmartModeDecision {
  // Check for WebSocket upgrade
  const upgradeHeader = request.headers.get('upgrade');
  if (upgradeHeader?.toLowerCase() === 'websocket') {
    return {
      shouldProxy: true,
      shouldRedirect: false,
      reason: 'WebSocket connection requires proxy mode',
    };
  }

  // Check for streaming response
  const contentType = responseHeaders.get('content-type');
  if (contentType?.includes('text/event-stream') || contentType?.includes('application/octet-stream')) {
    return {
      shouldProxy: true,
      shouldRedirect: false,
      reason: 'Streaming content requires proxy mode',
    };
  }

  // Check for authentication-related responses
  if (statusCode === 401 || statusCode === 403) {
    return {
      shouldProxy: true,
      shouldRedirect: false,
      reason: 'Authentication response should be proxied',
    };
  }

  // Check for cookies being set (session management)
  if (responseHeaders.has('set-cookie')) {
    return {
      shouldProxy: true,
      shouldRedirect: false,
      reason: 'Session cookies require proxy mode for domain consistency',
    };
  }

  // Check for API responses (typically JSON)
  if (contentType?.includes('application/json')) {
    return {
      shouldProxy: true,
      shouldRedirect: false,
      reason: 'API responses should be proxied for CORS consistency',
    };
  }

  // For static assets, redirect might be acceptable
  const staticExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.ico', '.css', '.js', '.woff', '.woff2', '.ttf'];
  const path = request.nextUrl.pathname;
  const isStatic = staticExtensions.some(ext => path.endsWith(ext));
  if (isStatic && !responseHeaders.has('set-cookie')) {
    return {
      shouldProxy: true, // Still prefer proxy for consistency, but redirect would work
      shouldRedirect: false,
      reason: 'Static asset - proxy preferred but redirect acceptable',
    };
  }

  // Default to proxy mode for safety
  return {
    shouldProxy: true,
    shouldRedirect: false,
    reason: 'Default to proxy mode for URL consistency',
  };
}

// ============================================
// Affinity Cookie Generation
// ============================================

export function generateAffinityCookie(
  endpoint: EndpointConfig,
  backendId: string
): string {
  const value = hashString(`${endpoint.id}:${backendId}:${Date.now()}`);
  const maxAge = endpoint.affinityTtlSeconds;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  
  return `${endpoint.affinityCookieName}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

// ============================================
// WebSocket Detection
// ============================================

export function isWebSocketRequest(request: NextRequest): boolean {
  const upgradeHeader = request.headers.get('upgrade');
  const connectionHeader = request.headers.get('connection');
  
  return Boolean(
    upgradeHeader?.toLowerCase() === 'websocket' &&
    connectionHeader?.toLowerCase().includes('upgrade')
  );
}

// ============================================
// Timeout Controller
// ============================================

export function createTimeoutController(timeoutMs: number): AbortController {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller;
}

// ============================================
// Error Response Builder
// ============================================

export interface ProxyError {
  code: string;
  message: string;
  statusCode: number;
  details?: Record<string, unknown>;
}

export function createProxyError(
  code: string,
  message: string,
  statusCode: number,
  details?: Record<string, unknown>
): ProxyError {
  return { code, message, statusCode, details };
}

export const ProxyErrors = {
  ENDPOINT_NOT_FOUND: createProxyError('ENDPOINT_NOT_FOUND', 'Endpoint not found', 404),
  ENDPOINT_DISABLED: createProxyError('ENDPOINT_DISABLED', 'Endpoint is disabled', 503),
  NO_CLUSTER: createProxyError('NO_CLUSTER', 'No backend cluster configured', 502),
  NO_BACKENDS: createProxyError('NO_BACKENDS', 'No backends available', 502),
  NO_HEALTHY_BACKENDS: createProxyError('NO_HEALTHY_BACKENDS', 'No healthy backends available', 503),
  BACKEND_TIMEOUT: createProxyError('BACKEND_TIMEOUT', 'Backend request timeout', 504),
  BACKEND_ERROR: createProxyError('BACKEND_ERROR', 'Backend request failed', 502),
  WEBSOCKET_NOT_SUPPORTED: createProxyError('WEBSOCKET_NOT_SUPPORTED', 'WebSocket connections not supported for this endpoint', 400),
};
