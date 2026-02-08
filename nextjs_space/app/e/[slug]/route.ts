import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { LoadBalancerStrategy } from '@prisma/client';
import {
  getClientIp,
  getAffinityKey,
  getAffinityBackend,
  setAffinityMapping,
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
    // Find the endpoint
    const endpoint = await prisma.trafficEndpoint.findUnique({
      where: { slug },
    });

    if (!endpoint) {
      return NextResponse.json(
        { error: ProxyErrors.ENDPOINT_NOT_FOUND.message, code: ProxyErrors.ENDPOINT_NOT_FOUND.code, slug },
        { status: ProxyErrors.ENDPOINT_NOT_FOUND.statusCode }
      );
    }

    if (!endpoint.isActive) {
      return NextResponse.json(
        { error: ProxyErrors.ENDPOINT_DISABLED.message, code: ProxyErrors.ENDPOINT_DISABLED.code, slug },
        { status: ProxyErrors.ENDPOINT_DISABLED.statusCode }
      );
    }

    const config = endpoint.config as Record<string, unknown>;
    const clientIp = getClientIp(request);
    const originalHost = request.headers.get('host') || '';
    const originalProtocol = request.headers.get('x-forwarded-proto') || 
                            (request.nextUrl.protocol === 'https:' ? 'https' : 'http');

    // Cast endpoint to our config type
    const endpointConfig: EndpointConfig = {
      id: endpoint.id,
      slug: endpoint.slug,
      name: endpoint.name,
      customDomain: endpoint.customDomain,
      proxyMode: endpoint.proxyMode,
      sessionAffinity: endpoint.sessionAffinity,
      affinityCookieName: endpoint.affinityCookieName,
      affinityHeaderName: endpoint.affinityHeaderName,
      affinityTtlSeconds: endpoint.affinityTtlSeconds,
      connectTimeout: endpoint.connectTimeout,
      readTimeout: endpoint.readTimeout,
      writeTimeout: endpoint.writeTimeout,
      rewriteHostHeader: endpoint.rewriteHostHeader,
      rewriteLocationHeader: endpoint.rewriteLocationHeader,
      rewriteCookieDomain: endpoint.rewriteCookieDomain,
      rewriteCorsHeaders: endpoint.rewriteCorsHeaders,
      preserveHostHeader: endpoint.preserveHostHeader,
      stripPathPrefix: endpoint.stripPathPrefix,
      addPathPrefix: endpoint.addPathPrefix,
      forwardHeaders: endpoint.forwardHeaders,
      websocketEnabled: endpoint.websocketEnabled,
    };

    // Handle based on endpoint type
    let response: NextResponse;

    switch (endpoint.type) {
      case 'MOCK': {
        // Return mock response from config
        const mockResponse = config.mockResponse || {
          message: 'Mock response from Traffic Control Plane',
          endpoint: endpoint.name,
          timestamp: new Date().toISOString(),
        };
        const mockStatus = (config.mockStatus as number) || 200;
        response = NextResponse.json(mockResponse, { status: mockStatus });
        break;
      }

      case 'LOAD_BALANCE':
      case 'ROUTE':
      case 'PROXY': {
        response = await handleProxyRequest(
          request,
          endpointConfig,
          endpoint.clusterId,
          clientIp,
          originalHost,
          originalProtocol
        );
        break;
      }

      default:
        response = NextResponse.json(
          { error: 'Unknown endpoint type' },
          { status: 400 }
        );
    }

    // Update statistics
    const latency = Date.now() - startTime;
    const isError = response.status >= 400;

    await prisma.trafficEndpoint.update({
      where: { id: endpoint.id },
      data: {
        totalRequests: { increment: 1 },
        totalErrors: isError ? { increment: 1 } : undefined,
        avgLatencyMs: latency,
        lastRequestAt: new Date(),
      },
    }).catch(console.error);

    // Add diagnostic headers (can be disabled in production)
    response.headers.set('X-Endpoint-Id', endpoint.id);
    response.headers.set('X-Endpoint-Slug', endpoint.slug);
    response.headers.set('X-Response-Time', `${latency}ms`);
    response.headers.set('X-Proxy-Mode', endpoint.proxyMode);

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
// Proxy Request Handler
// ============================================

async function handleProxyRequest(
  request: NextRequest,
  endpoint: EndpointConfig,
  clusterId: string | null,
  clientIp: string,
  originalHost: string,
  originalProtocol: string
): Promise<NextResponse> {
  // Check for WebSocket request
  if (isWebSocketRequest(request)) {
    if (!endpoint.websocketEnabled) {
      return NextResponse.json(
        { error: ProxyErrors.WEBSOCKET_NOT_SUPPORTED.message, code: ProxyErrors.WEBSOCKET_NOT_SUPPORTED.code },
        { status: ProxyErrors.WEBSOCKET_NOT_SUPPORTED.statusCode }
      );
    }
    // Note: Full WebSocket proxying requires a different approach (upgrade handling)
    // For now, return info about where the WebSocket should connect
    return await handleWebSocketInfo(request, endpoint, clusterId, clientIp);
  }

  // Get cluster and backends
  if (!clusterId) {
    return NextResponse.json(
      { error: ProxyErrors.NO_CLUSTER.message, code: ProxyErrors.NO_CLUSTER.code, endpoint: endpoint.name },
      { status: ProxyErrors.NO_CLUSTER.statusCode }
    );
  }

  const cluster = await prisma.backendCluster.findUnique({
    where: { id: clusterId },
    include: {
      backends: {
        where: { isActive: true },
      },
    },
  });

  if (!cluster || cluster.backends.length === 0) {
    return NextResponse.json(
      { error: ProxyErrors.NO_BACKENDS.message, code: ProxyErrors.NO_BACKENDS.code, cluster: cluster?.name },
      { status: ProxyErrors.NO_BACKENDS.statusCode }
    );
  }

  // Check for load balancer config override
  let strategy = cluster.strategy;
  const lbConfig = await prisma.loadBalancerConfig.findFirst({
    where: { clusterId },
  });
  if (lbConfig) {
    strategy = lbConfig.strategy as LoadBalancerStrategy;
  }

  // Get affinity key and check for existing backend assignment
  const affinityKey = getAffinityKey(request, endpoint, clientIp);
  let preferredBackendId: string | null = null;

  if (affinityKey && endpoint.sessionAffinity !== 'NONE') {
    preferredBackendId = await getAffinityBackend(endpoint.id, affinityKey);
  }

  // Select backend
  const backends: Backend[] = cluster.backends;
  const backend = selectBackend(backends, strategy, cluster.id, clientIp, preferredBackendId);

  if (!backend) {
    return NextResponse.json(
      { error: ProxyErrors.NO_HEALTHY_BACKENDS.message, code: ProxyErrors.NO_HEALTHY_BACKENDS.code, cluster: cluster.name },
      { status: ProxyErrors.NO_HEALTHY_BACKENDS.statusCode }
    );
  }

  // Build target URL
  const originalPath = request.nextUrl.pathname + request.nextUrl.search;
  const targetUrl = buildTargetUrl(backend, originalPath, endpoint);

  // Handle based on proxy mode
  switch (endpoint.proxyMode) {
    case 'REDIRECT':
      return handleRedirectMode(targetUrl, backend, endpoint, affinityKey);

    case 'PASSTHROUGH':
      return handlePassthroughMode(request, targetUrl, backend, endpoint, clientIp, originalHost, originalProtocol, affinityKey);

    case 'SMART':
      return handleSmartMode(request, targetUrl, backend, endpoint, clientIp, originalHost, originalProtocol, affinityKey);

    case 'REVERSE_PROXY':
    default:
      return handleReverseProxyMode(request, targetUrl, backend, endpoint, clientIp, originalHost, originalProtocol, affinityKey);
  }
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

    // Handle affinity
    if (affinityKey && endpoint.sessionAffinity !== 'NONE') {
      await setAffinityMapping(endpoint.id, affinityKey, backend.id, endpoint.affinityTtlSeconds);
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

    // Handle affinity
    if (affinityKey && endpoint.sessionAffinity !== 'NONE') {
      await setAffinityMapping(endpoint.id, affinityKey, backend.id, endpoint.affinityTtlSeconds);
      if (endpoint.sessionAffinity === 'COOKIE' && !request.headers.get('cookie')?.includes(endpoint.affinityCookieName)) {
        responseHeaders.append('Set-Cookie', generateAffinityCookie(endpoint, backend.id));
      }
    }

    // Check if we need to rewrite the body
    const contentType = backendResponse.headers.get('content-type');
    let responseBody: BodyInit | null = backendResponse.body;

    // For SMART mode analysis or body rewriting in JSON/HTML responses
    if (shouldRewriteBody(contentType)) {
      const bodyText = await backendResponse.text();
      const rewrittenBody = rewriteResponseBody(bodyText, backend, originalHost, originalProtocol);
      responseBody = rewrittenBody;
      
      // Update content-length if we modified the body
      responseHeaders.set('Content-Length', new TextEncoder().encode(rewrittenBody).length.toString());
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

    // Handle affinity
    if (affinityKey && endpoint.sessionAffinity !== 'NONE') {
      await setAffinityMapping(endpoint.id, affinityKey, backend.id, endpoint.affinityTtlSeconds);
      if (endpoint.sessionAffinity === 'COOKIE' && !request.headers.get('cookie')?.includes(endpoint.affinityCookieName)) {
        rewrittenHeaders.append('Set-Cookie', generateAffinityCookie(endpoint, backend.id));
      }
    }

    // Rewrite body if needed
    const contentType = backendResponse.headers.get('content-type');
    let responseBody: BodyInit | null = backendResponse.body;

    if (shouldRewriteBody(contentType)) {
      const bodyText = await backendResponse.text();
      const rewrittenBody = rewriteResponseBody(bodyText, backend, originalHost, originalProtocol);
      responseBody = rewrittenBody;
      rewrittenHeaders.set('Content-Length', new TextEncoder().encode(rewrittenBody).length.toString());
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
  clusterId: string | null,
  clientIp: string
): Promise<NextResponse> {
  // For WebSocket connections, we return information about where to connect
  // Full WebSocket proxying would require a different server architecture
  
  if (!clusterId) {
    return NextResponse.json(
      { error: ProxyErrors.NO_CLUSTER.message, code: ProxyErrors.NO_CLUSTER.code },
      { status: ProxyErrors.NO_CLUSTER.statusCode }
    );
  }

  const cluster = await prisma.backendCluster.findUnique({
    where: { id: clusterId },
    include: {
      backends: {
        where: { isActive: true, status: 'HEALTHY' },
      },
    },
  });

  if (!cluster || cluster.backends.length === 0) {
    return NextResponse.json(
      { error: ProxyErrors.NO_HEALTHY_BACKENDS.message, code: ProxyErrors.NO_HEALTHY_BACKENDS.code },
      { status: ProxyErrors.NO_HEALTHY_BACKENDS.statusCode }
    );
  }

  // Get affinity key for WebSocket (important for persistent connections)
  const affinityKey = getAffinityKey(request, endpoint, clientIp) || hashString(clientIp);
  let preferredBackendId = await getAffinityBackend(endpoint.id, affinityKey);

  // Select backend
  const backends: Backend[] = cluster.backends;
  const backend = selectBackend(backends, cluster.strategy, cluster.id, clientIp, preferredBackendId);

  if (!backend) {
    return NextResponse.json(
      { error: ProxyErrors.NO_HEALTHY_BACKENDS.message, code: ProxyErrors.NO_HEALTHY_BACKENDS.code },
      { status: ProxyErrors.NO_HEALTHY_BACKENDS.statusCode }
    );
  }

  // Set affinity for WebSocket (long-lived connections need sticky sessions)
  await setAffinityMapping(endpoint.id, affinityKey, backend.id, endpoint.affinityTtlSeconds);

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
