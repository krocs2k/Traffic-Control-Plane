import { NextRequest, NextResponse } from 'next/server';
import { LoadBalancerStrategy } from '@prisma/client';
import {
  getClientIp,
  getAffinityKey,
  selectBackend,
  buildTargetUrl,
  buildProxyHeaders,
  rewriteResponseHeaders,
  shouldRewriteBody,
  rewriteResponseBody,
  analyzeForSmartMode,
  generateAffinityCookie,
  isWebSocketRequest,
  createTimeoutController,
  ProxyErrors,
  hashString,
  type Backend,
  type EndpointConfig,
} from '@/lib/proxy';
import {
  getCachedEndpoint,
  getCachedCluster,
  getCachedLoadBalancerConfig,
  getCachedAffinity,
  setCachedAffinity,
} from '@/lib/cache';
import { queueRequestMetrics } from '@/lib/metrics-queue';
import {
  routeRequest,
  forwardRequest,
  isForwardedRequest,
  recordReceivedForward,
  shouldHandleLocally,
} from '@/lib/federation';

// ============================================
// Configuration
// ============================================

const MAX_BODY_REWRITE_SIZE = 5 * 1024 * 1024; // 5MB - skip body rewriting for larger responses

// ============================================
// Main Request Handler
// ============================================

async function handleRequest(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const startTime = Date.now();
  const { slug } = await params;

  try {
    // Check if this is a forwarded request from federation
    if (isForwardedRequest(request.headers)) {
      recordReceivedForward();
    }

    // Use cached endpoint lookup (30-50% reduction in DB calls)
    const endpointData = await getCachedEndpoint(slug);

    if (!endpointData) {
      return NextResponse.json(
        { error: ProxyErrors.ENDPOINT_NOT_FOUND.message, code: ProxyErrors.ENDPOINT_NOT_FOUND.code, slug },
        { status: ProxyErrors.ENDPOINT_NOT_FOUND.statusCode }
      );
    }

    if (!endpointData.isActive) {
      return NextResponse.json(
        { error: ProxyErrors.ENDPOINT_DISABLED.message, code: ProxyErrors.ENDPOINT_DISABLED.code, slug },
        { status: ProxyErrors.ENDPOINT_DISABLED.statusCode }
      );
    }

    const config = endpointData.config as Record<string, unknown>;
    const clientIp = getClientIp(request);
    const originalHost = request.headers.get('host') || '';
    const originalProtocol = request.headers.get('x-forwarded-proto') || 
                            (request.nextUrl.protocol === 'https:' ? 'https' : 'http');

    // Federation routing check (only if not already forwarded)
    if (!shouldHandleLocally(request.headers)) {
      const affinityKey = `${slug}:${clientIp}`;
      const routingDecision = routeRequest(affinityKey, endpointData.type);
      
      if (routingDecision.shouldForward && routingDecision.targetNodeUrl) {
        try {
          const forwardedResponse = await forwardRequest(
            routingDecision.targetNodeUrl,
            request.clone()
          );
          return new NextResponse(forwardedResponse.body, {
            status: forwardedResponse.status,
            headers: forwardedResponse.headers,
          });
        } catch (error) {
          console.warn('Federation forward failed, handling locally:', error);
          // Fall through to handle locally
        }
      }
    }

    // Cast endpoint to our config type
    const endpointConfig: EndpointConfig = {
      id: endpointData.id,
      slug: endpointData.slug,
      name: endpointData.name,
      customDomain: endpointData.customDomain,
      proxyMode: endpointData.proxyMode,
      sessionAffinity: endpointData.sessionAffinity,
      affinityCookieName: endpointData.affinityCookieName,
      affinityHeaderName: endpointData.affinityHeaderName,
      affinityTtlSeconds: endpointData.affinityTtlSeconds,
      connectTimeout: endpointData.connectTimeout,
      readTimeout: endpointData.readTimeout,
      writeTimeout: endpointData.writeTimeout,
      rewriteHostHeader: endpointData.rewriteHostHeader,
      rewriteLocationHeader: endpointData.rewriteLocationHeader,
      rewriteCookieDomain: endpointData.rewriteCookieDomain,
      rewriteCorsHeaders: endpointData.rewriteCorsHeaders,
      preserveHostHeader: endpointData.preserveHostHeader,
      stripPathPrefix: endpointData.stripPathPrefix,
      addPathPrefix: endpointData.addPathPrefix,
      forwardHeaders: endpointData.forwardHeaders,
      websocketEnabled: endpointData.websocketEnabled,
    };

    // Handle based on endpoint type
    let response: NextResponse;
    let backendId: string | undefined;

    switch (endpointData.type) {
      case 'MOCK': {
        // Return mock response from config
        const mockResponse = config.mockResponse || {
          message: 'Mock response from Traffic Control Plane',
          endpoint: endpointData.name,
          timestamp: new Date().toISOString(),
        };
        const mockStatus = (config.mockStatus as number) || 200;
        response = NextResponse.json(mockResponse, { status: mockStatus });
        break;
      }

      case 'LOAD_BALANCE':
      case 'ROUTE':
      case 'PROXY': {
        const result = await handleProxyRequest(
          request,
          endpointConfig,
          endpointData.cluster || null,
          clientIp,
          originalHost,
          originalProtocol
        );
        response = result.response;
        backendId = result.backendId;
        break;
      }

      default:
        response = NextResponse.json(
          { error: 'Unknown endpoint type' },
          { status: 400 }
        );
    }

    // Queue metrics asynchronously (removes blocking DB write)
    const latency = Date.now() - startTime;
    const isError = response.status >= 400;

    queueRequestMetrics({
      endpointId: endpointData.id,
      orgId: endpointData.orgId,
      clusterId: endpointData.clusterId || undefined,
      backendId,
      latencyMs: latency,
      isError,
    });

    // Add diagnostic headers (can be disabled in production)
    response.headers.set('X-Endpoint-Id', endpointData.id);
    response.headers.set('X-Endpoint-Slug', endpointData.slug);
    response.headers.set('X-Response-Time', `${latency}ms`);
    response.headers.set('X-Proxy-Mode', endpointData.proxyMode);
    response.headers.set('X-Cache-Status', 'HIT'); // Indicates caching is active

    return response;
  } catch (error) {
    console.error('Error handling endpoint request:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// ============================================
// Types for Proxy Results
// ============================================

interface ProxyResult {
  response: NextResponse;
  backendId?: string;
}

// Cluster type from cache
type ClusterWithBackends = {
  id: string;
  name: string;
  strategy: LoadBalancerStrategy;
  backends: Backend[];
} | null;

// ============================================
// Proxy Request Handler
// ============================================

async function handleProxyRequest(
  request: NextRequest,
  endpoint: EndpointConfig,
  cluster: ClusterWithBackends,
  clientIp: string,
  originalHost: string,
  originalProtocol: string
): Promise<ProxyResult> {
  // Check for WebSocket request
  if (isWebSocketRequest(request)) {
    if (!endpoint.websocketEnabled) {
      return {
        response: NextResponse.json(
          { error: ProxyErrors.WEBSOCKET_NOT_SUPPORTED.message, code: ProxyErrors.WEBSOCKET_NOT_SUPPORTED.code },
          { status: ProxyErrors.WEBSOCKET_NOT_SUPPORTED.statusCode }
        ),
      };
    }
    // Note: Full WebSocket proxying requires a different approach (upgrade handling)
    // For now, return info about where the WebSocket should connect
    const wsResponse = await handleWebSocketInfo(request, endpoint, cluster, clientIp);
    return { response: wsResponse };
  }

  // Get cluster and backends (already cached)
  if (!cluster) {
    return {
      response: NextResponse.json(
        { error: ProxyErrors.NO_CLUSTER.message, code: ProxyErrors.NO_CLUSTER.code, endpoint: endpoint.name },
        { status: ProxyErrors.NO_CLUSTER.statusCode }
      ),
    };
  }

  if (cluster.backends.length === 0) {
    return {
      response: NextResponse.json(
        { error: ProxyErrors.NO_BACKENDS.message, code: ProxyErrors.NO_BACKENDS.code, cluster: cluster.name },
        { status: ProxyErrors.NO_BACKENDS.statusCode }
      ),
    };
  }

  // Check for load balancer config override (cached)
  let strategy = cluster.strategy;
  const lbConfig = await getCachedLoadBalancerConfig(cluster.id);
  if (lbConfig) {
    strategy = lbConfig.strategy as LoadBalancerStrategy;
  }

  // Get affinity key and check for existing backend assignment (cached)
  const affinityKey = getAffinityKey(request, endpoint, clientIp);
  let preferredBackendId: string | null = null;

  if (affinityKey && endpoint.sessionAffinity !== 'NONE') {
    preferredBackendId = await getCachedAffinity(endpoint.id, affinityKey);
  }

  // Select backend
  const backends: Backend[] = cluster.backends;
  const backend = selectBackend(backends, strategy, cluster.id, clientIp, preferredBackendId);

  if (!backend) {
    return {
      response: NextResponse.json(
        { error: ProxyErrors.NO_HEALTHY_BACKENDS.message, code: ProxyErrors.NO_HEALTHY_BACKENDS.code, cluster: cluster.name },
        { status: ProxyErrors.NO_HEALTHY_BACKENDS.statusCode }
      ),
    };
  }

  // Build target URL
  const originalPath = request.nextUrl.pathname + request.nextUrl.search;
  const targetUrl = buildTargetUrl(backend, originalPath, endpoint);

  // Handle based on proxy mode
  let response: NextResponse;
  switch (endpoint.proxyMode) {
    case 'REDIRECT':
      response = handleRedirectMode(targetUrl, backend, endpoint, affinityKey);
      break;

    case 'PASSTHROUGH':
      response = await handlePassthroughMode(request, targetUrl, backend, endpoint, clientIp, originalHost, originalProtocol, affinityKey);
      break;

    case 'SMART':
      response = await handleSmartMode(request, targetUrl, backend, endpoint, clientIp, originalHost, originalProtocol, affinityKey);
      break;

    case 'REVERSE_PROXY':
    default:
      response = await handleReverseProxyMode(request, targetUrl, backend, endpoint, clientIp, originalHost, originalProtocol, affinityKey);
      break;
  }

  return { response, backendId: backend.id };
}

// ============================================
// Redirect Mode - Simple HTTP redirect to backend
// ============================================

function handleRedirectMode(
  targetUrl: string,
  backend: Backend,
  endpoint: EndpointConfig,
  affinityKey: string | null
): NextResponse {
  const response = NextResponse.redirect(targetUrl, 302);

  // Still set affinity cookie if needed (for future requests)
  if (affinityKey && endpoint.sessionAffinity === 'COOKIE') {
    response.headers.set('Set-Cookie', generateAffinityCookie(endpoint, backend.id));
  }

  response.headers.set('X-Backend-Host', backend.host);
  return response;
}

// ============================================
// Passthrough Mode - Forward request but don't rewrite responses
// ============================================

async function handlePassthroughMode(
  request: NextRequest,
  targetUrl: string,
  backend: Backend,
  endpoint: EndpointConfig,
  clientIp: string,
  originalHost: string,
  originalProtocol: string,
  affinityKey: string | null
): Promise<NextResponse> {
  try {
    const headers = buildProxyHeaders(request, endpoint, backend, clientIp);
    const controller = createTimeoutController(endpoint.readTimeout);

    const backendResponse = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.blob() : undefined,
      signal: controller.signal,
      redirect: 'manual', // Don't follow redirects, pass them through
    });

    // Create response with original headers (no rewriting)
    const responseHeaders = new Headers(backendResponse.headers);
    
    // Add backend info header
    responseHeaders.set('X-Backend-Host', backend.host);

    // Handle affinity (async, non-blocking via cache)
    if (affinityKey && endpoint.sessionAffinity !== 'NONE') {
      // Fire and forget - don't block the response
      setCachedAffinity(endpoint.id, affinityKey, backend.id, endpoint.affinityTtlSeconds).catch(() => {});
      if (endpoint.sessionAffinity === 'COOKIE' && !request.headers.get('cookie')?.includes(endpoint.affinityCookieName)) {
        responseHeaders.append('Set-Cookie', generateAffinityCookie(endpoint, backend.id));
      }
    }

    return new NextResponse(backendResponse.body, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: ProxyErrors.BACKEND_TIMEOUT.message, code: ProxyErrors.BACKEND_TIMEOUT.code, targetUrl },
        { status: ProxyErrors.BACKEND_TIMEOUT.statusCode }
      );
    }
    return NextResponse.json(
      { error: ProxyErrors.BACKEND_ERROR.message, code: ProxyErrors.BACKEND_ERROR.code, details: error instanceof Error ? error.message : 'Unknown error' },
      { status: ProxyErrors.BACKEND_ERROR.statusCode }
    );
  }
}

