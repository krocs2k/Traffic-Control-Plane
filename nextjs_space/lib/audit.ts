import { prisma } from './db';

export type AuditAction =
  | 'user.login'
  | 'user.logout'
  | 'user.register'
  | 'user.password_change'
  | 'user.password_reset_request'
  | 'user.password_reset'
  | 'user.profile_update'
  | 'user.status_change'
  | 'user.role_change'
  | 'user.invite'
  | 'user.remove'
  | 'org.create'
  | 'org.update'
  | 'org.delete'
  | 'org.switch'
  | 'session.revoke'
  | 'session.revoke_all'
  | 'MFA_SETUP_INITIATED'
  | 'MFA_ENABLED'
  | 'MFA_DISABLED'
  | 'MFA_BACKUP_CODES_REGENERATED'
  // Traffic Control Actions
  | 'backend_cluster.create'
  | 'backend_cluster.update'
  | 'backend_cluster.delete'
  | 'backend.create'
  | 'backend.update'
  | 'backend.delete'
  | 'routing_policy.create'
  | 'routing_policy.update'
  | 'routing_policy.delete'
  | 'read_replica.create'
  | 'read_replica.update'
  | 'read_replica.delete'
  // Recommendation Actions
  | 'recommendation.accepted'
  | 'recommendation.rejected'
  | 'recommendation.expired'
  // Circuit Breaker Actions
  | 'circuit_breaker.created'
  | 'circuit_breaker.updated'
  | 'circuit_breaker.deleted'
  // Rate Limit Actions
  | 'rate_limit.created'
  | 'rate_limit.updated'
  | 'rate_limit.deleted'
  // Experiment Actions
  | 'experiment.created'
  | 'experiment.updated'
  | 'experiment.deleted'
  // Load Balancer Actions
  | 'loadbalancer.config.created'
  | 'loadbalancer.config.updated'
  | 'loadbalancer.config.deleted'
  // Alert Actions
  | 'alert.rule.created'
  | 'alert.rule.updated'
  | 'alert.rule.deleted'
  | 'alert.channel.created'
  | 'alert.acknowledged'
  | 'alert.resolved'
  | 'alert.silenced'
  | 'alert.updated';

export interface AuditDetails {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  targetUserId?: string;
  targetUserEmail?: string;
  reason?: string;
  [key: string]: unknown;
}

export async function createAuditLog(params: {
  orgId?: string | null;
  userId?: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  details?: AuditDetails;
  ipAddress?: string | null;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        orgId: params?.orgId ?? null,
        userId: params?.userId ?? null,
        action: params?.action ?? '',
        resourceType: params?.resourceType ?? '',
        resourceId: params?.resourceId ?? null,
        details: (params?.details ?? {}) as any,
        ipAddress: params?.ipAddress ?? null,
      },
    });
  } catch (error) {
    console.error('Failed to create audit log:', error);
  }
}

export function getClientIP(request: Request): string | null {
  const forwarded = request?.headers?.get?.('x-forwarded-for');
  if (forwarded) {
    return forwarded?.split?.(',')?.shift?.()?.trim?.() ?? null;
  }
  return request?.headers?.get?.('x-real-ip') ?? null;
}
