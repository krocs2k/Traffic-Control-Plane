"use client";

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Server,
  Plus,
  Pencil,
  Trash2,
  MoreVertical,
  Activity,
  AlertCircle,
  CheckCircle2,
  PauseCircle,
  Wrench,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Settings,
  Shield,
  Clock,
  Shuffle,
  Zap,
  Network,
  CheckSquare,
  Square,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { hasPermission } from '@/lib/types';

interface Backend {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: string;
  weight: number;
  status: string;
  healthCheckPath: string;
  maxConnections: number | null;
  currentConnections: number;
  tags: string[];
  isActive: boolean;
  lastHealthCheck: string | null;
}

interface LoadBalancerConfig {
  id: string;
  strategy: string;
  stickySession: boolean;
  healthCheckEnabled: boolean;
  failoverEnabled: boolean;
  retryEnabled: boolean;
  maxRetries: number;
  connectionDrainingMs: number;
}

interface BackendCluster {
  id: string;
  name: string;
  description: string | null;
  strategy: string;
  isActive: boolean;
  backends: Backend[];
  _count: { backends: number; routingPolicies: number };
  loadBalancerConfig?: LoadBalancerConfig | null;
}

const STATUS_ICONS = {
  HEALTHY: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  UNHEALTHY: <AlertCircle className="h-4 w-4 text-red-500" />,
  DRAINING: <PauseCircle className="h-4 w-4 text-yellow-500" />,
  MAINTENANCE: <Wrench className="h-4 w-4 text-blue-500" />,
};

const STATUS_BADGES = {
  HEALTHY: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  UNHEALTHY: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  DRAINING: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  MAINTENANCE: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
};

const STRATEGY_LABELS: Record<string, string> = {
  ROUND_ROBIN: 'Round Robin',
  LEAST_CONNECTIONS: 'Least Connections',
  RANDOM: 'Random',
  IP_HASH: 'IP Hash',
  WEIGHTED_ROUND_ROBIN: 'Weighted Round Robin',
};

