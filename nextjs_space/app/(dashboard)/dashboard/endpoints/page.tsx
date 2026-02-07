"use client";

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Link2,
  Plus,
  Loader2,
  RefreshCw,
  MoreHorizontal,
  Pencil,
  Trash2,
  Copy,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Activity,
  Clock,
  Globe,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { toast } from 'sonner';

interface Cluster {
  id: string;
  name: string;
  strategy: string;
}

interface Policy {
  id: string;
  name: string;
  type: string;
}

interface Endpoint {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  type: string;
  clusterId: string | null;
  policyId: string | null;
  config: Record<string, unknown>;
  isActive: boolean;
  totalRequests: number;
  totalErrors: number;
  avgLatencyMs: number;
  lastRequestAt: string | null;
  createdAt: string;
  cluster?: Cluster | null;
  policy?: Policy | null;
}

interface EndpointForm {
  id?: string;
  name: string;
  description: string;
  type: string;
  clusterId: string;
  policyId: string;
  isActive: boolean;
}

const ENDPOINT_TYPES = [
  { value: 'LOAD_BALANCE', label: 'Load Balance', description: 'Distribute requests across backends' },
  { value: 'ROUTE', label: 'Route', description: 'Route based on policy rules' },
  { value: 'PROXY', label: 'Proxy', description: 'Proxy requests to backends' },
  { value: 'MOCK', label: 'Mock', description: 'Return mock responses' },
];