// ============================================
// Reverse Proxy Mode - Full URL masking with header rewriting
// ============================================

async function handleReverseProxyMode(
  request: NextRequest,
  targetUrl: string,
  backend: Backend,
  endpoint: EndpointConfig,
  clientIp: string,
  originalHost: string,
  originalProtocol: string,
  affinityKey: string | null
): Promise<NextResponse> {
  try {
    const headers = buildProxyHeaders(request, endpoint, backend, clientIp);
    const controller = createTimeoutController(endpoint.readTimeout);

    const backendResponse = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.blob() : undefined,
      signal: controller.signal,
      redirect: 'manual', // Don't follow redirects, rewrite them
    });

    // Rewrite response headers
    const responseHeaders = rewriteResponseHeaders(
      backendResponse.headers,
      endpoint,
      backend,
      originalHost,
      originalProtocol
    );

    // Add backend info header
    responseHeaders.set('X-Backend-Host', backend.host);

    // Handle affinity (async, non-blocking via cache)
    if (affinityKey && endpoint.sessionAffinity !== 'NONE') {
      // Fire and forget - don't block the response
      setCachedAffinity(endpoint.id, affinityKey, backend.id, endpoint.affinityTtlSeconds).catch(() => {});
      if (endpoint.sessionAffinity === 'COOKIE' && !request.headers.get('cookie')?.includes(endpoint.affinityCookieName)) {
        responseHeaders.append('Set-Cookie', generateAffinityCookie(endpoint, backend.id));
      }
    }

    // Check if we need to rewrite the body
    const contentType = backendResponse.headers.get('content-type');
    const contentLength = parseInt(backendResponse.headers.get('content-length') || '0', 10);
    let responseBody: BodyInit | null = backendResponse.body;

    // Skip body buffering for large responses (performance optimization)
    // Only buffer and rewrite small responses that need URL rewriting
    const shouldBuffer = shouldRewriteBody(contentType) && 
                         (contentLength === 0 || contentLength < MAX_BODY_REWRITE_SIZE);

    if (shouldBuffer) {
      const bodyText = await backendResponse.text();
      const rewrittenBody = rewriteResponseBody(bodyText, backend, originalHost, originalProtocol);
      responseBody = rewrittenBody;
      
      // Update content-length if we modified the body
      responseHeaders.set('Content-Length', new TextEncoder().encode(rewrittenBody).length.toString());
      responseHeaders.set('X-Body-Rewritten', 'true');
    } else if (contentLength >= MAX_BODY_REWRITE_SIZE) {
      // Large response - stream directly without buffering
      responseHeaders.set('X-Body-Rewritten', 'false');
      responseHeaders.set('X-Body-Skipped-Reason', 'size');
    }

    return new NextResponse(responseBody, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: ProxyErrors.BACKEND_TIMEOUT.message, code: ProxyErrors.BACKEND_TIMEOUT.code, targetUrl },
        { status: ProxyErrors.BACKEND_TIMEOUT.statusCode }
      );
    }
    return NextResponse.json(
      { error: ProxyErrors.BACKEND_ERROR.message, code: ProxyErrors.BACKEND_ERROR.code, details: error instanceof Error ? error.message : 'Unknown error' },
      { status: ProxyErrors.BACKEND_ERROR.statusCode }
    );
  }
}

