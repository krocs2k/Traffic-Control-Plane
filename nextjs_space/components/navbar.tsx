"use client";

import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import {
  Network,
  Users,
  Settings,
  LogOut,
  User,
  Building2,
  FileText,
  ChevronDown,
  Moon,
  Sun,
  LayoutDashboard,
  Route,
  Server,
  Database,
  Bell,
  BellRing,
  Activity,
  BarChart3,
  Shield,
  FlaskConical,
  Shuffle,
  Link2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useTheme } from 'next-themes';
import { Role, ROLE_LABELS, hasPermission } from '@/lib/types';

interface Organization {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

export function Navbar() {
  const { data: session, status, update } = useSession() || {};
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  useEffect(() => {
    if (session?.user?.id) {
      fetchOrganizations();
    }
  }, [session?.user?.id]);

  useEffect(() => {
    if (session?.user?.currentOrgId) {
      fetchUnreadCount();
      // Poll for new notifications every 30 seconds
      const interval = setInterval(fetchUnreadCount, 30000);
      return () => clearInterval(interval);
    }
  }, [session?.user?.currentOrgId]);

  const fetchUnreadCount = async () => {
    try {
      const res = await fetch(`/api/notifications?orgId=${session?.user?.currentOrgId}&unreadOnly=true&limit=1`);
      if (res?.ok) {
        const data = await res?.json?.();
        setUnreadNotifications(data?.unreadCount ?? 0);
      }
    } catch (error) {
      // Silent fail for notification count
    }
  };

  useEffect(() => {
    if (orgs?.length > 0 && session?.user?.currentOrgId) {
      const org = orgs?.find?.((o) => o?.id === session?.user?.currentOrgId);
      setCurrentOrg(org ?? null);
    }
  }, [orgs, session?.user?.currentOrgId]);

  const fetchOrganizations = async () => {
    try {
      const res = await fetch('/api/organizations');
      if (res?.ok) {
        const data = await res?.json?.();
        setOrgs(data?.organizations ?? []);
      }
    } catch (error) {
      console.error('Failed to fetch organizations:', error);
    }
  };

  const switchOrganization = async (orgId: string) => {
    try {
      await update?.({ currentOrgId: orgId });
      router?.refresh?.();
    } catch (error) {
      console.error('Failed to switch organization:', error);
    }
  };

  const handleSignOut = async () => {
    await signOut?.({ callbackUrl: '/login' });
  };

  if (status === 'loading') {
    return (
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 max-w-screen-2xl items-center">
          <div className="flex items-center gap-2">
            <Network className="h-6 w-6 text-primary" />
            <span className="font-bold">Traffic Control Plane</span>
          </div>
        </div>
      </header>
    );
  }

  if (!session?.user) {
    return null;
  }

  const userRole = session?.user?.currentOrgRole ?? 'VIEWER';
  const canManageUsers = hasPermission(userRole, 'manage_users');
  const canViewAudit = hasPermission(userRole, 'view_audit');
  const canViewResources = hasPermission(userRole, 'view_resources');
  const canManageBackends = hasPermission(userRole, 'manage_backends');
  const canManageRouting = hasPermission(userRole, 'manage_routing');
  const canManageReplicas = hasPermission(userRole, 'manage_replicas');

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-2xl items-center">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-2">
            <Network className="h-6 w-6 text-primary" />
            <span className="font-bold hidden sm:inline-block">TCP</span>
          </Link>

          <nav className="flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard">
                <LayoutDashboard className="h-4 w-4 mr-2" />
                Dashboard
              </Link>
            </Button>
            {(canViewResources || canManageBackends) && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard/backends">
                  <Server className="h-4 w-4 mr-2" />
                  Backends
                </Link>
              </Button>
            )}
            {(canViewResources || canManageRouting) && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard/routing">
                  <Route className="h-4 w-4 mr-2" />
                  Routing
                </Link>
              </Button>
            )}
            {(canViewResources || canManageRouting) && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard/endpoints">
                  <Link2 className="h-4 w-4 mr-2" />
                  Endpoints
                </Link>
              </Button>
            )}
            {(canViewResources || canManageReplicas) && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard/replicas">
                  <Database className="h-4 w-4 mr-2" />
                  Replicas
                </Link>
              </Button>
            )}
            {canViewResources && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard/health">
                  <Activity className="h-4 w-4 mr-2" />
                  Health
                </Link>
              </Button>
            )}
            {canViewResources && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard/metrics">
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Metrics
                </Link>
              </Button>
            )}
            {(canViewResources || canManageRouting) && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard/traffic-management">
                  <Shield className="h-4 w-4 mr-2" />
                  Traffic
                </Link>
              </Button>
            )}
            {(canViewResources || canManageRouting) && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard/experiments">
                  <FlaskConical className="h-4 w-4 mr-2" />
                  Experiments
                </Link>
              </Button>
            )}
            {(canViewResources || canManageRouting) && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard/load-balancing">
                  <Shuffle className="h-4 w-4 mr-2" />
                  Load Balancing
                </Link>
              </Button>
            )}
            {canViewResources && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard/alerts">
                  <BellRing className="h-4 w-4 mr-2" />
                  Alerts
                </Link>
              </Button>
            )}
            {canManageUsers && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/users">
                  <Users className="h-4 w-4 mr-2" />
                  Users
                </Link>
              </Button>
            )}
            {canViewAudit && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/audit">
                  <FileText className="h-4 w-4 mr-2" />
                  Audit Log
                </Link>
              </Button>
            )}
          </nav>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Organization Switcher */}
          {(orgs?.length ?? 0) > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Building2 className="h-4 w-4" />
                  <span className="hidden sm:inline-block max-w-32 truncate">
                    {currentOrg?.name ?? 'Select Org'}
                  </span>
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Organizations</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {orgs?.map?.((org) => (
                  <DropdownMenuItem
                    key={org?.id ?? ''}
                    onClick={() => switchOrganization(org?.id ?? '')}
                    className="justify-between"
                  >
                    <span className="truncate">{org?.name ?? ''}</span>
                    <Badge variant="secondary" className="text-xs">
                      {ROLE_LABELS?.[org?.role] ?? org?.role}
                    </Badge>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Notifications */}
          <Button
            variant="ghost"
            size="icon"
            asChild
            className="relative"
          >
            <Link href="/dashboard/notifications">
              <Bell className="h-4 w-4" />
              {unreadNotifications > 0 && (
                <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-[10px] font-medium text-white flex items-center justify-center">
                  {unreadNotifications > 9 ? '9+' : unreadNotifications}
                </span>
              )}
              <span className="sr-only">Notifications</span>
            </Link>
          </Button>

          {/* Theme Toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme?.(theme === 'dark' ? 'light' : 'dark')}
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">Toggle theme</span>
          </Button>

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2">
                <Avatar className="h-6 w-6">
                  <AvatarImage src={session?.user?.avatarUrl ?? undefined} />
                  <AvatarFallback className="text-xs">
                    {session?.user?.name?.charAt?.(0)?.toUpperCase?.() ?? 'U'}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden sm:inline-block max-w-24 truncate">
                  {session?.user?.name ?? ''}
                </span>
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium">{session?.user?.name ?? ''}</p>
                  <p className="text-xs text-muted-foreground">
                    {session?.user?.email ?? ''}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/profile">
                  <User className="h-4 w-4 mr-2" />
                  Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/organization">
                  <Settings className="h-4 w-4 mr-2" />
                  Organization Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-red-600">
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
