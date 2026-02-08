'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  Network,
  Server,
  Globe,
  Shield,
  Activity,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Plus,
  Settings,
  Link,
  Unlink,
  Copy,
  Eye,
  EyeOff,
  Database,
  Zap,
  Clock,
  BarChart3,
} from 'lucide-react';

interface FederationConfig {
  nodeId: string;
  nodeName: string;
  nodeUrl: string;
  role: 'PRINCIPLE' | 'PARTNER' | 'STANDALONE';
  principleNodeId?: string;
  principleUrl?: string;
  isActive: boolean;
  lastHeartbeat: string | null;
}

interface FederationPeer {
  nodeId: string;
  nodeName: string;
  nodeUrl: string;
  status: 'HEALTHY' | 'UNHEALTHY' | 'UNKNOWN';
  lastHeartbeat: string | null;
  latencyMs?: number;
  currentLoad?: number;
  isLocal?: boolean;
}

interface FederationPartner {
  id: string;
  nodeId: string;
  nodeName: string;
  nodeUrl: string;
  isActive: boolean;
  status: string;
  lastHeartbeat: string | null;
  lastSyncAt: string | null;
  failedSyncCount: number;
}

interface FederationRequest {
  id: string;
  type: 'INCOMING' | 'OUTGOING';
  requesterNodeId: string;
  requesterNodeName: string;
  requesterNodeUrl: string;
  status: string;
  message?: string;
  expiresAt: string;
  createdAt: string;
}

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
  memoryUsageMB: number;
}

interface FederationStats {
  nodeId: string;
  role: string;
  peerCount: number;
  healthyPeers: number;
  totalForwarded: number;
  totalReceived: number;
  avgLatencyToPeers: number;
}

interface StatsData {
  federation: FederationStats | null;
  peers: FederationPeer[];
  cache: Record<string, CacheStats>;
  metricsQueue: {
    endpointQueueSize: number;
    trafficQueueSize: number;
    totalFlushed: number;
    lastFlushAt: number | null;
    flushErrors: number;
  };
  system: {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
    externalMB: number;
    uptime: number;
  };
  recentSyncs: Array<{
    id: string;
    partnerName?: string;
    direction: string;
    syncType: string;
    status: string;
    durationMs?: number;
    startedAt: string;
  }>;
}

