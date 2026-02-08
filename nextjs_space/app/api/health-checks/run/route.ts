import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { HealthCheckStatus, BackendStatus } from '@prisma/client';
import { Socket } from 'net';

// Helper: Perform real HTTP health check
async function performHttpHealthCheck(
  protocol: string,
  host: string,
  port: number,
  healthCheckPath: string,
  timeoutMs: number = 5000
): Promise<{ isHealthy: boolean; responseTime: number; statusCode: number; errorMessage: string | null }> {
  const startTime = Date.now();
  const url = `${protocol}://${host}:${port}${healthCheckPath || '/health'}`;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'TrafficControlPlane-HealthCheck/1.0',
        'Accept': 'application/json, text/plain, */*',
      },
    });
    
    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;
    const statusCode = response.status;
    
    // Consider 2xx and 3xx as healthy
    const isHealthy = statusCode >= 200 && statusCode < 400;
    
    return {
      isHealthy,
      responseTime,
      statusCode,
      errorMessage: isHealthy ? null : `HTTP ${statusCode}: ${response.statusText}`,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    let errorMessage = 'Unknown error';
    
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        errorMessage = `Connection timeout after ${timeoutMs}ms`;
      } else if (error.message.includes('ECONNREFUSED')) {
        errorMessage = 'Connection refused';
      } else if (error.message.includes('ENOTFOUND')) {
        errorMessage = `DNS resolution failed for ${host}`;
      } else if (error.message.includes('ETIMEDOUT')) {
        errorMessage = 'Connection timed out';
      } else if (error.message.includes('ECONNRESET')) {
        errorMessage = 'Connection reset by peer';
      } else {
        errorMessage = error.message;
      }
    }
    
    return {
      isHealthy: false,
      responseTime,
      statusCode: 0,
      errorMessage,
    };
  }
}

// Helper: Perform real TCP health check for database replicas
async function performTcpHealthCheck(
  host: string,
  port: number,
  timeoutMs: number = 5000
): Promise<{ isHealthy: boolean; responseTime: number; errorMessage: string | null }> {
  const startTime = Date.now();
  
  return new Promise((resolve) => {
    const socket = new Socket();
    let resolved = false;
    
    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
      }
    };
    
    const timeoutId = setTimeout(() => {
      cleanup();
      resolve({
        isHealthy: false,
        responseTime: Date.now() - startTime,
        errorMessage: `Connection timeout after ${timeoutMs}ms`,
      });
    }, timeoutMs);
    
    socket.connect(port, host, () => {
      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;
      cleanup();
      resolve({
        isHealthy: true,
        responseTime,
        errorMessage: null,
      });
    });
    
    socket.on('error', (error) => {
      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;
      let errorMessage = 'Unknown error';
      
      if (error.message.includes('ECONNREFUSED')) {
        errorMessage = 'Connection refused';
      } else if (error.message.includes('ENOTFOUND')) {
        errorMessage = `DNS resolution failed for ${host}`;
      } else if (error.message.includes('ETIMEDOUT')) {
        errorMessage = 'Connection timed out';
      } else if (error.message.includes('ECONNRESET')) {
        errorMessage = 'Connection reset by peer';
      } else if (error.message.includes('EHOSTUNREACH')) {
        errorMessage = 'Host unreachable';
      } else {
        errorMessage = error.message;
      }
      
      cleanup();
      resolve({
        isHealthy: false,
        responseTime,
        errorMessage,
      });
    });
  });
}

// Determine health status based on response time thresholds
function determineHealthStatus(
  isHealthy: boolean,
  responseTime: number,
  degradedThresholdMs: number = 500
): HealthCheckStatus {
  if (!isHealthy) return 'UNHEALTHY';
  if (responseTime > degradedThresholdMs) return 'DEGRADED';
  return 'HEALTHY';
}

// Map health check status to backend status
function mapToBackendStatus(healthStatus: HealthCheckStatus): BackendStatus {
  switch (healthStatus) {
    case 'HEALTHY':
      return 'HEALTHY';
    case 'DEGRADED':
      return 'HEALTHY'; // Degraded backends can still serve traffic
    case 'UNHEALTHY':
    case 'UNKNOWN':
    default:
      return 'UNHEALTHY';
  }
}

