import { Role, UserStatus } from '@prisma/client';

export { Role, UserStatus };

export interface SafeUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  mfaEnabled: boolean;
  status: UserStatus;
  createdAt: Date;
}

export interface OrganizationWithRole {
  id: string;
  name: string;
  slug: string;
  role: Role;
  joinedAt: Date;
}

export interface SessionInfo {
  id: string;
  token: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: Date;
  user: { id: string; name: string; email: string } | null;
}

export interface OrganizationMemberInfo {
  id: string;
  userId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: Role;
  status: UserStatus;
  joinedAt: Date;
  invitedBy: { name: string } | null;
}

export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  OWNER: ['*'],
  ADMIN: ['manage_users', 'manage_settings', 'view_audit', 'manage_resources', 'view_resources'],
  OPERATOR: ['manage_resources', 'view_resources', 'view_audit'],
  VIEWER: ['view_resources'],
  AUDITOR: ['view_resources', 'view_audit'],
};

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  OPERATOR: 'Operator',
  VIEWER: 'Viewer',
  AUDITOR: 'Auditor',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER: 'Full access to all organization features and settings',
  ADMIN: 'Manage users, settings, and view audit logs',
  OPERATOR: 'Manage and view resources, view audit logs',
  VIEWER: 'Read-only access to resources',
  AUDITOR: 'Read-only access to resources and audit logs',
};

export function hasPermission(role: Role, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[role] ?? [];
  return perms?.includes('*') || perms?.includes(permission);
}

export function canManageRole(currentRole: Role, targetRole: Role): boolean {
  const hierarchy: Role[] = ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER', 'AUDITOR'];
  const currentIdx = hierarchy?.indexOf(currentRole) ?? -1;
  const targetIdx = hierarchy?.indexOf(targetRole) ?? -1;
  return currentIdx !== -1 && currentIdx < targetIdx;
}