export default function FederationPage() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [config, setConfig] = useState<FederationConfig | null>(null);
  const [peers, setPeers] = useState<FederationPeer[]>([]);
  const [partners, setPartners] = useState<FederationPartner[]>([]);
  const [requests, setRequests] = useState<FederationRequest[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);

  // Dialog states
  const [setupDialogOpen, setSetupDialogOpen] = useState(false);
  const [addPeerDialogOpen, setAddPeerDialogOpen] = useState(false);
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<FederationRequest | null>(null);

  // Form states
  const [setupForm, setSetupForm] = useState<{
    nodeName: string;
    nodeUrl: string;
    role: 'PRINCIPLE' | 'PARTNER' | 'STANDALONE';
  }>({
    nodeName: '',
    nodeUrl: '',
    role: 'STANDALONE',
  });
  const [peerForm, setPeerForm] = useState({
    targetNodeUrl: '',
    message: '',
  });

  const [secretKey, setSecretKey] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    } else if (status === 'authenticated') {
      fetchFederationData();
    }
  }, [status, router]);

  const fetchFederationData = async () => {
    try {
      setLoading(true);

      // Fetch main federation config
      const configRes = await fetch('/api/federation');
      const configData = await configRes.json();

      setConfigured(configData.configured);
      setConfig(configData.config || null);
      setPeers(configData.peers || []);
      setPartners(configData.partners || []);
      setSecretKey(configData.config?.secretKey || '');

      // Fetch peers and requests
      if (configData.configured) {
        const peersRes = await fetch('/api/federation/peers');
        const peersData = await peersRes.json();
        setPartners(peersData.partners || []);
        setRequests(peersData.pendingRequests || []);

        // Fetch stats
        const statsRes = await fetch('/api/federation/stats');
        const statsData = await statsRes.json();
        setStats(statsData);
        if (statsData.peers) {
          setPeers(statsData.peers);
        }
      }
    } catch (error) {
      console.error('Error fetching federation data:', error);
      toast.error('Failed to load federation data');
    } finally {
      setLoading(false);
    }
  };

  const handleSetupFederation = async () => {
    try {
      const res = await fetch('/api/federation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(setupForm),
      });

      const data = await res.json();

      if (res.ok) {
        toast.success('Federation configured successfully');
        setSetupDialogOpen(false);
        setSecretKey(data.config?.secretKey || '');
        fetchFederationData();
      } else {
        toast.error(data.error || 'Failed to configure federation');
      }
    } catch (error) {
      toast.error('Failed to configure federation');
    }
  };

  const handleAddPeer = async () => {
    try {
      const res = await fetch('/api/federation/peers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(peerForm),
      });

      const data = await res.json();

      if (res.ok) {
        toast.success(data.message || 'Partnership request sent');
        setAddPeerDialogOpen(false);
        setPeerForm({ targetNodeUrl: '', message: '' });
        fetchFederationData();
      } else {
        toast.error(data.error || 'Failed to send request');
      }
    } catch (error) {
      toast.error('Failed to send partnership request');
    }
  };

  const handleRequestAction = async (requestId: string, action: 'accept' | 'reject') => {
    try {
      const res = await fetch(`/api/federation/requests/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      const data = await res.json();

      if (res.ok) {
        toast.success(data.message || `Request ${action}ed`);
        setRequestDialogOpen(false);
        fetchFederationData();
      } else {
        toast.error(data.error || `Failed to ${action} request`);
      }
    } catch (error) {
      toast.error(`Failed to ${action} request`);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'PRINCIPLE':
        return <Badge className="bg-purple-500">Principle</Badge>;
      case 'PARTNER':
        return <Badge className="bg-blue-500">Partner</Badge>;
      default:
        return <Badge variant="secondary">Standalone</Badge>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'HEALTHY':
        return <Badge className="bg-green-500">Healthy</Badge>;
      case 'UNHEALTHY':
        return <Badge className="bg-red-500">Unhealthy</Badge>;
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Federation</h1>
          <p className="text-muted-foreground">
            Manage distributed Traffic Control Plane clustering
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchFederationData}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          {!configured && (
            <Button onClick={() => setSetupDialogOpen(true)}>
              <Settings className="h-4 w-4 mr-2" />
              Configure Federation
            </Button>
          )}
          {configured && config?.role === 'PRINCIPLE' && (
            <Button onClick={() => setAddPeerDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Partner
            </Button>
          )}
        </div>
      </div>

      {!configured ? (
        // Not Configured State
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Network className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">Federation Not Configured</h3>
            <p className="text-muted-foreground text-center max-w-md mb-6">
              Configure this node to participate in a federated Traffic Control Plane cluster.
              Enable distributed routing, load balancing, and failover across multiple instances.
            </p>
            <Button onClick={() => setSetupDialogOpen(true)}>
              <Settings className="h-4 w-4 mr-2" />
              Configure Federation
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Node Info & Stats */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Node Role</CardTitle>
                <Shield className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {getRoleBadge(config?.role || 'STANDALONE')}
                <p className="text-xs text-muted-foreground mt-2">
                  {config?.nodeName}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Cluster Peers</CardTitle>
                <Server className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stats?.federation?.healthyPeers || 0}/{stats?.federation?.peerCount || peers.length}
                </div>
                <p className="text-xs text-muted-foreground">healthy / total</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Requests Forwarded</CardTitle>
                <Zap className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stats?.federation?.totalForwarded || 0}
                </div>
                <p className="text-xs text-muted-foreground">
                  received: {stats?.federation?.totalReceived || 0}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">System Uptime</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stats?.system ? formatUptime(stats.system.uptime) : '-'}
                </div>
                <p className="text-xs text-muted-foreground">
                  Memory: {stats?.system?.heapUsedMB || 0}MB / {stats?.system?.heapTotalMB || 0}MB
                </p>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="peers" className="space-y-4">
            <TabsList>
              <TabsTrigger value="peers">Cluster Peers</TabsTrigger>
              <TabsTrigger value="requests">
                Requests
                {requests.length > 0 && (
                  <Badge variant="destructive" className="ml-2">
                    {requests.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="performance">Performance</TabsTrigger>
              <TabsTrigger value="config">Configuration</TabsTrigger>
            </TabsList>

            {/* Peers Tab */}
            <TabsContent value="peers" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Cluster Members</CardTitle>
                  <CardDescription>
                    Active nodes in the federation cluster with health status
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {peers.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No peers in cluster yet
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Node</TableHead>
                          <TableHead>URL</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Latency</TableHead>
                          <TableHead>Load</TableHead>
                          <TableHead>Last Heartbeat</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {peers.map((peer) => (
                          <TableRow key={peer.nodeId}>
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                {peer.nodeName}
                                {peer.isLocal && (
                                  <Badge variant="outline" className="text-xs">
                                    This Node
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {peer.nodeUrl}
                            </TableCell>
                            <TableCell>{getStatusBadge(peer.status)}</TableCell>
                            <TableCell>
                              {peer.latencyMs ? `${peer.latencyMs}ms` : '-'}
                            </TableCell>
                            <TableCell>
                              {peer.currentLoad !== undefined ? (
                                <div className="flex items-center gap-2">
                                  <Progress value={peer.currentLoad} className="w-16 h-2" />
                                  <span className="text-xs">{peer.currentLoad}%</span>
                                </div>
                              ) : (
                                '-'
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {peer.lastHeartbeat
                                ? new Date(peer.lastHeartbeat).toLocaleString()
                                : 'Never'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              {/* Partners (if Principle) */}
              {config?.role === 'PRINCIPLE' && partners.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Partner Nodes</CardTitle>
                    <CardDescription>
                      Nodes that receive configuration sync from this Principle
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Partner</TableHead>
                          <TableHead>Sync Status</TableHead>
                          <TableHead>Last Sync</TableHead>
                          <TableHead>Failed Syncs</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {partners.map((partner) => (
                          <TableRow key={partner.id}>
                            <TableCell>
                              <div>
                                <p className="font-medium">{partner.nodeName}</p>
                                <p className="text-xs text-muted-foreground font-mono">
                                  {partner.nodeUrl}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  partner.status === 'COMPLETED'
                                    ? 'default'
                                    : partner.status === 'FAILED'
                                    ? 'destructive'
                                    : 'secondary'
                                }
                              >
                                {partner.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs">
                              {partner.lastSyncAt
                                ? new Date(partner.lastSyncAt).toLocaleString()
                                : 'Never'}
                            </TableCell>
                            <TableCell>
                              {partner.failedSyncCount > 0 ? (
                                <Badge variant="destructive">
                                  {partner.failedSyncCount}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">0</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Button variant="ghost" size="sm">
                                <Unlink className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Requests Tab */}
            <TabsContent value="requests" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Partnership Requests</CardTitle>
                  <CardDescription>
                    Incoming and outgoing partnership requests
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {requests.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No pending requests
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Type</TableHead>
                          <TableHead>From/To</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Expires</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {requests.map((req) => (
                          <TableRow key={req.id}>
                            <TableCell>
                              <Badge
                                variant={req.type === 'INCOMING' ? 'default' : 'outline'}
                              >
                                {req.type}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div>
                                <p className="font-medium">{req.requesterNodeName}</p>
                                <p className="text-xs text-muted-foreground font-mono">
                                  {req.requesterNodeUrl}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">{req.status}</Badge>
                            </TableCell>
                            <TableCell className="text-xs">
                              {new Date(req.expiresAt).toLocaleString()}
                            </TableCell>
                            <TableCell>
                              {req.status === 'PENDING' && req.type === 'INCOMING' && (
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    onClick={() => handleRequestAction(req.id, 'accept')}
                                  >
                                    Accept
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => handleRequestAction(req.id, 'reject')}
                                  >
                                    Reject
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Performance Tab */}
            <TabsContent value="performance" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                {/* Cache Stats */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Database className="h-5 w-5" />
                      Cache Statistics
                    </CardTitle>
                    <CardDescription>
                      In-memory cache performance metrics
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {stats?.cache ? (
                      <div className="space-y-4">
                        {Object.entries(stats.cache).map(([name, cacheStats]) => (
                          <div key={name} className="space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="font-medium capitalize">{name}</span>
                              <Badge variant="outline">
                                {(cacheStats.hitRate * 100).toFixed(1)}% hit rate
                              </Badge>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-sm">
                              <div>
                                <p className="text-muted-foreground">Hits</p>
                                <p className="font-mono">{cacheStats.hits}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">Misses</p>
                                <p className="font-mono">{cacheStats.misses}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">Size</p>
                                <p className="font-mono">{cacheStats.size}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">No cache data available</p>
                    )}
                  </CardContent>
                </Card>

                {/* Metrics Queue */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="h-5 w-5" />
                      Metrics Queue
                    </CardTitle>
                    <CardDescription>
                      Async metrics batching status
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {stats?.metricsQueue ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-muted-foreground text-sm">Endpoint Queue</p>
                            <p className="text-2xl font-bold">
                              {stats.metricsQueue.endpointQueueSize}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-sm">Traffic Queue</p>
                            <p className="text-2xl font-bold">
                              {stats.metricsQueue.trafficQueueSize}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-sm">Total Flushed</p>
                            <p className="text-2xl font-bold">
                              {stats.metricsQueue.totalFlushed}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-sm">Flush Errors</p>
                            <p className="text-2xl font-bold">
                              {stats.metricsQueue.flushErrors}
                            </p>
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Last flush:{' '}
                          {stats.metricsQueue.lastFlushAt
                            ? new Date(stats.metricsQueue.lastFlushAt).toLocaleString()
                            : 'Never'}
                        </div>
                      </div>
                    ) : (
                      <p className="text-muted-foreground">No queue data available</p>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Memory Usage */}
              {stats?.system && (
                <Card>
                  <CardHeader>
                    <CardTitle>System Resources</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div>
                        <div className="flex justify-between mb-2">
                          <span>Heap Memory</span>
                          <span>
                            {stats.system.heapUsedMB}MB / {stats.system.heapTotalMB}MB
                          </span>
                        </div>
                        <Progress
                          value={
                            (stats.system.heapUsedMB / stats.system.heapTotalMB) * 100
                          }
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">RSS Memory</p>
                          <p className="font-mono">{stats.system.rssMB}MB</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">External</p>
                          <p className="font-mono">{stats.system.externalMB}MB</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Uptime</p>
                          <p className="font-mono">{formatUptime(stats.system.uptime)}</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Configuration Tab */}
            <TabsContent value="config" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Node Configuration</CardTitle>
                  <CardDescription>
                    This node&apos;s federation identity and settings
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-muted-foreground">Node ID</Label>
                      <div className="flex items-center gap-2">
                        <code className="bg-muted px-2 py-1 rounded text-sm">
                          {config?.nodeId}
                        </code>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => copyToClipboard(config?.nodeId || '')}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Node Name</Label>
                      <p className="font-medium">{config?.nodeName}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Node URL</Label>
                      <code className="bg-muted px-2 py-1 rounded text-sm block">
                        {config?.nodeUrl}
                      </code>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Role</Label>
                      <div>{getRoleBadge(config?.role || 'STANDALONE')}</div>
                    </div>
                  </div>

                  <div className="border-t pt-4">
                    <Label className="text-muted-foreground">Secret Key</Label>
                    <p className="text-xs text-muted-foreground mb-2">
                      Share this with partners to establish federation connections
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="bg-muted px-2 py-1 rounded text-sm flex-1 font-mono">
                        {showSecretKey ? secretKey : '••••••••••••••••••••••••'}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowSecretKey(!showSecretKey)}
                      >
                        {showSecretKey ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => copyToClipboard(secretKey)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {config?.role === 'PARTNER' && config.principleUrl && (
                    <div className="border-t pt-4">
                      <Label className="text-muted-foreground">Principle Node</Label>
                      <code className="bg-muted px-2 py-1 rounded text-sm block mt-1">
                        {config.principleUrl}
                      </code>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* Setup Dialog */}
      <Dialog open={setupDialogOpen} onOpenChange={setSetupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configure Federation</DialogTitle>
            <DialogDescription>
              Set up this node to participate in a federated cluster
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Node Name</Label>
              <Input
                placeholder="e.g., tcp-us-east-1"
                value={setupForm.nodeName}
                onChange={(e) =>
                  setSetupForm({ ...setupForm, nodeName: e.target.value })
                }
              />
            </div>
            <div>
              <Label>Node URL</Label>
              <Input
                placeholder="https://tcp.example.com"
                value={setupForm.nodeUrl}
                onChange={(e) =>
                  setSetupForm({ ...setupForm, nodeUrl: e.target.value })
                }
              />
              <p className="text-xs text-muted-foreground mt-1">
                Public URL where this node can be reached by peers
              </p>
            </div>
            <div>
              <Label>Role</Label>
              <Select
                value={setupForm.role}
                onValueChange={(value: 'PRINCIPLE' | 'PARTNER' | 'STANDALONE') =>
                  setSetupForm({ ...setupForm, role: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="STANDALONE">Standalone</SelectItem>
                  <SelectItem value="PRINCIPLE">Principle (Primary)</SelectItem>
                  <SelectItem value="PARTNER">Partner (Secondary)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Principle nodes propagate configuration to Partner nodes
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSetupDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSetupFederation}>
              Configure
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Peer Dialog */}
      <Dialog open={addPeerDialogOpen} onOpenChange={setAddPeerDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Partner Node</DialogTitle>
            <DialogDescription>
              Send a partnership request to another TCP node
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Target Node URL</Label>
              <Input
                placeholder="https://tcp-partner.example.com"
                value={peerForm.targetNodeUrl}
                onChange={(e) =>
                  setPeerForm({ ...peerForm, targetNodeUrl: e.target.value })
                }
              />
            </div>
            <div>
              <Label>Message (Optional)</Label>
              <Input
                placeholder="Partnership request message"
                value={peerForm.message}
                onChange={(e) =>
                  setPeerForm({ ...peerForm, message: e.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddPeerDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddPeer}>
              Send Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
