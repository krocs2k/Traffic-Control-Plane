"use client";

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import {
  RefreshCw,
  Plus,
  MoreVertical,
  Pencil,
  Trash2,
  Shield,
  Gauge,
  Zap,
  Activity,
  Loader2,
  CircleDot,
  CircleOff,
  CircleDashed,
} from 'lucide-react';

interface CircuitBreaker {
  id: string;
  name: string;
  targetType: string;
  targetId: string;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureThreshold: number;
  successThreshold: number;
  timeoutMs: number;
  halfOpenMaxRequests: number;
  failureCount: number;
  successCount: number;
  isActive: boolean;
  lastStateChange: string | null;
  createdAt: string;
}

interface RateLimitRule {
  id: string;
  name: string;
  description: string | null;
  type: string;
  limit: number;
  windowMs: number;
  burstLimit: number | null;
  scope: string;
  matchConditions: unknown[];
  action: string;
  isActive: boolean;
  priority: number;
  createdAt: string;
}

interface Backend {
  id: string;
  name: string;
  clusterId: string;
}

interface Cluster {
  id: string;
  name: string;
}

export default function TrafficManagementPage() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [circuitBreakers, setCircuitBreakers] = useState<CircuitBreaker[]>([]);
  const [rateLimits, setRateLimits] = useState<RateLimitRule[]>([]);
  const [backends, setBackends] = useState<Backend[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);

  // Circuit breaker form
  const [cbDialogOpen, setCbDialogOpen] = useState(false);
  const [editingCb, setEditingCb] = useState<CircuitBreaker | null>(null);
  const [cbForm, setCbForm] = useState({
    name: '',
    targetType: 'backend',
    targetId: '',
    failureThreshold: 5,
    successThreshold: 3,
    timeoutMs: 30000,
    halfOpenMaxRequests: 3,
    isActive: true,
  });

  // Rate limit form
  const [rlDialogOpen, setRlDialogOpen] = useState(false);
  const [editingRl, setEditingRl] = useState<RateLimitRule | null>(null);
  const [rlForm, setRlForm] = useState({
    name: '',
    description: '',
    type: 'REQUESTS_PER_MINUTE',
    limit: 100,
    windowMs: 60000,
    burstLimit: null as number | null,
    scope: 'global',
    action: 'reject',
    isActive: true,
    priority: 100,
  });

  // Delete dialogs
  const [deleteCbId, setDeleteCbId] = useState<string | null>(null);
  const [deleteRlId, setDeleteRlId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [cbRes, rlRes, backendsRes, clustersRes] = await Promise.all([
        fetch('/api/circuit-breakers'),
        fetch('/api/rate-limits'),
        fetch('/api/backends'),
        fetch('/api/backends/clusters'),
      ]);

      if (cbRes.ok) setCircuitBreakers(await cbRes.json());
      if (rlRes.ok) setRateLimits(await rlRes.json());
      if (backendsRes.ok) setBackends(await backendsRes.json());
      if (clustersRes.ok) setClusters(await clustersRes.json());
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    } else if (status === 'authenticated') {
      fetchData();
    }
  }, [status, router, fetchData]);

  // Circuit Breaker handlers
  const openCbDialog = (cb?: CircuitBreaker) => {
    if (cb) {
      setEditingCb(cb);
      setCbForm({
        name: cb.name,
        targetType: cb.targetType,
        targetId: cb.targetId,
        failureThreshold: cb.failureThreshold,
        successThreshold: cb.successThreshold,
        timeoutMs: cb.timeoutMs,
        halfOpenMaxRequests: cb.halfOpenMaxRequests,
        isActive: cb.isActive,
      });
    } else {
      setEditingCb(null);
      setCbForm({
        name: '',
        targetType: 'backend',
        targetId: '',
        failureThreshold: 5,
        successThreshold: 3,
        timeoutMs: 30000,
        halfOpenMaxRequests: 3,
        isActive: true,
      });
    }
    setCbDialogOpen(true);
  };

  const saveCb = async () => {
    try {
      if (!cbForm.name || !cbForm.targetId) {
        toast.error('Name and target are required');
        return;
      }

      const method = editingCb ? 'PATCH' : 'POST';
      const url = editingCb
        ? `/api/circuit-breakers/${editingCb.id}`
        : '/api/circuit-breakers';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cbForm),
      });

      if (res.ok) {
        toast.success(editingCb ? 'Circuit breaker updated' : 'Circuit breaker created');
        setCbDialogOpen(false);
        fetchData();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to save circuit breaker');
      }
    } catch (error) {
      console.error('Error saving circuit breaker:', error);
      toast.error('Failed to save circuit breaker');
    }
  };

  const deleteCb = async () => {
    if (!deleteCbId) return;
    try {
      const res = await fetch(`/api/circuit-breakers/${deleteCbId}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Circuit breaker deleted');
        fetchData();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to delete');
      }
    } catch (error) {
      console.error('Error deleting circuit breaker:', error);
      toast.error('Failed to delete');
    } finally {
      setDeleteCbId(null);
    }
  };

  const toggleCbState = async (cb: CircuitBreaker, newState: 'CLOSED' | 'OPEN' | 'HALF_OPEN') => {
    try {
      const res = await fetch(`/api/circuit-breakers/${cb.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: newState }),
      });
      if (res.ok) {
        toast.success(`Circuit breaker state changed to ${newState}`);
        fetchData();
      }
    } catch (error) {
      console.error('Error toggling state:', error);
      toast.error('Failed to change state');
    }
  };

  // Rate Limit handlers
  const openRlDialog = (rl?: RateLimitRule) => {
    if (rl) {
      setEditingRl(rl);
      setRlForm({
        name: rl.name,
        description: rl.description || '',
        type: rl.type,
        limit: rl.limit,
        windowMs: rl.windowMs,
        burstLimit: rl.burstLimit,
        scope: rl.scope,
        action: rl.action,
        isActive: rl.isActive,
        priority: rl.priority,
      });
    } else {
      setEditingRl(null);
      setRlForm({
        name: '',
        description: '',
        type: 'REQUESTS_PER_MINUTE',
        limit: 100,
        windowMs: 60000,
        burstLimit: null,
        scope: 'global',
        action: 'reject',
        isActive: true,
        priority: 100,
      });
    }
    setRlDialogOpen(true);
  };

  const saveRl = async () => {
    try {
      if (!rlForm.name) {
        toast.error('Name is required');
        return;
      }

      const method = editingRl ? 'PATCH' : 'POST';
      const url = editingRl
        ? `/api/rate-limits/${editingRl.id}`
        : '/api/rate-limits';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rlForm),
      });

      if (res.ok) {
        toast.success(editingRl ? 'Rate limit updated' : 'Rate limit created');
        setRlDialogOpen(false);
        fetchData();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to save rate limit');
      }
    } catch (error) {
      console.error('Error saving rate limit:', error);
      toast.error('Failed to save rate limit');
    }
  };

  const deleteRl = async () => {
    if (!deleteRlId) return;
    try {
      const res = await fetch(`/api/rate-limits/${deleteRlId}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Rate limit deleted');
        fetchData();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to delete');
      }
    } catch (error) {
      console.error('Error deleting rate limit:', error);
      toast.error('Failed to delete');
    } finally {
      setDeleteRlId(null);
    }
  };

  const toggleRlActive = async (rl: RateLimitRule) => {
    try {
      const res = await fetch(`/api/rate-limits/${rl.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !rl.isActive }),
      });
      if (res.ok) {
        toast.success(`Rate limit ${rl.isActive ? 'disabled' : 'enabled'}`);
        fetchData();
      }
    } catch (error) {
      console.error('Error toggling rate limit:', error);
      toast.error('Failed to toggle rate limit');
    }
  };

  const getCbStateIcon = (state: string) => {
    switch (state) {
      case 'CLOSED':
        return <CircleDot className="h-4 w-4 text-green-500" />;
      case 'OPEN':
        return <CircleOff className="h-4 w-4 text-red-500" />;
      case 'HALF_OPEN':
        return <CircleDashed className="h-4 w-4 text-yellow-500" />;
      default:
        return <CircleDot className="h-4 w-4 text-gray-500" />;
    }
  };

  const getCbStateBadgeVariant = (state: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (state) {
      case 'CLOSED':
        return 'default';
      case 'OPEN':
        return 'destructive';
      case 'HALF_OPEN':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Traffic Management</h1>
          <p className="text-muted-foreground">Configure circuit breakers and rate limiting rules</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Shield className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{circuitBreakers.length}</p>
                <p className="text-sm text-muted-foreground">Circuit Breakers</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <CircleDot className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-2xl font-bold">
                  {circuitBreakers.filter(cb => cb.state === 'CLOSED').length}
                </p>
                <p className="text-sm text-muted-foreground">Closed</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Gauge className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{rateLimits.length}</p>
                <p className="text-sm text-muted-foreground">Rate Limits</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Activity className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-2xl font-bold">
                  {rateLimits.filter(rl => rl.isActive).length}
                </p>
                <p className="text-sm text-muted-foreground">Active Rules</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="circuit-breakers">
        <TabsList>
          <TabsTrigger value="circuit-breakers" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Circuit Breakers
          </TabsTrigger>
          <TabsTrigger value="rate-limits" className="flex items-center gap-2">
            <Gauge className="h-4 w-4" />
            Rate Limits
          </TabsTrigger>
        </TabsList>

        {/* Circuit Breakers Tab */}
        <TabsContent value="circuit-breakers" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Circuit Breakers</CardTitle>
                  <CardDescription>
                    Protect your services from cascading failures
                  </CardDescription>
                </div>
                <Button onClick={() => openCbDialog()}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Circuit Breaker
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {circuitBreakers.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No circuit breakers configured. Create one to protect your services.
                </div>
              ) : (
                <div className="space-y-4">
                  {circuitBreakers.map((cb) => (
                    <div
                      key={cb.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div className="flex items-center gap-4">
                        {getCbStateIcon(cb.state)}
                        <div>
                          <p className="font-medium">{cb.name}</p>
                          <p className="text-sm text-muted-foreground">
                            Target: {cb.targetType} ({cb.targetId.slice(0, 8)}...)
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right text-sm">
                          <p>Failures: {cb.failureCount}/{cb.failureThreshold}</p>
                          <p className="text-muted-foreground">
                            Timeout: {cb.timeoutMs / 1000}s
                          </p>
                        </div>
                        <Badge variant={getCbStateBadgeVariant(cb.state)}>
                          {cb.state}
                        </Badge>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openCbDialog(cb)}>
                              <Pencil className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            {cb.state !== 'CLOSED' && (
                              <DropdownMenuItem onClick={() => toggleCbState(cb, 'CLOSED')}>
                                <CircleDot className="h-4 w-4 mr-2" />
                                Close Circuit
                              </DropdownMenuItem>
                            )}
                            {cb.state !== 'OPEN' && (
                              <DropdownMenuItem onClick={() => toggleCbState(cb, 'OPEN')}>
                                <CircleOff className="h-4 w-4 mr-2" />
                                Open Circuit
                              </DropdownMenuItem>
                            )}
                            {cb.state !== 'HALF_OPEN' && (
                              <DropdownMenuItem onClick={() => toggleCbState(cb, 'HALF_OPEN')}>
                                <CircleDashed className="h-4 w-4 mr-2" />
                                Half-Open
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setDeleteCbId(cb.id)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Rate Limits Tab */}
        <TabsContent value="rate-limits" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Rate Limit Rules</CardTitle>
                  <CardDescription>
                    Control request rates and protect against abuse
                  </CardDescription>
                </div>
                <Button onClick={() => openRlDialog()}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Rate Limit
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {rateLimits.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No rate limit rules configured. Create one to protect your services.
                </div>
              ) : (
                <div className="space-y-4">
                  {rateLimits.map((rl) => (
                    <div
                      key={rl.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div className="flex items-center gap-4">
                        <Gauge className={`h-5 w-5 ${rl.isActive ? 'text-green-500' : 'text-gray-400'}`} />
                        <div>
                          <p className="font-medium">{rl.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {rl.limit} {rl.type.toLowerCase().replace(/_/g, ' ')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right text-sm">
                          <p>Scope: {rl.scope}</p>
                          <p className="text-muted-foreground">Action: {rl.action}</p>
                        </div>
                        <Badge variant={rl.isActive ? 'default' : 'secondary'}>
                          Priority: {rl.priority}
                        </Badge>
                        <Switch
                          checked={rl.isActive}
                          onCheckedChange={() => toggleRlActive(rl)}
                        />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openRlDialog(rl)}>
                              <Pencil className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setDeleteRlId(rl.id)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Circuit Breaker Dialog */}
      <Dialog open={cbDialogOpen} onOpenChange={setCbDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingCb ? 'Edit Circuit Breaker' : 'Create Circuit Breaker'}
            </DialogTitle>
            <DialogDescription>
              Configure circuit breaker settings to protect your service
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={cbForm.name}
                onChange={(e) => setCbForm({ ...cbForm, name: e.target.value })}
                placeholder="e.g., API Gateway Breaker"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Target Type</Label>
                <Select
                  value={cbForm.targetType}
                  onValueChange={(v) => setCbForm({ ...cbForm, targetType: v, targetId: '' })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="backend">Backend</SelectItem>
                    <SelectItem value="cluster">Cluster</SelectItem>
                    <SelectItem value="route">Route</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Target</Label>
                <Select
                  value={cbForm.targetId || '__none__'}
                  onValueChange={(v) => setCbForm({ ...cbForm, targetId: v === '__none__' ? '' : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select target" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" disabled>Select target</SelectItem>
                    {cbForm.targetType === 'backend' &&
                      backends.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    {cbForm.targetType === 'cluster' &&
                      clusters.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Failure Threshold</Label>
                <Input
                  type="number"
                  value={cbForm.failureThreshold}
                  onChange={(e) =>
                    setCbForm({ ...cbForm, failureThreshold: parseInt(e.target.value) || 5 })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Success Threshold</Label>
                <Input
                  type="number"
                  value={cbForm.successThreshold}
                  onChange={(e) =>
                    setCbForm({ ...cbForm, successThreshold: parseInt(e.target.value) || 3 })
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Timeout (ms)</Label>
                <Input
                  type="number"
                  value={cbForm.timeoutMs}
                  onChange={(e) =>
                    setCbForm({ ...cbForm, timeoutMs: parseInt(e.target.value) || 30000 })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Half-Open Max Requests</Label>
                <Input
                  type="number"
                  value={cbForm.halfOpenMaxRequests}
                  onChange={(e) =>
                    setCbForm({ ...cbForm, halfOpenMaxRequests: parseInt(e.target.value) || 3 })
                  }
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={cbForm.isActive}
                onCheckedChange={(checked) => setCbForm({ ...cbForm, isActive: checked })}
              />
              <Label>Active</Label>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCbDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveCb}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rate Limit Dialog */}
      <Dialog open={rlDialogOpen} onOpenChange={setRlDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingRl ? 'Edit Rate Limit' : 'Create Rate Limit'}
            </DialogTitle>
            <DialogDescription>
              Configure rate limiting rules to control request rates
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={rlForm.name}
                onChange={(e) => setRlForm({ ...rlForm, name: e.target.value })}
                placeholder="e.g., API Rate Limit"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={rlForm.description}
                onChange={(e) => setRlForm({ ...rlForm, description: e.target.value })}
                placeholder="Describe the rate limit rule"
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={rlForm.type}
                  onValueChange={(v) => setRlForm({ ...rlForm, type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="REQUESTS_PER_SECOND">Requests/sec</SelectItem>
                    <SelectItem value="REQUESTS_PER_MINUTE">Requests/min</SelectItem>
                    <SelectItem value="REQUESTS_PER_HOUR">Requests/hour</SelectItem>
                    <SelectItem value="CONCURRENT_CONNECTIONS">Concurrent</SelectItem>
                    <SelectItem value="BANDWIDTH">Bandwidth</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Limit</Label>
                <Input
                  type="number"
                  value={rlForm.limit}
                  onChange={(e) =>
                    setRlForm({ ...rlForm, limit: parseInt(e.target.value) || 100 })
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Scope</Label>
                <Select
                  value={rlForm.scope}
                  onValueChange={(v) => setRlForm({ ...rlForm, scope: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">Global</SelectItem>
                    <SelectItem value="ip">Per IP</SelectItem>
                    <SelectItem value="user">Per User</SelectItem>
                    <SelectItem value="route">Per Route</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Action</Label>
                <Select
                  value={rlForm.action}
                  onValueChange={(v) => setRlForm({ ...rlForm, action: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="reject">Reject</SelectItem>
                    <SelectItem value="queue">Queue</SelectItem>
                    <SelectItem value="throttle">Throttle</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Priority</Label>
                <Input
                  type="number"
                  value={rlForm.priority}
                  onChange={(e) =>
                    setRlForm({ ...rlForm, priority: parseInt(e.target.value) || 100 })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Burst Limit (optional)</Label>
                <Input
                  type="number"
                  value={rlForm.burstLimit || ''}
                  onChange={(e) =>
                    setRlForm({
                      ...rlForm,
                      burstLimit: e.target.value ? parseInt(e.target.value) : null,
                    })
                  }
                  placeholder="No burst"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={rlForm.isActive}
                onCheckedChange={(checked) => setRlForm({ ...rlForm, isActive: checked })}
              />
              <Label>Active</Label>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRlDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveRl}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Circuit Breaker Dialog */}
      <AlertDialog open={!!deleteCbId} onOpenChange={() => setDeleteCbId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Circuit Breaker?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The circuit breaker will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteCb} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Rate Limit Dialog */}
      <AlertDialog open={!!deleteRlId} onOpenChange={() => setDeleteRlId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Rate Limit Rule?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The rate limit rule will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteRl} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
