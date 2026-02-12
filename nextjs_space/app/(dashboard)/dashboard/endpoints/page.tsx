"use client";

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback, useMemo } from 'react';
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
  Globe,
  Settings,
  Shield,
  Zap,
  ArrowRightLeft,
  Search,
} from 'lucide-react';
import { DataTablePagination } from '@/components/ui/data-table-pagination';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
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
  customDomain: string | null;
  proxyMode: string;
  sessionAffinity: string;
  affinityCookieName: string;
  affinityHeaderName: string | null;
  affinityTtlSeconds: number;
  connectTimeout: number;
  readTimeout: number;
  writeTimeout: number;
  rewriteHostHeader: boolean;
  rewriteLocationHeader: boolean;
  rewriteCookieDomain: boolean;
  rewriteCorsHeaders: boolean;
  preserveHostHeader: boolean;
  stripPathPrefix: string | null;
  addPathPrefix: string | null;
  websocketEnabled: boolean;
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
  customDomain: string;
  proxyMode: string;
  sessionAffinity: string;
  affinityCookieName: string;
  affinityHeaderName: string;
  affinityTtlSeconds: number;
  connectTimeout: number;
  readTimeout: number;
  writeTimeout: number;
  rewriteHostHeader: boolean;
  rewriteLocationHeader: boolean;
  rewriteCookieDomain: boolean;
  rewriteCorsHeaders: boolean;
  preserveHostHeader: boolean;
  stripPathPrefix: string;
  addPathPrefix: string;
  websocketEnabled: boolean;
  isActive: boolean;
}

const ENDPOINT_TYPES = [
  { value: 'LOAD_BALANCE', label: 'Load Balance', description: 'Distribute requests across backends' },
  { value: 'ROUTE', label: 'Route', description: 'Route based on policy rules' },
  { value: 'PROXY', label: 'Proxy', description: 'Proxy requests to backends' },
  { value: 'MOCK', label: 'Mock', description: 'Return mock responses' },
];

const PROXY_MODES = [
  { value: 'REVERSE_PROXY', label: 'Reverse Proxy', description: 'Full URL masking with header rewriting' },
  { value: 'SMART', label: 'Smart', description: 'Automatically decide based on request/response' },
  { value: 'PASSTHROUGH', label: 'Passthrough', description: 'Forward requests without URL rewriting' },
  { value: 'REDIRECT', label: 'Redirect', description: 'HTTP redirect to backend URL (exposes backend)' },
];

const SESSION_AFFINITY_MODES = [
  { value: 'NONE', label: 'None', description: 'No session affinity' },
  { value: 'COOKIE', label: 'Cookie', description: 'Use cookie to maintain backend assignment' },
  { value: 'IP_HASH', label: 'IP Hash', description: 'Hash client IP for consistent routing' },
  { value: 'HEADER', label: 'Header', description: 'Use specific header value for routing' },
];

