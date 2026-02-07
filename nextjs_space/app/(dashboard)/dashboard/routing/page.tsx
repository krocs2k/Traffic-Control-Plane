"use client";

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import {
  Route,
  Plus,
  Pencil,
  Trash2,
  MoreVertical,
  RefreshCw,
  Play,
  Pause,
  GitBranch,
  Target,
  Globe,
  FileCode,
  Layers,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { hasPermission } from '@/lib/types';

interface RoutingPolicy {
  id: string;
  name: string;
  description: string | null;
  type: string;
  priority: number;
  conditions: unknown[];
  actions: Record<string, unknown>;
  isActive: boolean;
  clusterId: string | null;
  cluster: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

interface BackendCluster {
  id: string;
  name: string;
}

const POLICY_TYPE_ICONS: Record<string, React.ReactNode> = {
  WEIGHTED: <Target className="h-4 w-4" />,
  CANARY: <GitBranch className="h-4 w-4" />,
  BLUE_GREEN: <Layers className="h-4 w-4" />,
  GEOGRAPHIC: <Globe className="h-4 w-4" />,
  HEADER_BASED: <FileCode className="h-4 w-4" />,
  PATH_BASED: <Route className="h-4 w-4" />,
  FAILOVER: <AlertTriangle className="h-4 w-4" />,
};

const POLICY_TYPE_LABELS: Record<string, string> = {
  WEIGHTED: 'Weighted',
  CANARY: 'Canary',
  BLUE_GREEN: 'Blue/Green',
  GEOGRAPHIC: 'Geographic',
  HEADER_BASED: 'Header-Based',
  PATH_BASED: 'Path-Based',
  FAILOVER: 'Failover',
};

const POLICY_TYPE_DESCRIPTIONS: Record<string, string> = {
  WEIGHTED: 'Route traffic based on percentage weights',
  CANARY: 'Gradually roll out changes to a subset of users',
  BLUE_GREEN: 'Switch between two identical environments',
  GEOGRAPHIC: 'Route based on user geographic location',
  HEADER_BASED: 'Route based on HTTP headers',
  PATH_BASED: 'Route based on URL path patterns',
  FAILOVER: 'Automatic failover to backup backends',
};

export default function RoutingPage() {
  const { data: session } = useSession() || {};
  const [policies, setPolicies] = useState<RoutingPolicy[]>([]);
  const [clusters, setClusters] = useState<BackendCluster[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [policyDialogOpen, setPolicyDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<RoutingPolicy | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoutingPolicy | null>(null);

  const [policyForm, setPolicyForm] = useState({
    name: '',
    description: '',
    type: 'WEIGHTED',
    priority: '100',
    clusterId: '',
    conditions: '[]',
    actions: '{}',
  });

  const orgId = session?.user?.currentOrgId;
  const userRole = session?.user?.currentOrgRole ?? 'VIEWER';
  const canManage = hasPermission(userRole, 'manage_routing');

  useEffect(() => {
    if (orgId) {
      fetchPolicies();
      fetchClusters();
    }
  }, [orgId]);

  const fetchPolicies = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/routing-policies?orgId=${orgId}`);
      if (res.ok) {
        const data = await res.json();
        setPolicies(data.policies || []);
      }
    } catch (error) {
      console.error('Error fetching policies:', error);
      toast.error('Failed to load routing policies');
    } finally {
      setLoading(false);
    }
  };

  const fetchClusters = async () => {
    try {
      const res = await fetch(`/api/backends/clusters?orgId=${orgId}`);
      if (res.ok) {
        const data = await res.json();
        setClusters(data.clusters || []);
      }
    } catch (error) {
      console.error('Error fetching clusters:', error);
    }
  };

  const openPolicyDialog = (policy?: RoutingPolicy) => {
    if (policy) {
      setEditingPolicy(policy);
      setPolicyForm({
        name: policy.name,
        description: policy.description || '',
        type: policy.type,
        priority: policy.priority.toString(),
        clusterId: policy.clusterId || '',
        conditions: JSON.stringify(policy.conditions, null, 2),
        actions: JSON.stringify(policy.actions, null, 2),
      });
    } else {
      setEditingPolicy(null);
      setPolicyForm({
        name: '',
        description: '',
        type: 'WEIGHTED',
        priority: '100',
        clusterId: '',
        conditions: '[]',
        actions: '{}',
      });
    }
    setPolicyDialogOpen(true);
  };

  const savePolicy = async () => {
    try {
      let conditions, actions;
      try {
        conditions = JSON.parse(policyForm.conditions);
        actions = JSON.parse(policyForm.actions);
      } catch {
        toast.error('Invalid JSON in conditions or actions');
        return;
      }

      const payload = {
        name: policyForm.name,
        description: policyForm.description,
        type: policyForm.type,
        priority: parseInt(policyForm.priority),
        clusterId: policyForm.clusterId || null,
        conditions,
        actions,
      };

      if (editingPolicy) {
        const res = await fetch(`/api/routing-policies/${editingPolicy.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to update policy');
        toast.success('Policy updated successfully');
      } else {
        const res = await fetch('/api/routing-policies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, orgId }),
        });
        if (!res.ok) throw new Error('Failed to create policy');
        toast.success('Policy created successfully');
      }
      setPolicyDialogOpen(false);
      fetchPolicies();
    } catch (error) {
      console.error('Error saving policy:', error);
      toast.error('Failed to save policy');
    }
  };

  const togglePolicy = async (policy: RoutingPolicy) => {
    try {
      const res = await fetch(`/api/routing-policies/${policy.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !policy.isActive }),
      });
      if (!res.ok) throw new Error('Failed to toggle policy');
      toast.success(`Policy ${policy.isActive ? 'disabled' : 'enabled'}`);
      fetchPolicies();
    } catch (error) {
      console.error('Error toggling policy:', error);
      toast.error('Failed to toggle policy');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/routing-policies/${deleteTarget.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete policy');
      toast.success('Policy deleted successfully');
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      fetchPolicies();
    } catch (error) {
      console.error('Error deleting policy:', error);
      toast.error('Failed to delete policy');
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
          <h1 className="text-2xl font-bold tracking-tight">Routing Policies</h1>
          <p className="text-muted-foreground">Configure traffic routing rules and strategies</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchPolicies}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          {canManage && (
            <Button onClick={() => openPolicyDialog()}>
              <Plus className="h-4 w-4 mr-2" />
              New Policy
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        {Object.entries(POLICY_TYPE_LABELS).map(([type, label]) => {
          const count = policies.filter(p => p.type === type).length;
          return (
            <Card key={type} className="text-center">
              <CardContent className="pt-4 pb-3">
                <div className="flex justify-center mb-2 text-muted-foreground">
                  {POLICY_TYPE_ICONS[type]}
                </div>
                <div className="text-2xl font-bold">{count}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active Policies</CardTitle>
          <CardDescription>Policies are evaluated in order of priority (lower = higher priority)</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : policies.length === 0 ? (
            <div className="text-center py-12">
              <Route className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium">No routing policies</h3>
              <p className="text-muted-foreground mt-1">Create your first routing policy to control traffic flow.</p>
              {canManage && (
                <Button className="mt-4" onClick={() => openPolicyDialog()}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Policy
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Status</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Cluster</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.map(policy => (
                  <TableRow key={policy.id}>
                    <TableCell>
                      {canManage ? (
                        <Switch
                          checked={policy.isActive}
                          onCheckedChange={() => togglePolicy(policy)}
                        />
                      ) : policy.isActive ? (
                        <Play className="h-4 w-4 text-green-500" />
                      ) : (
                        <Pause className="h-4 w-4 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{policy.name}</div>
                      {policy.description && (
                        <div className="text-sm text-muted-foreground truncate max-w-xs">
                          {policy.description}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="gap-1">
                        {POLICY_TYPE_ICONS[policy.type]}
                        {POLICY_TYPE_LABELS[policy.type] || policy.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{policy.priority}</Badge>
                    </TableCell>
                    <TableCell>
                      {policy.cluster ? (
                        <Badge variant="outline">{policy.cluster.name}</Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {canManage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openPolicyDialog(policy)}>
                              <Pencil className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-red-600"
                              onClick={() => {
                                setDeleteTarget(policy);
                                setDeleteDialogOpen(true);
                              }}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={policyDialogOpen} onOpenChange={setPolicyDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingPolicy ? 'Edit Policy' : 'New Routing Policy'}</DialogTitle>
            <DialogDescription>
              {editingPolicy ? 'Update the routing policy configuration' : 'Create a new routing policy'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="policy-name">Name</Label>
                <Input
                  id="policy-name"
                  value={policyForm.name}
                  onChange={(e) => setPolicyForm({ ...policyForm, name: e.target.value })}
                  placeholder="canary-release"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="policy-type">Type</Label>
                <Select
                  value={policyForm.type}
                  onValueChange={(value) => setPolicyForm({ ...policyForm, type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(POLICY_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        <div className="flex items-center gap-2">
                          {POLICY_TYPE_ICONS[value]}
                          {label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {POLICY_TYPE_DESCRIPTIONS[policyForm.type]}
                </p>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="policy-description">Description</Label>
              <Input
                id="policy-description"
                value={policyForm.description}
                onChange={(e) => setPolicyForm({ ...policyForm, description: e.target.value })}
                placeholder="Route 10% of traffic to canary deployment"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="policy-priority">Priority</Label>
                <Input
                  id="policy-priority"
                  type="number"
                  value={policyForm.priority}
                  onChange={(e) => setPolicyForm({ ...policyForm, priority: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Lower number = higher priority</p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="policy-cluster">Target Cluster</Label>
                <Select
                  value={policyForm.clusterId || "__none__"}
                  onValueChange={(value) => setPolicyForm({ ...policyForm, clusterId: value === "__none__" ? "" : value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select cluster (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {clusters.map(cluster => (
                      <SelectItem key={cluster.id} value={cluster.id}>
                        {cluster.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="policy-conditions">Conditions (JSON)</Label>
              <Textarea
                id="policy-conditions"
                value={policyForm.conditions}
                onChange={(e) => setPolicyForm({ ...policyForm, conditions: e.target.value })}
                rows={4}
                className="font-mono text-sm"
                placeholder='[{"type": "header", "key": "x-canary", "operator": "equals", "value": "true"}]'
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="policy-actions">Actions (JSON)</Label>
              <Textarea
                id="policy-actions"
                value={policyForm.actions}
                onChange={(e) => setPolicyForm({ ...policyForm, actions: e.target.value })}
                rows={4}
                className="font-mono text-sm"
                placeholder='{"type": "route", "weight": 10}'
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPolicyDialogOpen(false)}>Cancel</Button>
            <Button onClick={savePolicy}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete policy?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name}&quot;?
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
    </div>
  );
}