// POST - Run REAL health checks for all backends/replicas
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { memberships: true },
    });

    if (!user?.memberships?.[0]) {
      return NextResponse.json({ error: 'User not in an organization' }, { status: 403 });
    }

    const orgId = user.memberships[0].orgId;

    // Get all active backends
    const backends = await prisma.backend.findMany({
      where: {
        cluster: { orgId },
        isActive: true,
      },
      include: { cluster: true },
    });

    // Get all load balancer configs for clusters (to get cluster-level health check settings)
    const loadBalancerConfigs = await prisma.loadBalancerConfig.findMany({
      where: { orgId },
    });
    const lbConfigMap = new Map(loadBalancerConfigs.map(c => [c.clusterId, c]));

    // Get all active replicas
    const replicas = await prisma.readReplica.findMany({
      where: { orgId, isActive: true },
    });

    const results: { backends: unknown[]; replicas: unknown[]; summary: unknown } = { 
      backends: [], 
      replicas: [],
      summary: {
        totalBackends: backends.length,
        healthyBackends: 0,
        degradedBackends: 0,
        unhealthyBackends: 0,
        totalReplicas: replicas.length,
        healthyReplicas: 0,
        unhealthyReplicas: 0,
      }
    };

    // Run REAL health checks for backends (in parallel for efficiency)
    const backendChecks = await Promise.all(
      backends.map(async (backend) => {
        // Get LoadBalancerConfig for this backend's cluster (for cluster-level health check settings)
        const lbConfig = lbConfigMap.get(backend.clusterId);
        
        // Priority: Backend's healthCheckPath (if populated) > LoadBalancerConfig's healthCheckPath > default '/health'
        // Backend's path is only used as an override if it's not empty
        const healthCheckPath = backend.healthCheckPath && backend.healthCheckPath.trim() !== ''
          ? backend.healthCheckPath 
          : (lbConfig?.healthCheckPath || '/health');
        
        // Use LoadBalancerConfig settings if available, otherwise fall back to cluster's healthCheck JSON
        const clusterHealthCheck = (backend.cluster.healthCheck as { timeoutMs?: number; intervalMs?: number }) || {};
        const timeoutMs = lbConfig?.healthCheckTimeoutMs || clusterHealthCheck.timeoutMs || 5000;
        const degradedThreshold = lbConfig?.healthCheckIntervalMs || clusterHealthCheck.intervalMs || 500;
        
        const checkResult = await performHttpHealthCheck(
          backend.protocol,
          backend.host,
          backend.port,
          healthCheckPath,
          timeoutMs
        );
        
        const status = determineHealthStatus(
          checkResult.isHealthy,
          checkResult.responseTime,
          degradedThreshold
        );
        
        const backendStatus = mapToBackendStatus(status);

        // Create health check record
        const healthCheck = await prisma.healthCheck.create({
          data: {
            backendId: backend.id,
            endpoint: `${backend.protocol}://${backend.host}:${backend.port}${healthCheckPath}`,
            status,
            responseTime: checkResult.responseTime,
            statusCode: checkResult.statusCode,
            errorMessage: checkResult.errorMessage,
            metadata: { 
              realCheck: true,
              checkedAt: new Date().toISOString(),
              timeoutMs,
              healthCheckPath,
              source: backend.healthCheckPath && backend.healthCheckPath.trim() !== '' 
                ? 'backend' 
                : (lbConfig?.healthCheckPath ? 'loadBalancerConfig' : 'default'),
            },
          },
        });

        // Update backend status
        await prisma.backend.update({
          where: { id: backend.id },
          data: {
            status: backendStatus,
            lastHealthCheck: new Date(),
          },
        });

        // Update summary counts
        if (status === 'HEALTHY') (results.summary as Record<string, number>).healthyBackends++;
        else if (status === 'DEGRADED') (results.summary as Record<string, number>).degradedBackends++;
        else (results.summary as Record<string, number>).unhealthyBackends++;

        return { 
          backend: backend.name, 
          host: backend.host,
          port: backend.port,
          healthCheckPath,
          status,
          responseTime: checkResult.responseTime,
          statusCode: checkResult.statusCode,
          errorMessage: checkResult.errorMessage,
          id: healthCheck.id,
        };
      })
    );

    results.backends = backendChecks;

    // Run REAL health checks for replicas (TCP connection test)
    const replicaChecks = await Promise.all(
      replicas.map(async (replica) => {
        const timeoutMs = 5000;
        
        const checkResult = await performTcpHealthCheck(
          replica.host,
          replica.port,
          timeoutMs
        );
        
        const status: HealthCheckStatus = checkResult.isHealthy ? 'HEALTHY' : 'UNHEALTHY';
        
        // Determine replica status based on health and existing lag
        let replicaStatus: 'SYNCED' | 'LAGGING' | 'CATCHING_UP' | 'OFFLINE' = 'OFFLINE';
        if (checkResult.isHealthy) {
          // Keep existing lag-based status if healthy
          if (replica.status === 'SYNCED' || replica.status === 'LAGGING' || replica.status === 'CATCHING_UP') {
            replicaStatus = replica.status;
          } else {
            replicaStatus = 'SYNCED';
          }
        }

        // Create health check record
        const healthCheck = await prisma.healthCheck.create({
          data: {
            replicaId: replica.id,
            endpoint: `postgres://${replica.host}:${replica.port}`,
            status,
            responseTime: checkResult.responseTime,
            statusCode: checkResult.isHealthy ? 200 : 0,
            errorMessage: checkResult.errorMessage,
            metadata: { 
              realCheck: true,
              checkedAt: new Date().toISOString(),
              timeoutMs,
              checkType: 'TCP',
            },
          },
        });

        // Update replica status
        await prisma.readReplica.update({
          where: { id: replica.id },
          data: {
            status: replicaStatus,
            lastHealthCheck: new Date(),
          },
        });

        // Update summary counts
        if (checkResult.isHealthy) (results.summary as Record<string, number>).healthyReplicas++;
        else (results.summary as Record<string, number>).unhealthyReplicas++;

        return { 
          replica: replica.name,
          host: replica.host,
          port: replica.port,
          status,
          replicaStatus,
          responseTime: checkResult.responseTime,
          errorMessage: checkResult.errorMessage,
          id: healthCheck.id,
        };
      })
    );

    results.replicas = replicaChecks;

    return NextResponse.json({
      message: 'Real health checks completed',
      checkedAt: new Date().toISOString(),
      results,
    });
  } catch (error) {
    console.error('Error running health checks:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