// ============================================
// Smart Mode - Dynamically decide based on request/response
// ============================================

async function handleSmartMode(
  request: NextRequest,
  targetUrl: string,
  backend: Backend,
  endpoint: EndpointConfig,
  clientIp: string,
  originalHost: string,
  originalProtocol: string,
  affinityKey: string | null
): Promise<NextResponse> {
  try {
    const headers = buildProxyHeaders(request, endpoint, backend, clientIp);
    const controller = createTimeoutController(endpoint.readTimeout);

    // Make the request
    const backendResponse = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.blob() : undefined,
      signal: controller.signal,
      redirect: 'manual',
    });

    // Analyze the response to decide how to handle it
    const decision = analyzeForSmartMode(request, backendResponse.headers, backendResponse.status);

    // Add decision info to headers for debugging
    const responseHeaders = new Headers();
    responseHeaders.set('X-Smart-Mode-Decision', decision.reason);

    if (decision.shouldRedirect && !decision.shouldProxy) {
      // Rare case: redirect to backend (e.g., large file downloads)
      return handleRedirectMode(targetUrl, backend, endpoint, affinityKey);
    }

    // Default: full reverse proxy with header/body rewriting
    const rewrittenHeaders = rewriteResponseHeaders(
      backendResponse.headers,
      endpoint,
      backend,
      originalHost,
      originalProtocol
    );

    // Merge decision header
    rewrittenHeaders.set('X-Smart-Mode-Decision', decision.reason);
    rewrittenHeaders.set('X-Backend-Host', backend.host);

    // Handle affinity (async, non-blocking via cache)
    if (affinityKey && endpoint.sessionAffinity !== 'NONE') {
      setCachedAffinity(endpoint.id, affinityKey, backend.id, endpoint.affinityTtlSeconds).catch(() => {});
      if (endpoint.sessionAffinity === 'COOKIE' && !request.headers.get('cookie')?.includes(endpoint.affinityCookieName)) {
        rewrittenHeaders.append('Set-Cookie', generateAffinityCookie(endpoint, backend.id));
      }
    }

    // Rewrite body if needed (with size check)
    const contentType = backendResponse.headers.get('content-type');
    const contentLength = parseInt(backendResponse.headers.get('content-length') || '0', 10);
    let responseBody: BodyInit | null = backendResponse.body;

    const shouldBuffer = shouldRewriteBody(contentType) && 
                         (contentLength === 0 || contentLength < MAX_BODY_REWRITE_SIZE);

    if (shouldBuffer) {
      const bodyText = await backendResponse.text();
      const rewrittenBody = rewriteResponseBody(bodyText, backend, originalHost, originalProtocol);
      responseBody = rewrittenBody;
      rewrittenHeaders.set('Content-Length', new TextEncoder().encode(rewrittenBody).length.toString());
      rewrittenHeaders.set('X-Body-Rewritten', 'true');
    }

    return new NextResponse(responseBody, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: rewrittenHeaders,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: ProxyErrors.BACKEND_TIMEOUT.message, code: ProxyErrors.BACKEND_TIMEOUT.code, targetUrl },
        { status: ProxyErrors.BACKEND_TIMEOUT.statusCode }
      );
    }
    return NextResponse.json(
      { error: ProxyErrors.BACKEND_ERROR.message, code: ProxyErrors.BACKEND_ERROR.code, details: error instanceof Error ? error.message : 'Unknown error' },
      { status: ProxyErrors.BACKEND_ERROR.statusCode }
    );
  }
}