const DEFAULT_FORM: EndpointForm = {
  name: '',
  description: '',
  type: 'LOAD_BALANCE',
  clusterId: '__none__',
  policyId: '__none__',
  customDomain: '',
  proxyMode: 'REVERSE_PROXY',
  sessionAffinity: 'NONE',
  affinityCookieName: '_tcp_affinity',
  affinityHeaderName: '',
  affinityTtlSeconds: 3600,
  connectTimeout: 5000,
  readTimeout: 30000,
  writeTimeout: 30000,
  rewriteHostHeader: true,
  rewriteLocationHeader: true,
  rewriteCookieDomain: true,
  rewriteCorsHeaders: true,
  preserveHostHeader: false,
  stripPathPrefix: '',
  addPathPrefix: '',
  websocketEnabled: true,
  isActive: true,
};

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
  const [form, setForm] = useState<EndpointForm>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('basic');
  
  // Pagination state
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router?.replace?.('/login');
    }
  }, [status, router]);
  
  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1); // Reset to first page on search
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (session?.user?.id) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, page, limit, debouncedSearch]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const searchParam = debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : '';
      const [endpointsRes, clustersRes, policiesRes] = await Promise.all([
        fetch(`/api/endpoints?page=${page}&limit=${limit}${searchParam}`),
        fetch(`/api/backends/clusters?orgId=${session?.user?.currentOrgId}`),
        fetch('/api/routing-policies'),
      ]);

      if (endpointsRes.ok) {
        const data = await endpointsRes.json();
        setEndpoints(data.endpoints || []);
        if (data.pagination) {
          setTotal(data.pagination.total);
          setTotalPages(data.pagination.totalPages);
        }
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
  
  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };
  
  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    setPage(1);
  };

  const openCreateDialog = () => {
    setSelectedEndpoint(null);
    setForm(DEFAULT_FORM);
    setActiveTab('basic');
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
      customDomain: endpoint.customDomain || '',
      proxyMode: endpoint.proxyMode,
      sessionAffinity: endpoint.sessionAffinity,
      affinityCookieName: endpoint.affinityCookieName,
      affinityHeaderName: endpoint.affinityHeaderName || '',
      affinityTtlSeconds: endpoint.affinityTtlSeconds,
      connectTimeout: endpoint.connectTimeout,
      readTimeout: endpoint.readTimeout,
      writeTimeout: endpoint.writeTimeout,
      rewriteHostHeader: endpoint.rewriteHostHeader,
      rewriteLocationHeader: endpoint.rewriteLocationHeader,
      rewriteCookieDomain: endpoint.rewriteCookieDomain,
      rewriteCorsHeaders: endpoint.rewriteCorsHeaders,
      preserveHostHeader: endpoint.preserveHostHeader,
      stripPathPrefix: endpoint.stripPathPrefix || '',
      addPathPrefix: endpoint.addPathPrefix || '',
      websocketEnabled: endpoint.websocketEnabled,
      isActive: endpoint.isActive,
    });
    setActiveTab('basic');
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
        customDomain: form.customDomain.trim() || null,
        affinityHeaderName: form.affinityHeaderName.trim() || null,
        stripPathPrefix: form.stripPathPrefix.trim() || null,
        addPathPrefix: form.addPathPrefix.trim() || null,
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

  const copyEndpointUrl = (slug: string, customDomain?: string | null) => {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const url = customDomain ? `https://${customDomain}` : `${baseUrl}/e/${slug}`;
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

  const getProxyModeColor = (mode: string): string => {
    switch (mode) {
      case 'REVERSE_PROXY': return 'bg-emerald-500';
      case 'SMART': return 'bg-violet-500';
      case 'PASSTHROUGH': return 'bg-amber-500';
      case 'REDIRECT': return 'bg-rose-500';
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
            Create and manage ingestion URLs with reverse proxy capabilities
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            New Endpoint
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Globe className="h-4 w-4" />
              <span className="text-sm">Active Endpoints</span>
            </div>
            <div className="text-2xl font-bold">
              {activeEndpoints} / {endpoints.length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <ArrowRightLeft className="h-4 w-4" />
              <span className="text-sm">Total Requests</span>
            </div>
            <div className="text-2xl font-bold">{formatNumber(totalRequests)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Shield className="h-4 w-4" />
              <span className="text-sm">Total Errors</span>
            </div>
            <div className={`text-2xl font-bold ${totalErrors > 0 ? 'text-red-500' : ''}`}>
              {formatNumber(totalErrors)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Zap className="h-4 w-4" />
              <span className="text-sm">Avg Latency</span>
            </div>
            <div className="text-2xl font-bold">
              {endpoints.length > 0
                ? (endpoints.reduce((sum, e) => sum + e.avgLatencyMs, 0) / endpoints.length).toFixed(0)
                : '0'}
              ms
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Endpoints Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle>Endpoints</CardTitle>
              <CardDescription>
                Each endpoint provides a unique URL with configurable proxy behavior and session affinity
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search endpoints..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Empty state - no endpoints and no search */}
          {endpoints.length === 0 && !debouncedSearch && (
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
          )}
          
          {/* No results for search */}
          {endpoints.length === 0 && debouncedSearch && (
            <div className="text-center py-12">
              <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No endpoints found</h3>
              <p className="text-muted-foreground">
                No endpoints match &quot;{debouncedSearch}&quot;
              </p>
            </div>
          )}
          
          {/* Endpoints table */}
          {endpoints.length > 0 && (
            <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Proxy Mode</TableHead>
                  <TableHead>Affinity</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
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
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                            /e/{endpoint.slug}
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => copyEndpointUrl(endpoint.slug, endpoint.customDomain)}
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
                        {endpoint.customDomain && (
                          <div className="text-xs text-emerald-600 flex items-center gap-1">
                            <Globe className="h-3 w-3" />
                            {endpoint.customDomain}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`${getTypeColor(endpoint.type)} text-white`}>
                        {endpoint.type.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`${getProxyModeColor(endpoint.proxyMode)} text-white border-0`}>
                        {endpoint.proxyMode.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {endpoint.sessionAffinity === 'NONE' ? '—' : endpoint.sessionAffinity}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatNumber(endpoint.totalRequests)}
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
            
            {/* Pagination */}
            {totalPages > 0 && (
              <DataTablePagination
                page={page}
                totalPages={totalPages}
                total={total}
                limit={limit}
                onPageChange={handlePageChange}
                onLimitChange={handleLimitChange}
              />
            )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>
              {selectedEndpoint ? 'Edit Endpoint' : 'Create Endpoint'}
            </DialogTitle>
            <DialogDescription>
              Configure traffic routing, proxy behavior, and session management
            </DialogDescription>
          </DialogHeader>
          
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="basic">Basic</TabsTrigger>
              <TabsTrigger value="proxy">Proxy</TabsTrigger>
              <TabsTrigger value="affinity">Affinity</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            </TabsList>
            
            <ScrollArea className="h-[400px] pr-4">
              {/* Basic Tab */}
              <TabsContent value="basic" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name *</Label>
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
                  <Label htmlFor="type">Endpoint Type</Label>
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
                            <div className="font-medium">{t.label}</div>
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
                <div className="space-y-2">
                  <Label htmlFor="customDomain">Custom Domain (CNAME)</Label>
                  <Input
                    id="customDomain"
                    value={form.customDomain}
                    onChange={(e) => setForm({ ...form, customDomain: e.target.value })}
                    placeholder="api.mycompany.com"
                  />
                  <p className="text-xs text-muted-foreground">
                    Point a CNAME record to this server to use a custom domain
                  </p>
                </div>
                <div className="flex items-center justify-between pt-2">
                  <Label htmlFor="isActive">Active</Label>
                  <Switch
                    id="isActive"
                    checked={form.isActive}
                    onCheckedChange={(checked) => setForm({ ...form, isActive: checked })}
                  />
                </div>
              </TabsContent>

              {/* Proxy Tab */}
              <TabsContent value="proxy" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="proxyMode">Proxy Mode</Label>
                  <Select
                    value={form.proxyMode}
                    onValueChange={(value) => setForm({ ...form, proxyMode: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROXY_MODES.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          <div>
                            <div className="font-medium">{m.label}</div>
                            <div className="text-xs text-muted-foreground">{m.description}</div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Separator />
                <h4 className="text-sm font-medium">Header Rewriting</h4>
                
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Rewrite Location Headers</Label>
                    <p className="text-xs text-muted-foreground">Rewrite redirect URLs to proxy domain</p>
                  </div>
                  <Switch
                    checked={form.rewriteLocationHeader}
                    onCheckedChange={(checked) => setForm({ ...form, rewriteLocationHeader: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Rewrite Cookie Domains</Label>
                    <p className="text-xs text-muted-foreground">Fix Set-Cookie domain attributes</p>
                  </div>
                  <Switch
                    checked={form.rewriteCookieDomain}
                    onCheckedChange={(checked) => setForm({ ...form, rewriteCookieDomain: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Rewrite CORS Headers</Label>
                    <p className="text-xs text-muted-foreground">Fix Access-Control-Allow-Origin</p>
                  </div>
                  <Switch
                    checked={form.rewriteCorsHeaders}
                    onCheckedChange={(checked) => setForm({ ...form, rewriteCorsHeaders: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Preserve Host Header</Label>
                    <p className="text-xs text-muted-foreground">Keep original Host header (don&apos;t rewrite)</p>
                  </div>
                  <Switch
                    checked={form.preserveHostHeader}
                    onCheckedChange={(checked) => setForm({ ...form, preserveHostHeader: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>WebSocket Support</Label>
                    <p className="text-xs text-muted-foreground">Enable WebSocket upgrade handling</p>
                  </div>
                  <Switch
                    checked={form.websocketEnabled}
                    onCheckedChange={(checked) => setForm({ ...form, websocketEnabled: checked })}
                  />
                </div>
              </TabsContent>

              {/* Affinity Tab */}
              <TabsContent value="affinity" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="sessionAffinity">Session Affinity Mode</Label>
                  <Select
                    value={form.sessionAffinity}
                    onValueChange={(value) => setForm({ ...form, sessionAffinity: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SESSION_AFFINITY_MODES.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          <div>
                            <div className="font-medium">{m.label}</div>
                            <div className="text-xs text-muted-foreground">{m.description}</div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Session affinity ensures a client sticks to the same backend for security, sessions, or WebSocket connections
                  </p>
                </div>

                {form.sessionAffinity === 'COOKIE' && (
                  <div className="space-y-2">
                    <Label htmlFor="affinityCookieName">Affinity Cookie Name</Label>
                    <Input
                      id="affinityCookieName"
                      value={form.affinityCookieName}
                      onChange={(e) => setForm({ ...form, affinityCookieName: e.target.value })}
                      placeholder="_tcp_affinity"
                    />
                  </div>
                )}

                {form.sessionAffinity === 'HEADER' && (
                  <div className="space-y-2">
                    <Label htmlFor="affinityHeaderName">Affinity Header Name</Label>
                    <Input
                      id="affinityHeaderName"
                      value={form.affinityHeaderName}
                      onChange={(e) => setForm({ ...form, affinityHeaderName: e.target.value })}
                      placeholder="X-User-ID"
                    />
                  </div>
                )}

                {form.sessionAffinity !== 'NONE' && (
                  <div className="space-y-2">
                    <Label htmlFor="affinityTtl">Affinity TTL (seconds)</Label>
                    <Input
                      id="affinityTtl"
                      type="number"
                      value={form.affinityTtlSeconds}
                      onChange={(e) => setForm({ ...form, affinityTtlSeconds: parseInt(e.target.value) || 3600 })}
                      placeholder="3600"
                    />
                    <p className="text-xs text-muted-foreground">
                      How long the client-to-backend mapping is maintained
                    </p>
                  </div>
                )}
              </TabsContent>

              {/* Advanced Tab */}
              <TabsContent value="advanced" className="space-y-4 mt-4">
                <h4 className="text-sm font-medium">Timeouts (milliseconds)</h4>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="connectTimeout">Connect</Label>
                    <Input
                      id="connectTimeout"
                      type="number"
                      value={form.connectTimeout}
                      onChange={(e) => setForm({ ...form, connectTimeout: parseInt(e.target.value) || 5000 })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="readTimeout">Read</Label>
                    <Input
                      id="readTimeout"
                      type="number"
                      value={form.readTimeout}
                      onChange={(e) => setForm({ ...form, readTimeout: parseInt(e.target.value) || 30000 })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="writeTimeout">Write</Label>
                    <Input
                      id="writeTimeout"
                      type="number"
                      value={form.writeTimeout}
                      onChange={(e) => setForm({ ...form, writeTimeout: parseInt(e.target.value) || 30000 })}
                    />
                  </div>
                </div>

                <Separator />
                <h4 className="text-sm font-medium">Path Manipulation</h4>
                
                <div className="space-y-2">
                  <Label htmlFor="stripPathPrefix">Strip Path Prefix</Label>
                  <Input
                    id="stripPathPrefix"
                    value={form.stripPathPrefix}
                    onChange={(e) => setForm({ ...form, stripPathPrefix: e.target.value })}
                    placeholder="/api/v1"
                  />
                  <p className="text-xs text-muted-foreground">
                    Remove this prefix from the path before forwarding to backend
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="addPathPrefix">Add Path Prefix</Label>
                  <Input
                    id="addPathPrefix"
                    value={form.addPathPrefix}
                    onChange={(e) => setForm({ ...form, addPathPrefix: e.target.value })}
                    placeholder="/backend"
                  />
                  <p className="text-xs text-muted-foreground">
                    Add this prefix to the path when forwarding to backend
                  </p>
                </div>
              </TabsContent>
            </ScrollArea>
          </Tabs>

          <DialogFooter className="mt-4">
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