export default function BackendsPage() {
  const { data: session } = useSession() || {};
  const router = useRouter();
  const [clusters, setClusters] = useState<BackendCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
  const [selectedClusters, setSelectedClusters] = useState<Set<string>>(new Set());
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  
  // Dialog states
  const [clusterDialogOpen, setClusterDialogOpen] = useState(false);
  const [backendDialogOpen, setBackendDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingCluster, setEditingCluster] = useState<BackendCluster | null>(null);
  const [editingBackend, setEditingBackend] = useState<Backend | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'cluster' | 'backend'; id: string; name: string } | null>(null);

  // Form states
  const [clusterForm, setClusterForm] = useState({ name: '', description: '' });
  const [backendForm, setBackendForm] = useState({
    name: '', host: '', port: '443', protocol: 'https', weight: '100',
    healthCheckPath: '', maxConnections: '', status: 'HEALTHY'
  });
  const [loadBalancerConfigs, setLoadBalancerConfigs] = useState<Map<string, LoadBalancerConfig>>(new Map());

  const orgId = session?.user?.currentOrgId;
  const userRole = session?.user?.currentOrgRole ?? 'VIEWER';
  const canManage = hasPermission(userRole, 'manage_backends');

  useEffect(() => {
    if (orgId) {
      fetchClusters();
      fetchLoadBalancerConfigs();
    }
  }, [orgId]);

  const fetchClusters = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/backends/clusters?orgId=${orgId}`);
      if (res.ok) {
        const data = await res.json();
        // API now returns array directly, not { clusters: [] }
        const clusterList = Array.isArray(data) ? data : (data.clusters || []);
        setClusters(clusterList);
        setExpandedClusters(new Set(clusterList.map((c: BackendCluster) => c.id)));
      }
    } catch (error) {
      console.error('Error fetching clusters:', error);
      toast.error('Failed to load backend clusters');
    } finally {
      setLoading(false);
    }
  };

  const fetchLoadBalancerConfigs = async () => {
    try {
      const res = await fetch('/api/load-balancing');
      if (res.ok) {
        const configs = await res.json();
        const configMap = new Map<string, LoadBalancerConfig>();
        configs.forEach((config: LoadBalancerConfig & { clusterId: string }) => {
          configMap.set(config.clusterId, config);
        });
        setLoadBalancerConfigs(configMap);
      }
    } catch (error) {
      console.error('Error fetching load balancer configs:', error);
    }
  };

  const toggleCluster = (clusterId: string) => {
    setExpandedClusters(prev => {
      const next = new Set(prev);
      if (next.has(clusterId)) {
        next.delete(clusterId);
      } else {
        next.add(clusterId);
      }
      return next;
    });
  };

  const openClusterDialog = (cluster?: BackendCluster) => {
    if (cluster) {
      setEditingCluster(cluster);
      setClusterForm({ name: cluster.name, description: cluster.description || '' });
    } else {
      setEditingCluster(null);
      setClusterForm({ name: '', description: '' });
    }
    setClusterDialogOpen(true);
  };

  const getStrategyIcon = (strategy: string) => {
    switch (strategy) {
      case 'ROUND_ROBIN':
        return <Shuffle className="h-3.5 w-3.5" />;
      case 'LEAST_CONNECTIONS':
        return <Activity className="h-3.5 w-3.5" />;
      case 'RANDOM':
        return <Zap className="h-3.5 w-3.5" />;
      case 'IP_HASH':
        return <Network className="h-3.5 w-3.5" />;
      case 'WEIGHTED_ROUND_ROBIN':
        return <Server className="h-3.5 w-3.5" />;
      default:
        return <Settings className="h-3.5 w-3.5" />;
    }
  };

  const openBackendDialog = (clusterId: string, backend?: Backend) => {
    setSelectedClusterId(clusterId);
    if (backend) {
      setEditingBackend(backend);
      setBackendForm({
        name: backend.name,
        host: backend.host,
        port: backend.port.toString(),
        protocol: backend.protocol,
        weight: backend.weight.toString(),
        healthCheckPath: backend.healthCheckPath,
        maxConnections: backend.maxConnections?.toString() || '',
        status: backend.status,
      });
    } else {
      setEditingBackend(null);
      setBackendForm({
        name: '', host: '', port: '443', protocol: 'https', weight: '100',
        healthCheckPath: '', maxConnections: '', status: 'HEALTHY'
      });
    }
    setBackendDialogOpen(true);
  };

  const saveCluster = async () => {
    try {
      if (editingCluster) {
        const res = await fetch(`/api/backends/clusters/${editingCluster.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(clusterForm),
        });
        if (!res.ok) throw new Error('Failed to update cluster');
        toast.success('Cluster updated successfully');
      } else {
        const res = await fetch('/api/backends/clusters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...clusterForm, orgId }),
        });
        if (!res.ok) throw new Error('Failed to create cluster');
        toast.success('Cluster created successfully');
      }
      setClusterDialogOpen(false);
      fetchClusters();
    } catch (error) {
      console.error('Error saving cluster:', error);
      toast.error('Failed to save cluster');
    }
  };

  const saveBackend = async () => {
    try {
      const payload = {
        name: backendForm.name,
        host: backendForm.host,
        port: parseInt(backendForm.port),
        protocol: backendForm.protocol,
        weight: parseInt(backendForm.weight),
        healthCheckPath: backendForm.healthCheckPath,
        maxConnections: backendForm.maxConnections ? parseInt(backendForm.maxConnections) : null,
        status: backendForm.status,
      };

      if (editingBackend) {
        const res = await fetch(`/api/backends/${editingBackend.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to update backend');
        toast.success('Backend updated successfully');
      } else {
        const res = await fetch('/api/backends', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, clusterId: selectedClusterId }),
        });
        if (!res.ok) throw new Error('Failed to create backend');
        toast.success('Backend created successfully');
      }
      setBackendDialogOpen(false);
      fetchClusters();
    } catch (error) {
      console.error('Error saving backend:', error);
      toast.error('Failed to save backend');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const endpoint = deleteTarget.type === 'cluster'
        ? `/api/backends/clusters/${deleteTarget.id}`
        : `/api/backends/${deleteTarget.id}`;
      const res = await fetch(endpoint, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      toast.success(`${deleteTarget.type === 'cluster' ? 'Cluster' : 'Backend'} deleted successfully`);
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      fetchClusters();
    } catch (error) {
      console.error('Error deleting:', error);
      toast.error('Failed to delete');
    }
  };

  const toggleClusterSelection = (clusterId: string) => {
    setSelectedClusters(prev => {
      const next = new Set(prev);
      if (next.has(clusterId)) {
        next.delete(clusterId);
      } else {
        next.add(clusterId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedClusters.size === clusters.length) {
      setSelectedClusters(new Set());
    } else {
      setSelectedClusters(new Set(clusters.map(c => c.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedClusters.size === 0) return;
    try {
      const res = await fetch('/api/backends/clusters', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clusterIds: Array.from(selectedClusters), orgId }),
      });
      if (!res.ok) throw new Error('Failed to delete clusters');
      toast.success(`Deleted ${selectedClusters.size} cluster(s) successfully`);
      setBulkDeleteDialogOpen(false);
      setSelectedClusters(new Set());
      fetchClusters();
    } catch (error) {
      console.error('Error bulk deleting:', error);
      toast.error('Failed to delete clusters');
    }
  };

  if (!orgId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Please select an organization</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Backend Clusters</h1>
          <p className="text-muted-foreground">Manage backend servers and load balancing</p>
        </div>
        <div className="flex gap-2">
          {canManage && clusters.length > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={toggleSelectAll}>
                {selectedClusters.size === clusters.length ? (
                  <><CheckSquare className="h-4 w-4 mr-2" />Deselect All</>
                ) : (
                  <><Square className="h-4 w-4 mr-2" />Select All</>
                )}
              </Button>
              {selectedClusters.size > 0 && (
                <Button variant="destructive" size="sm" onClick={() => setBulkDeleteDialogOpen(true)}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete ({selectedClusters.size})
                </Button>
              )}
            </>
          )}
          <Button variant="outline" size="sm" onClick={fetchClusters}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          {canManage && (
            <Button onClick={() => openClusterDialog()}>
              <Plus className="h-4 w-4 mr-2" />
              New Cluster
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4">
          {[1, 2].map(i => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-6 w-48 bg-muted rounded" />
              </CardHeader>
              <CardContent>
                <div className="h-24 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : clusters.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Server className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No backend clusters</h3>
            <p className="text-muted-foreground text-center mt-1">
              Create your first backend cluster to start managing traffic routing.
            </p>
            {canManage && (
              <Button className="mt-4" onClick={() => openClusterDialog()}>
                <Plus className="h-4 w-4 mr-2" />
                Create Cluster
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {clusters.map(cluster => {
            const lbConfig = loadBalancerConfigs.get(cluster.id);
            return (
            <Collapsible
              key={cluster.id}
              open={expandedClusters.has(cluster.id)}
              onOpenChange={() => toggleCluster(cluster.id)}
            >
              <Card className={selectedClusters.has(cluster.id) ? 'ring-2 ring-primary' : ''}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {canManage && (
                        <Checkbox
                          checked={selectedClusters.has(cluster.id)}
                          onCheckedChange={() => toggleClusterSelection(cluster.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                      <CollapsibleTrigger className="flex items-center gap-2 hover:opacity-80">
                        {expandedClusters.has(cluster.id) ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        <CardTitle className="text-lg">{cluster.name}</CardTitle>
                        <Badge variant="secondary" className="ml-2">
                          {cluster._count.backends} backends
                        </Badge>
                      </CollapsibleTrigger>
                    </div>
                    {canManage && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openBackendDialog(cluster.id)}>
                            <Plus className="h-4 w-4 mr-2" />
                            Add Backend
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openClusterDialog(cluster)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit Cluster
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={() => {
                              setDeleteTarget({ type: 'cluster', id: cluster.id, name: cluster.name });
                              setDeleteDialogOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete Cluster
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  {cluster.description && (
                    <CardDescription>{cluster.description}</CardDescription>
                  )}
                  
                  {/* Load Balancer Configuration Summary */}
                  <TooltipProvider>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      {lbConfig ? (
                        <>
                          <Tooltip>
                            <TooltipTrigger>
                              <Badge variant="outline" className="flex items-center gap-1.5">
                                {getStrategyIcon(lbConfig.strategy)}
                                {STRATEGY_LABELS[lbConfig.strategy] || lbConfig.strategy}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>Load Balancing Strategy</TooltipContent>
                          </Tooltip>
                          
                          <Tooltip>
                            <TooltipTrigger>
                              <Badge variant={lbConfig.healthCheckEnabled ? "default" : "secondary"} className="flex items-center gap-1">
                                <Shield className="h-3 w-3" />
                                Health
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>Health Check {lbConfig.healthCheckEnabled ? 'Enabled' : 'Disabled'}</TooltipContent>
                          </Tooltip>
                          
                          <Tooltip>
                            <TooltipTrigger>
                              <Badge variant={lbConfig.failoverEnabled ? "default" : "secondary"} className="flex items-center gap-1">
                                <Activity className="h-3 w-3" />
                                Failover
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>Failover {lbConfig.failoverEnabled ? 'Enabled' : 'Disabled'}</TooltipContent>
                          </Tooltip>
                          
                          {lbConfig.stickySession && (
                            <Tooltip>
                              <TooltipTrigger>
                                <Badge variant="default" className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  Sticky
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>Sticky Sessions Enabled</TooltipContent>
                            </Tooltip>
                          )}
                          
                          {lbConfig.retryEnabled && (
                            <Tooltip>
                              <TooltipTrigger>
                                <Badge variant="outline" className="flex items-center gap-1">
                                  <RefreshCw className="h-3 w-3" />
                                  {lbConfig.maxRetries}x
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>Retries: {lbConfig.maxRetries} attempts</TooltipContent>
                            </Tooltip>
                          )}
                        </>
                      ) : (
                        <Link href="/dashboard/load-balancing">
                          <Badge variant="outline" className="text-muted-foreground cursor-pointer hover:bg-accent">
                            <Settings className="h-3 w-3 mr-1" />
                            Configure Load Balancing
                          </Badge>
                        </Link>
                      )}
                    </div>
                  </TooltipProvider>
                </CardHeader>

                <CollapsibleContent>
                  <CardContent>
                    <Separator className="mb-4" />
                    {cluster.backends.length === 0 ? (
                      <div className="text-center py-6 text-muted-foreground">
                        No backends in this cluster.
                        {canManage && (
                          <Button
                            variant="link"
                            onClick={() => openBackendDialog(cluster.id)}
                          >
                            Add one now
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="grid gap-3">
                        {cluster.backends.map(backend => (
                          <div
                            key={backend.id}
                            className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                          >
                            <div className="flex items-center gap-4">
                              {STATUS_ICONS[backend.status as keyof typeof STATUS_ICONS]}
                              <div>
                                <div className="font-medium flex items-center gap-2">
                                  {backend.name}
                                  <Badge
                                    variant="outline"
                                    className={STATUS_BADGES[backend.status as keyof typeof STATUS_BADGES] || ''}
                                  >
                                    {backend.status}
                                  </Badge>
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {backend.protocol}://{backend.host}:{backend.port}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right text-sm">
                                <div className="text-muted-foreground">Weight</div>
                                <div className="font-medium">{backend.weight}</div>
                              </div>
                              <div className="text-right text-sm">
                                <div className="text-muted-foreground">Connections</div>
                                <div className="font-medium">
                                  {backend.currentConnections}
                                  {backend.maxConnections && ` / ${backend.maxConnections}`}
                                </div>
                              </div>
                              {canManage && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon">
                                      <MoreVertical className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => openBackendDialog(cluster.id, backend)}>
                                      <Pencil className="h-4 w-4 mr-2" />
                                      Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="text-red-600"
                                      onClick={() => {
                                        setDeleteTarget({ type: 'backend', id: backend.id, name: backend.name });
                                        setDeleteDialogOpen(true);
                                      }}
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Delete
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          );
          })}
        </div>
      )}

      {/* Cluster Dialog */}
      <Dialog open={clusterDialogOpen} onOpenChange={setClusterDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCluster ? 'Edit Cluster' : 'New Cluster'}</DialogTitle>
            <DialogDescription>
              {editingCluster ? 'Update the cluster configuration' : 'Create a new backend cluster'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="cluster-name">Name</Label>
              <Input
                id="cluster-name"
                value={clusterForm.name}
                onChange={(e) => setClusterForm({ ...clusterForm, name: e.target.value })}
                placeholder="production-api"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cluster-description">Description</Label>
              <Input
                id="cluster-description"
                value={clusterForm.description}
                onChange={(e) => setClusterForm({ ...clusterForm, description: e.target.value })}
                placeholder="Production API servers"
              />
            </div>
            <div className="rounded-lg border p-3 bg-muted/50">
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Configure load balancing strategy and advanced settings in the{' '}
                <Link href="/dashboard/load-balancing" className="text-primary underline">
                  Load Balancing
                </Link>{' '}
                section.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClusterDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveCluster}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Backend Dialog */}
      <Dialog open={backendDialogOpen} onOpenChange={setBackendDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingBackend ? 'Edit Backend' : 'Add Backend'}</DialogTitle>
            <DialogDescription>
              {editingBackend ? 'Update backend server configuration' : 'Add a new backend server to the cluster'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="backend-name">Name</Label>
                <Input
                  id="backend-name"
                  value={backendForm.name}
                  onChange={(e) => setBackendForm({ ...backendForm, name: e.target.value })}
                  placeholder="server-1"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="backend-status">Status</Label>
                <Select
                  value={backendForm.status}
                  onValueChange={(value) => setBackendForm({ ...backendForm, status: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HEALTHY">Healthy</SelectItem>
                    <SelectItem value="UNHEALTHY">Unhealthy</SelectItem>
                    <SelectItem value="DRAINING">Draining</SelectItem>
                    <SelectItem value="MAINTENANCE">Maintenance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 grid gap-2">
                <Label htmlFor="backend-host">Host</Label>
                <Input
                  id="backend-host"
                  value={backendForm.host}
                  onChange={(e) => setBackendForm({ ...backendForm, host: e.target.value })}
                  placeholder="api.example.com"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="backend-port">Port</Label>
                <Input
                  id="backend-port"
                  type="number"
                  value={backendForm.port}
                  onChange={(e) => setBackendForm({ ...backendForm, port: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="backend-protocol">Protocol</Label>
                <Select
                  value={backendForm.protocol}
                  onValueChange={(value) => setBackendForm({ ...backendForm, protocol: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="https">HTTPS</SelectItem>
                    <SelectItem value="http">HTTP</SelectItem>
                    <SelectItem value="grpc">gRPC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="backend-weight">Weight</Label>
                <Input
                  id="backend-weight"
                  type="number"
                  value={backendForm.weight}
                  onChange={(e) => setBackendForm({ ...backendForm, weight: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="backend-health-path">Health Check Path (Override)</Label>
                <Input
                  id="backend-health-path"
                  value={backendForm.healthCheckPath}
                  onChange={(e) => setBackendForm({ ...backendForm, healthCheckPath: e.target.value })}
                  placeholder="Uses Load Balancing config if empty"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="backend-max-conn">Max Connections</Label>
                <Input
                  id="backend-max-conn"
                  type="number"
                  value={backendForm.maxConnections}
                  onChange={(e) => setBackendForm({ ...backendForm, maxConnections: e.target.value })}
                  placeholder="Unlimited"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBackendDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveBackend}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.type}?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name}&quot;?
              {deleteTarget?.type === 'cluster' && ' This will also delete all backends in this cluster.'}
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Dialog */}
      <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedClusters.size} cluster{selectedClusters.size > 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the selected clusters? This will also delete all backends
              in these clusters. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete} className="bg-red-600 hover:bg-red-700">
              Delete {selectedClusters.size} Cluster{selectedClusters.size > 1 ? 's' : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