export default function EndpointsPage() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint | null>(null);
  const [form, setForm] = useState<EndpointForm>({
    name: '',
    description: '',
    type: 'LOAD_BALANCE',
    clusterId: '__none__',
    policyId: '__none__',
    isActive: true,
  });
  const [saving, setSaving] = useState(false);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router?.replace?.('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session?.user?.id) {
      fetchData();
    }
  }, [session?.user?.id]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [endpointsRes, clustersRes, policiesRes] = await Promise.all([
        fetch('/api/endpoints'),
        fetch(`/api/backends/clusters?orgId=${session?.user?.currentOrgId}`),
        fetch('/api/routing-policies'),
      ]);

      if (endpointsRes.ok) {
        const data = await endpointsRes.json();
        setEndpoints(data);
      }
      if (clustersRes.ok) {
        const data = await clustersRes.json();
        setClusters(data.clusters || []);
      }
      if (policiesRes.ok) {
        const data = await policiesRes.json();
        setPolicies(data.policies || []);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load endpoints');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
    toast.success('Endpoints refreshed');
  };

  const openCreateDialog = () => {
    setSelectedEndpoint(null);
    setForm({
      name: '',
      description: '',
      type: 'LOAD_BALANCE',
      clusterId: '__none__',
      policyId: '__none__',
      isActive: true,
    });
    setDialogOpen(true);
  };

  const openEditDialog = (endpoint: Endpoint) => {
    setSelectedEndpoint(endpoint);
    setForm({
      id: endpoint.id,
      name: endpoint.name,
      description: endpoint.description || '',
      type: endpoint.type,
      clusterId: endpoint.clusterId || '__none__',
      policyId: endpoint.policyId || '__none__',
      isActive: endpoint.isActive,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Name is required');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        clusterId: form.clusterId === '__none__' ? null : form.clusterId,
        policyId: form.policyId === '__none__' ? null : form.policyId,
        orgId: session?.user?.currentOrgId,
      };

      const res = await fetch(
        form.id ? `/api/endpoints/${form.id}` : '/api/endpoints',
        {
          method: form.id ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      if (res.ok) {
        toast.success(form.id ? 'Endpoint updated' : 'Endpoint created');
        setDialogOpen(false);
        fetchData();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to save endpoint');
      }
    } catch (error) {
      console.error('Error saving endpoint:', error);
      toast.error('Failed to save endpoint');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedEndpoint) return;

    try {
      const res = await fetch(`/api/endpoints/${selectedEndpoint.id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        toast.success('Endpoint deleted');
        setDeleteDialogOpen(false);
        setSelectedEndpoint(null);
        fetchData();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to delete endpoint');
      }
    } catch (error) {
      console.error('Error deleting endpoint:', error);
      toast.error('Failed to delete endpoint');
    }
  };

  const toggleActive = async (endpoint: Endpoint) => {
    try {
      const res = await fetch(`/api/endpoints/${endpoint.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !endpoint.isActive }),
      });

      if (res.ok) {
        toast.success(`Endpoint ${endpoint.isActive ? 'disabled' : 'enabled'}`);
        fetchData();
      }
    } catch (error) {
      console.error('Error toggling endpoint:', error);
      toast.error('Failed to update endpoint');
    }
  };

  const copyEndpointUrl = (slug: string) => {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const url = `${baseUrl}/e/${slug}`;
    navigator.clipboard.writeText(url);
    setCopiedSlug(slug);
    toast.success('URL copied to clipboard');
    setTimeout(() => setCopiedSlug(null), 2000);
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const getTypeColor = (type: string): string => {
    switch (type) {
      case 'LOAD_BALANCE': return 'bg-blue-500';
      case 'ROUTE': return 'bg-purple-500';
      case 'PROXY': return 'bg-green-500';
      case 'MOCK': return 'bg-yellow-500';
      default: return 'bg-gray-500';
    }
  };

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const activeEndpoints = endpoints.filter(e => e.isActive).length;
  const totalRequests = endpoints.reduce((sum, e) => sum + e.totalRequests, 0);
  const totalErrors = endpoints.reduce((sum, e) => sum + e.totalErrors, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Link2 className="h-8 w-8" />
            Traffic Endpoints
          </h1>
          <p className="text-muted-foreground">
            Create and manage ingestion URLs for traffic distribution
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            Create Endpoint
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Endpoints</CardTitle>
            <Link2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{endpoints.length}</div>
            <p className="text-xs text-muted-foreground">{activeEndpoints} active</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Requests</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(totalRequests)}</div>
            <p className="text-xs text-muted-foreground">Across all endpoints</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Error Rate</CardTitle>
            <XCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalRequests > 0 ? ((totalErrors / totalRequests) * 100).toFixed(2) : '0.00'}%
            </div>
            <p className="text-xs text-muted-foreground">{formatNumber(totalErrors)} errors</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Latency</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {endpoints.length > 0
                ? (endpoints.reduce((sum, e) => sum + e.avgLatencyMs, 0) / endpoints.length).toFixed(0)
                : '0'}
              ms
            </div>
            <p className="text-xs text-muted-foreground">Average response time</p>
          </CardContent>
        </Card>
      </div>

      {/* Endpoints Table */}
      <Card>
        <CardHeader>
          <CardTitle>Endpoints</CardTitle>
          <CardDescription>
            Each endpoint has a unique URL that distributes traffic based on its configuration
          </CardDescription>
        </CardHeader>
        <CardContent>
          {endpoints.length === 0 ? (
            <div className="text-center py-12">
              <Globe className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No endpoints yet</h3>
              <p className="text-muted-foreground mb-4">
                Create your first endpoint to start distributing traffic
              </p>
              <Button onClick={openCreateDialog}>
                <Plus className="h-4 w-4 mr-2" />
                Create Endpoint
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
                  <TableHead className="text-right">Errors</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpoints.map((endpoint) => (
                  <TableRow key={endpoint.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{endpoint.name}</div>
                        {endpoint.description && (
                          <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                            {endpoint.description}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                          /e/{endpoint.slug}
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => copyEndpointUrl(endpoint.slug)}
                        >
                          {copiedSlug === endpoint.slug ? (
                            <CheckCircle2 className="h-3 w-3 text-green-500" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                        <a
                          href={`/e/${endpoint.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`${getTypeColor(endpoint.type)} text-white`}>
                        {endpoint.type.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {endpoint.cluster ? (
                        <div className="text-sm">
                          <span className="font-medium">{endpoint.cluster.name}</span>
                          <span className="text-xs text-muted-foreground ml-1">({endpoint.cluster.strategy})</span>
                        </div>
                      ) : endpoint.policy ? (
                        <div className="text-sm">
                          <span className="font-medium">{endpoint.policy.name}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatNumber(endpoint.totalRequests)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      <span className={endpoint.totalErrors > 0 ? 'text-red-500' : ''}>
                        {formatNumber(endpoint.totalErrors)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={endpoint.isActive}
                        onCheckedChange={() => toggleActive(endpoint)}
                      />
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditDialog(endpoint)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedEndpoint(endpoint);
                              setDeleteDialogOpen(true);
                            }}
                            className="text-red-600"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedEndpoint ? 'Edit Endpoint' : 'Create Endpoint'}
            </DialogTitle>
            <DialogDescription>
              {selectedEndpoint
                ? 'Update the endpoint configuration'
                : 'Create a new traffic ingestion endpoint'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="My API Endpoint"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional description..."
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <Select
                value={form.type}
                onValueChange={(value) => setForm({ ...form, type: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENDPOINT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <div>
                        <div>{t.label}</div>
                        <div className="text-xs text-muted-foreground">{t.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.type !== 'MOCK' && (
              <div className="space-y-2">
                <Label htmlFor="cluster">Backend Cluster</Label>
                <Select
                  value={form.clusterId}
                  onValueChange={(value) => setForm({ ...form, clusterId: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select cluster" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {clusters.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({c.strategy})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {form.type === 'ROUTE' && (
              <div className="space-y-2">
                <Label htmlFor="policy">Routing Policy</Label>
                <Select
                  value={form.policyId}
                  onValueChange={(value) => setForm({ ...form, policyId: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select policy" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {policies.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} ({p.type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-center justify-between">
              <Label htmlFor="isActive">Active</Label>
              <Switch
                id="isActive"
                checked={form.isActive}
                onCheckedChange={(checked) => setForm({ ...form, isActive: checked })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {selectedEndpoint ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Endpoint</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{selectedEndpoint?.name}&quot;? This will permanently
              remove the endpoint URL and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
