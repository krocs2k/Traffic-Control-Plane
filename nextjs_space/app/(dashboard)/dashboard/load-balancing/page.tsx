"use client";

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';
import {
  Plus,
  Settings,
  RefreshCw,
  Trash2,
  Edit,
  Server,
  Activity,
  Shuffle,
  Shield,
  Clock,
  Zap,
  Network,
  MoreVertical,
  Info,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface Backend {
  id: string;
  name: string;
  weight: number;
  status: string;
}

interface Cluster {
  id: string;
  name: string;
  backends: Backend[];
}

interface LoadBalancerConfig {
  id: string;
  orgId: string;
  clusterId: string;
  strategy: string;
  stickySession: boolean;
  sessionCookieName?: string;
  sessionTtlMs: number;
  healthCheckEnabled: boolean;
  healthCheckIntervalMs: number;
  healthCheckPath: string;
  healthCheckTimeoutMs: number;
  failoverEnabled: boolean;
  failoverThreshold: number;
  retryEnabled: boolean;
  maxRetries: number;
  retryDelayMs: number;
  connectionDrainingMs: number;
  slowStartMs?: number;
  weights: Record<string, number>;
  cluster?: Cluster;
}

const STRATEGIES = [
  { value: 'ROUND_ROBIN', label: 'Round Robin', description: 'Distributes requests evenly across all backends' },
  { value: 'LEAST_CONNECTIONS', label: 'Least Connections', description: 'Routes to backend with fewest active connections' },
  { value: 'RANDOM', label: 'Random', description: 'Randomly selects a backend for each request' },
  { value: 'IP_HASH', label: 'IP Hash', description: 'Routes based on client IP hash for session affinity' },
  { value: 'WEIGHTED_ROUND_ROBIN', label: 'Weighted Round Robin', description: 'Round robin with configurable weights' },
];

export default function LoadBalancingPage() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const [configs, setConfigs] = useState<LoadBalancerConfig[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editConfig, setEditConfig] = useState<LoadBalancerConfig | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedConfig, setSelectedConfig] = useState<LoadBalancerConfig | null>(null);

  const [formData, setFormData] = useState({
    clusterId: '',
    strategy: 'ROUND_ROBIN',
    stickySession: false,
    sessionCookieName: 'LB_SESSION',
    sessionTtlMs: 3600000,
    healthCheckEnabled: true,
    healthCheckIntervalMs: 30000,
    healthCheckPath: '',
    healthCheckTimeoutMs: 5000,
    failoverEnabled: true,
    failoverThreshold: 3,
    retryEnabled: true,
    maxRetries: 3,
    retryDelayMs: 1000,
    connectionDrainingMs: 30000,
    slowStartMs: 0,
    weights: {} as Record<string, number>,
  });

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    fetchConfigs();
    fetchClusters();
  }, []);

  const fetchConfigs = async () => {
    try {
      const res = await fetch('/api/load-balancing');
      if (res.ok) {
        const data = await res.json();
        setConfigs(data);
      }
    } catch (error) {
      console.error('Error fetching load balancer configs:', error);
      toast.error('Failed to fetch configurations');
    } finally {
      setLoading(false);
    }
  };

  const fetchClusters = async () => {
    try {
      const res = await fetch('/api/backends/clusters');
      if (res.ok) {
        const data = await res.json();
        setClusters(data);
      }
    } catch (error) {
      console.error('Error fetching clusters:', error);
    }
  };

  const handleSubmit = async () => {
    try {
      const url = editConfig ? `/api/load-balancing/${editConfig.id}` : '/api/load-balancing';
      const method = editConfig ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        toast.success(editConfig ? 'Configuration updated' : 'Configuration created');
        setDialogOpen(false);
        resetForm();
        fetchConfigs();
      } else {
        const error = await res.json();
        toast.error(error.error || 'Failed to save configuration');
      }
    } catch (error) {
      console.error('Error saving configuration:', error);
      toast.error('Failed to save configuration');
    }
  };

  const handleDelete = async () => {
    if (!selectedConfig) return;

    try {
      const res = await fetch(`/api/load-balancing/${selectedConfig.id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        toast.success('Configuration deleted');
        setDeleteDialogOpen(false);
        setSelectedConfig(null);
        fetchConfigs();
      } else {
        toast.error('Failed to delete configuration');
      }
    } catch (error) {
      console.error('Error deleting configuration:', error);
      toast.error('Failed to delete configuration');
    }
  };

  const openEditDialog = (config: LoadBalancerConfig) => {
    setEditConfig(config);
    setFormData({
      clusterId: config.clusterId,
      strategy: config.strategy,
      stickySession: config.stickySession,
      sessionCookieName: config.sessionCookieName || 'LB_SESSION',
      sessionTtlMs: config.sessionTtlMs,
      healthCheckEnabled: config.healthCheckEnabled,
      healthCheckIntervalMs: config.healthCheckIntervalMs,
      healthCheckPath: config.healthCheckPath,
      healthCheckTimeoutMs: config.healthCheckTimeoutMs,
      failoverEnabled: config.failoverEnabled,
      failoverThreshold: config.failoverThreshold,
      retryEnabled: config.retryEnabled,
      maxRetries: config.maxRetries,
      retryDelayMs: config.retryDelayMs,
      connectionDrainingMs: config.connectionDrainingMs,
      slowStartMs: config.slowStartMs || 0,
      weights: config.weights as Record<string, number>,
    });
    setDialogOpen(true);
  };

  const resetForm = () => {
    setEditConfig(null);
    setFormData({
      clusterId: '',
      strategy: 'ROUND_ROBIN',
      stickySession: false,
      sessionCookieName: 'LB_SESSION',
      sessionTtlMs: 3600000,
      healthCheckEnabled: true,
      healthCheckIntervalMs: 30000,
      healthCheckPath: '',
      healthCheckTimeoutMs: 5000,
      failoverEnabled: true,
      failoverThreshold: 3,
      retryEnabled: true,
      maxRetries: 3,
      retryDelayMs: 1000,
      connectionDrainingMs: 30000,
      slowStartMs: 0,
      weights: {},
    });
  };

  const getStrategyIcon = (strategy: string) => {
    switch (strategy) {
      case 'ROUND_ROBIN':
        return <Shuffle className="h-4 w-4" />;
      case 'LEAST_CONNECTIONS':
        return <Activity className="h-4 w-4" />;
      case 'RANDOM':
        return <Zap className="h-4 w-4" />;
      case 'IP_HASH':
        return <Network className="h-4 w-4" />;
      case 'WEIGHTED_ROUND_ROBIN':
        return <Server className="h-4 w-4" />;
      default:
        return <Settings className="h-4 w-4" />;
    }
  };

  const getAvailableClusters = () => {
    const configuredClusterIds = configs.map(c => c.clusterId);
    return clusters.filter(c => !configuredClusterIds.includes(c.id) || editConfig?.clusterId === c.id);
  };

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Network className="h-8 w-8" />
            Load Balancing
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure advanced load balancing algorithms for your backend clusters
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchConfigs}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={() => { resetForm(); setDialogOpen(true); }} disabled={getAvailableClusters().length === 0}>
            <Plus className="h-4 w-4 mr-2" />
            New Configuration
          </Button>
        </div>
      </div>

      {/* Algorithm Overview */}
      <Card>
        <CardHeader>
          <CardTitle>Load Balancing Algorithms</CardTitle>
          <CardDescription>Available algorithms for distributing traffic across backends</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {STRATEGIES.map((strategy) => (
              <div key={strategy.value} className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  {getStrategyIcon(strategy.value)}
                  <span className="font-medium text-sm">{strategy.label}</span>
                </div>
                <p className="text-xs text-muted-foreground">{strategy.description}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Configurations */}
      <Card>
        <CardHeader>
          <CardTitle>Cluster Configurations</CardTitle>
          <CardDescription>Manage load balancing settings for each cluster</CardDescription>
        </CardHeader>
        <CardContent>
          {configs.length === 0 ? (
            <div className="text-center py-12">
              <Network className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold">No configurations yet</h3>
              <p className="text-muted-foreground mb-4">Create a load balancer configuration for your clusters</p>
              <Button onClick={() => { resetForm(); setDialogOpen(true); }} disabled={clusters.length === 0}>
                <Plus className="h-4 w-4 mr-2" />
                Create Configuration
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {configs.map((config) => (
                <Card key={config.id} className="relative">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">
                        {config.cluster?.name || 'Unknown Cluster'}
                      </CardTitle>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditDialog(config)}>
                            <Edit className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={() => {
                              setSelectedConfig(config);
                              setDeleteDialogOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-2">
                      {getStrategyIcon(config.strategy)}
                      <Badge variant="secondary">
                        {STRATEGIES.find(s => s.value === config.strategy)?.label || config.strategy}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Shield className={`h-4 w-4 ${config.healthCheckEnabled ? 'text-green-500' : 'text-gray-400'}`} />
                        <span>Health Check</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Activity className={`h-4 w-4 ${config.failoverEnabled ? 'text-green-500' : 'text-gray-400'}`} />
                        <span>Failover</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <RefreshCw className={`h-4 w-4 ${config.retryEnabled ? 'text-green-500' : 'text-gray-400'}`} />
                        <span>Retry</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className={`h-4 w-4 ${config.stickySession ? 'text-green-500' : 'text-gray-400'}`} />
                        <span>Sticky Session</span>
                      </div>
                    </div>

                    {config.cluster?.backends && config.cluster.backends.length > 0 && (
                      <div className="border-t pt-3">
                        <p className="text-sm text-muted-foreground mb-2">
                          {config.cluster.backends.length} backend(s)
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {config.cluster.backends.slice(0, 3).map((backend) => (
                            <Badge key={backend.id} variant="outline" className="text-xs">
                              {backend.name}
                            </Badge>
                          ))}
                          {config.cluster.backends.length > 3 && (
                            <Badge variant="outline" className="text-xs">
                              +{config.cluster.backends.length - 3} more
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Configuration Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editConfig ? 'Edit Configuration' : 'New Load Balancer Configuration'}</DialogTitle>
            <DialogDescription>
              Configure load balancing settings for a backend cluster
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="basic" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="basic">Basic</TabsTrigger>
              <TabsTrigger value="health">Health Check</TabsTrigger>
              <TabsTrigger value="failover">Failover</TabsTrigger>
              <TabsTrigger value="session">Session</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-4 mt-4">
              {!editConfig && (
                <div className="space-y-2">
                  <Label>Target Cluster</Label>
                  <Select
                    value={formData.clusterId || '__none__'}
                    onValueChange={(value) => setFormData({ ...formData, clusterId: value === '__none__' ? '' : value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a cluster" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select a cluster</SelectItem>
                      {getAvailableClusters().map((cluster) => (
                        <SelectItem key={cluster.id} value={cluster.id}>
                          {cluster.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label>Load Balancing Strategy</Label>
                <Select
                  value={formData.strategy}
                  onValueChange={(value) => setFormData({ ...formData, strategy: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STRATEGIES.map((strategy) => (
                      <SelectItem key={strategy.value} value={strategy.value}>
                        <div className="flex items-center gap-2">
                          {getStrategyIcon(strategy.value)}
                          <span>{strategy.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                  {STRATEGIES.find(s => s.value === formData.strategy)?.description}
                </p>
              </div>

              <div className="space-y-4">
                <Label>Connection Draining Timeout: {(formData.connectionDrainingMs / 1000).toFixed(0)}s</Label>
                <Slider
                  value={[formData.connectionDrainingMs]}
                  onValueChange={(value) => setFormData({ ...formData, connectionDrainingMs: value[0] })}
                  min={5000}
                  max={120000}
                  step={5000}
                />
                <p className="text-sm text-muted-foreground">
                  Time to wait for existing connections to complete before removing a backend
                </p>
              </div>

              <div className="space-y-4">
                <Label>Slow Start Duration: {formData.slowStartMs === 0 ? 'Disabled' : `${(formData.slowStartMs || 0) / 1000}s`}</Label>
                <Slider
                  value={[formData.slowStartMs || 0]}
                  onValueChange={(value) => setFormData({ ...formData, slowStartMs: value[0] })}
                  min={0}
                  max={300000}
                  step={15000}
                />
                <p className="text-sm text-muted-foreground">
                  Gradually increase traffic to new backends over this duration
                </p>
              </div>
            </TabsContent>

            <TabsContent value="health" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Enable Health Checks</Label>
                  <p className="text-sm text-muted-foreground">Periodically check backend health</p>
                </div>
                <Switch
                  checked={formData.healthCheckEnabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, healthCheckEnabled: checked })}
                />
              </div>

              {formData.healthCheckEnabled && (
                <>
                  <div className="space-y-2">
                    <Label>Health Check Path</Label>
                    <Input
                      value={formData.healthCheckPath}
                      onChange={(e) => setFormData({ ...formData, healthCheckPath: e.target.value })}
                      placeholder="Defaults to /health if empty"
                    />
                    <p className="text-xs text-muted-foreground">Leave empty to use default /health path</p>
                  </div>

                  <div className="space-y-4">
                    <Label>Check Interval: {(formData.healthCheckIntervalMs / 1000).toFixed(0)}s</Label>
                    <Slider
                      value={[formData.healthCheckIntervalMs]}
                      onValueChange={(value) => setFormData({ ...formData, healthCheckIntervalMs: value[0] })}
                      min={5000}
                      max={120000}
                      step={5000}
                    />
                  </div>

                  <div className="space-y-4">
                    <Label>Timeout: {(formData.healthCheckTimeoutMs / 1000).toFixed(1)}s</Label>
                    <Slider
                      value={[formData.healthCheckTimeoutMs]}
                      onValueChange={(value) => setFormData({ ...formData, healthCheckTimeoutMs: value[0] })}
                      min={1000}
                      max={30000}
                      step={1000}
                    />
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="failover" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Enable Failover</Label>
                  <p className="text-sm text-muted-foreground">Automatically route traffic away from unhealthy backends</p>
                </div>
                <Switch
                  checked={formData.failoverEnabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, failoverEnabled: checked })}
                />
              </div>

              {formData.failoverEnabled && (
                <div className="space-y-4">
                  <Label>Failure Threshold: {formData.failoverThreshold} consecutive failures</Label>
                  <Slider
                    value={[formData.failoverThreshold]}
                    onValueChange={(value) => setFormData({ ...formData, failoverThreshold: value[0] })}
                    min={1}
                    max={10}
                    step={1}
                  />
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Enable Retries</Label>
                  <p className="text-sm text-muted-foreground">Retry failed requests on different backends</p>
                </div>
                <Switch
                  checked={formData.retryEnabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, retryEnabled: checked })}
                />
              </div>

              {formData.retryEnabled && (
                <>
                  <div className="space-y-4">
                    <Label>Max Retries: {formData.maxRetries}</Label>
                    <Slider
                      value={[formData.maxRetries]}
                      onValueChange={(value) => setFormData({ ...formData, maxRetries: value[0] })}
                      min={1}
                      max={10}
                      step={1}
                    />
                  </div>

                  <div className="space-y-4">
                    <Label>Retry Delay: {formData.retryDelayMs}ms</Label>
                    <Slider
                      value={[formData.retryDelayMs]}
                      onValueChange={(value) => setFormData({ ...formData, retryDelayMs: value[0] })}
                      min={100}
                      max={5000}
                      step={100}
                    />
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="session" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Enable Sticky Sessions</Label>
                  <p className="text-sm text-muted-foreground">Route requests from the same client to the same backend</p>
                </div>
                <Switch
                  checked={formData.stickySession}
                  onCheckedChange={(checked) => setFormData({ ...formData, stickySession: checked })}
                />
              </div>

              {formData.stickySession && (
                <>
                  <div className="space-y-2">
                    <Label>Session Cookie Name</Label>
                    <Input
                      value={formData.sessionCookieName}
                      onChange={(e) => setFormData({ ...formData, sessionCookieName: e.target.value })}
                      placeholder="LB_SESSION"
                    />
                  </div>

                  <div className="space-y-4">
                    <Label>Session TTL: {(formData.sessionTtlMs / 3600000).toFixed(1)} hours</Label>
                    <Slider
                      value={[formData.sessionTtlMs]}
                      onValueChange={(value) => setFormData({ ...formData, sessionTtlMs: value[0] })}
                      min={300000}
                      max={86400000}
                      step={300000}
                    />
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!editConfig && !formData.clusterId}>
              {editConfig ? 'Update Configuration' : 'Create Configuration'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Configuration</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this load balancer configuration? The cluster will use default settings.
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
    </div>
  );
}
