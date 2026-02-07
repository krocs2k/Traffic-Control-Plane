"use client";

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Server,
  Route,
  Link2,
  Database,
  Activity,
  BarChart3,
  Shield,
  FlaskConical,
  Shuffle,
  BellRing,
  FileText,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { hasPermission } from '@/lib/types';

interface NavItem {
  href: string;
  icon: React.ElementType;
  label: string;
  permission?: string;
}

export function Sidebar() {
  const { data: session } = useSession() || {};
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem('sidebar-collapsed');
    if (stored !== null) {
      setIsCollapsed(stored === 'true');
    }
  }, []);

  const toggleCollapsed = () => {
    const newValue = !isCollapsed;
    setIsCollapsed(newValue);
    localStorage.setItem('sidebar-collapsed', String(newValue));
  };

  if (!session?.user) {
    return null;
  }

  const userRole = session?.user?.currentOrgRole ?? 'VIEWER';
  const canViewAudit = hasPermission(userRole, 'view_audit');
  const canViewResources = hasPermission(userRole, 'view_resources');
  const canManageBackends = hasPermission(userRole, 'manage_backends');
  const canManageRouting = hasPermission(userRole, 'manage_routing');
  const canManageReplicas = hasPermission(userRole, 'manage_replicas');

  const navItems: NavItem[] = [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { href: '/dashboard/backends', icon: Server, label: 'Backends', permission: 'backends' },
    { href: '/dashboard/routing', icon: Route, label: 'Routing', permission: 'routing' },
    { href: '/dashboard/endpoints', icon: Link2, label: 'Endpoints', permission: 'routing' },
    { href: '/dashboard/replicas', icon: Database, label: 'Replicas', permission: 'replicas' },
    { href: '/dashboard/health', icon: Activity, label: 'Health', permission: 'resources' },
    { href: '/dashboard/metrics', icon: BarChart3, label: 'Metrics', permission: 'resources' },
    { href: '/dashboard/traffic-management', icon: Shield, label: 'Traffic', permission: 'routing' },
    { href: '/dashboard/experiments', icon: FlaskConical, label: 'Experiments', permission: 'routing' },
    { href: '/dashboard/load-balancing', icon: Shuffle, label: 'Load Balancing', permission: 'routing' },
    { href: '/dashboard/alerts', icon: BellRing, label: 'Alerts', permission: 'resources' },
    { href: '/audit', icon: FileText, label: 'Audit Log', permission: 'audit' },
  ];

  const checkPermission = (permission?: string) => {
    if (!permission) return true;
    switch (permission) {
      case 'backends':
        return canViewResources || canManageBackends;
      case 'routing':
        return canViewResources || canManageRouting;
      case 'replicas':
        return canViewResources || canManageReplicas;
      case 'resources':
        return canViewResources;
      case 'audit':
        return canViewAudit;
      default:
        return true;
    }
  };

  const filteredNavItems = navItems.filter((item) => checkPermission(item.permission));

  // Render placeholder during SSR to prevent hydration mismatch
  if (!mounted) {
    return (
      <aside className="sticky top-14 h-[calc(100vh-3.5rem)] w-16 border-r bg-background flex flex-col">
        <div className="flex-1" />
      </aside>
    );
  }

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'sticky top-14 h-[calc(100vh-3.5rem)] border-r bg-background flex flex-col transition-all duration-300',
          isCollapsed ? 'w-16' : 'w-56'
        )}
      >
        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-2">
          <ul className="space-y-1 px-2">
            {filteredNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname?.startsWith(item.href));

              if (isCollapsed) {
                return (
                  <li key={item.href}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Link
                          href={item.href}
                          className={cn(
                            'flex items-center justify-center h-10 w-full rounded-md transition-colors',
                            isActive
                              ? 'bg-primary text-primary-foreground'
                              : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                          )}
                        >
                          <Icon className="h-5 w-5" />
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="font-medium">
                        {item.label}
                      </TooltipContent>
                    </Tooltip>
                  </li>
                );
              }

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 h-10 px-3 rounded-md transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    <span className="text-sm font-medium truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Collapse Toggle */}
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleCollapsed}
            className={cn(
              'w-full justify-center',
              !isCollapsed && 'justify-start px-3'
            )}
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4 mr-2" />
                <span className="text-sm">Collapse</span>
              </>
            )}
          </Button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