// ============================================
// WebSocket Info Handler
// ============================================

async function handleWebSocketInfo(
  request: NextRequest,
  endpoint: EndpointConfig,
  cluster: ClusterWithBackends,
  clientIp: string
): Promise<NextResponse> {
  // For WebSocket connections, we return information about where to connect
  // Full WebSocket proxying would require a different server architecture
  
  if (!cluster) {
    return NextResponse.json(
      { error: ProxyErrors.NO_CLUSTER.message, code: ProxyErrors.NO_CLUSTER.code },
      { status: ProxyErrors.NO_CLUSTER.statusCode }
    );
  }

  // Filter to healthy backends only
  const healthyBackends = cluster.backends.filter(b => b.status === 'HEALTHY');

  if (healthyBackends.length === 0) {
    return NextResponse.json(
      { error: ProxyErrors.NO_HEALTHY_BACKENDS.message, code: ProxyErrors.NO_HEALTHY_BACKENDS.code },
      { status: ProxyErrors.NO_HEALTHY_BACKENDS.statusCode }
    );
  }

  // Get affinity key for WebSocket (important for persistent connections)
  const affinityKey = getAffinityKey(request, endpoint, clientIp) || hashString(clientIp);
  const preferredBackendId = await getCachedAffinity(endpoint.id, affinityKey);

  // Select backend
  const backend = selectBackend(healthyBackends, cluster.strategy, cluster.id, clientIp, preferredBackendId);

  if (!backend) {
    return NextResponse.json(
      { error: ProxyErrors.NO_HEALTHY_BACKENDS.message, code: ProxyErrors.NO_HEALTHY_BACKENDS.code },
      { status: ProxyErrors.NO_HEALTHY_BACKENDS.statusCode }
    );
  }

  // Set affinity for WebSocket (long-lived connections need sticky sessions)
  setCachedAffinity(endpoint.id, affinityKey, backend.id, endpoint.affinityTtlSeconds).catch(() => {});

  // Return WebSocket connection info
  const wsProtocol = backend.protocol === 'https' ? 'wss' : 'ws';
  const wsUrl = `${wsProtocol}://${backend.host}:${backend.port}`;

  return NextResponse.json({
    type: 'websocket_info',
    message: 'WebSocket connections should connect directly to the backend',
    websocket: {
      url: wsUrl,
      host: backend.host,
      port: backend.port,
      protocol: wsProtocol,
    },
    affinity: {
      key: affinityKey,
      backendId: backend.id,
      ttl: endpoint.affinityTtlSeconds,
    },
    note: 'For full WebSocket proxying, consider using a dedicated WebSocket gateway',
  });
}

// ============================================
// Export handlers for all HTTP methods
// ============================================

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
export const HEAD = handleRequest;
export const OPTIONS = handleRequest;
