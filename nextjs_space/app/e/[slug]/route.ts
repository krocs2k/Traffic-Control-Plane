import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { LoadBalancerStrategy, BackendStatus } from '@prisma/client';

// Round-robin counter per cluster (in-memory, resets on server restart)
const roundRobinCounters: Map<string, number> = new Map();

// Select backend based on load balancing strategy
function selectBackend(
  backends: Array<{
    id: string;
    host: string;
    port: number;
    protocol: string;
    weight: number;
    status: BackendStatus;
    currentConnections: number;
    maxConnections: number | null;
  }>,
  strategy: LoadBalancerStrategy,
  clusterId: string,
  clientIp?: string
): typeof backends[0] | null {
  // Filter to healthy backends (HEALTHY status only)
  const healthyBackends = backends.filter(
    b => b.status === 'HEALTHY'
  );

  if (healthyBackends.length === 0) return null;
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

// Get client IP from request
function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip') || '127.0.0.1';
}

// Handle all HTTP methods
async function handleRequest(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const startTime = Date.now();
  const { slug } = await params;

  try {
    // Find the endpoint
    const endpoint = await prisma.trafficEndpoint.findUnique({
      where: { slug }
    });

    if (!endpoint) {
      return NextResponse.json(
        { error: 'Endpoint not found', slug },
        { status: 404 }
      );
    }

    if (!endpoint.isActive) {
      return NextResponse.json(
        { error: 'Endpoint is disabled', slug },
        { status: 503 }
      );
    }

    const config = endpoint.config as Record<string, unknown>;
    const clientIp = getClientIp(request);

    // Handle based on endpoint type
    let response: NextResponse;
    let selectedBackend: { host: string; port: number; protocol: string } | null = null;

    switch (endpoint.type) {
      case 'MOCK': {
        // Return mock response from config
        const mockResponse = config.mockResponse || {
          message: 'Mock response from Traffic Control Plane',
          endpoint: endpoint.name,
          timestamp: new Date().toISOString()
        };
        const mockStatus = (config.mockStatus as number) || 200;
        response = NextResponse.json(mockResponse, { status: mockStatus });
        break;
      }

      case 'LOAD_BALANCE':
      case 'ROUTE':
      case 'PROXY': {
        // Get cluster and backends
        if (!endpoint.clusterId) {
          return NextResponse.json(
            { error: 'No backend cluster configured', endpoint: endpoint.name },
            { status: 502 }
          );
        }

        const cluster = await prisma.backendCluster.findUnique({
          where: { id: endpoint.clusterId },
          include: {
            backends: {
              where: { isActive: true }
            }
          }
        });

        if (!cluster || cluster.backends.length === 0) {
          return NextResponse.json(
            { error: 'No backends available', cluster: cluster?.name },
            { status: 502 }
          );
        }

        // Check if there's a load balancer config override
        let strategy = cluster.strategy;
        if (endpoint.clusterId) {
          const lbConfig = await prisma.loadBalancerConfig.findFirst({
            where: { clusterId: endpoint.clusterId }
          });
          if (lbConfig) {
            strategy = lbConfig.strategy as LoadBalancerStrategy;
          }
        }

        // Select backend
        const backend = selectBackend(
          cluster.backends,
          strategy,
          cluster.id,
          clientIp
        );

        if (!backend) {
          return NextResponse.json(
            { error: 'No healthy backends', cluster: cluster.name },
            { status: 503 }
          );
        }

        selectedBackend = backend;

        // Build target URL
        const targetUrl = `${backend.protocol}://${backend.host}:${backend.port}`;

        // For demonstration, return routing info instead of actual proxy
        // In production, you'd use fetch() to forward the request
        response = NextResponse.json({
          message: 'Request would be routed to backend',
          endpoint: {
            name: endpoint.name,
            slug: endpoint.slug,
            type: endpoint.type
          },
          routing: {
            cluster: cluster.name,
            strategy: strategy,
            selectedBackend: {
              host: backend.host,
              port: backend.port,
              protocol: backend.protocol
            },
            targetUrl
          },
          request: {
            method: request.method,
            path: request.nextUrl.pathname,
            clientIp
          },
          timestamp: new Date().toISOString()
        });
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
        avgLatencyMs: latency, // Simplified: just set latest latency
        lastRequestAt: new Date()
      }
    });

    // Add custom headers
    response.headers.set('X-Endpoint-Id', endpoint.id);
    response.headers.set('X-Endpoint-Slug', endpoint.slug);
    response.headers.set('X-Response-Time', `${latency}ms`);
    if (selectedBackend) {
      response.headers.set('X-Backend-Host', selectedBackend.host);
    }

    return response;
  } catch (error) {
    console.error('Error handling endpoint request:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Export handlers for all HTTP methods
export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
export const HEAD = handleRequest;
export const OPTIONS = handleRequest;
