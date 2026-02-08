"use client";

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import {
  Network,
  Plus,
  RefreshCw,
  Send,
  Check,
  X,
  ArrowUp,
  Settings,
  Trash2,
  Clock,
  Activity,
  AlertCircle,
  CheckCircle,
  XCircle,
  Loader2,
  Copy,
  Globe,
  Users,
  ChevronDown,
  ArrowRightLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';

interface FederationConfig {
  id: string;
  nodeId: string;
  nodeName: string;
  nodeUrl: string;
  role: 'PRINCIPLE' | 'PARTNER' | 'STANDALONE';
  principleNodeId?: string;
  principleUrl?: string;
  lastHeartbeat?: string;
  isActive: boolean;
}

interface FederationPartner {
  id: string;
  nodeId: string;
  nodeName: string;
  nodeUrl: string;
  isActive: boolean;
  lastSyncAt?: string;
  lastHeartbeat?: string;
  syncStatus: string;
  failedSyncCount: number;
}

interface FederationRequest {
  id: string;
  requestType: string;
  requesterNodeId: string;
  requesterNodeName: string;
  requesterNodeUrl: string;
  targetNodeId?: string;
  targetNodeUrl?: string;
  status: string;
  message?: string;
  createdAt: string;
  acknowledgedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
}

interface SyncLog {
  id: string;
  direction: string;
  syncType: string;
  status: string;
  entitiesSynced: Record<string, number>;
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  partner?: { nodeName: string; nodeUrl: string };
}

interface PromotionRequest {
  id: string;
  requesterNodeId: string;
  requesterNodeUrl: string;
  status: string;
  responseDeadline: string;
  reason?: string;
  createdAt: string;
}

export default function FederationPage() {
  const { data: session } = useSession() || {};
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<FederationConfig | null>(null);
  const [partners, setPartners] = useState<FederationPartner[]>([]);
  const [requests, setRequests] = useState<FederationRequest[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [promotionRequests, setPromotionRequests] = useState<PromotionRequest[]>([]);

  // Dialog states
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [promoteDialogOpen, setPromoteDialogOpen] = useState(false);
  const [deletePartnerDialog, setDeletePartnerDialog] = useState<string | null>(null);

  // Form states
  const [configForm, setConfigForm] = useState({ nodeName: '', nodeUrl: '' });
  const [requestForm, setRequestForm] = useState({ targetNodeUrl: '', message: '' });
  const [selectedPartner, setSelectedPartner] = useState<string | null>(null);
  const [promotionReason, setPromotionReason] = useState('');

  // Action states
  const [syncing, setSyncing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (session?.user?.currentOrgId) {
      fetchFederationData();
      // Poll for updates every 10 seconds
      const interval = setInterval(fetchFederationData, 10000);
      return () => clearInterval(interval);
    }
  }, [session?.user?.currentOrgId]);

  const fetchFederationData = async () => {
    try {
      const res = await fetch('/api/federation');
      if (res.ok) {
        const data = await res.json();
        setConfig(data.config);
        setPartners(data.partners || []);
        setRequests(data.pendingRequests || []);
        setSyncLogs(data.recentSyncs || []);
        if (data.config) {
          setConfigForm({ nodeName: data.config.nodeName, nodeUrl: data.config.nodeUrl });
        }
      }
    } catch (error) {
      console.error('Failed to fetch federation data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!configForm.nodeName || !configForm.nodeUrl) {
      toast.error('Node name and URL are required');
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch('/api/federation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configForm),
      });

      if (res.ok) {
        const data = await res.json();
        setConfig(data.config);
        setConfigDialogOpen(false);
        toast.success('Federation configuration saved');
      } else {
        const error = await res.json();
        toast.error(error.error || 'Failed to save configuration');
      }
    } catch (error) {
      toast.error('Failed to save configuration');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSendRequest = async () => {
    if (!requestForm.targetNodeUrl) {
      toast.error('Target node URL is required');
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch('/api/federation/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestForm),
      });

      if (res.ok) {
        setRequestDialogOpen(false);
        setRequestForm({ targetNodeUrl: '', message: '' });
        toast.success('Partnership request sent');
        fetchFederationData();
      } else {
        const error = await res.json();
        toast.error(error.error || 'Failed to send request');
      }
    } catch (error) {
      toast.error('Failed to send request');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRequestAction = async (requestId: string, action: 'acknowledge' | 'reject', reason?: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/federation/requests/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, rejectionReason: reason }),
      });

      if (res.ok) {
        toast.success(action === 'acknowledge' ? 'Request acknowledged' : 'Request rejected');
        fetchFederationData();
      } else {
        const error = await res.json();
        toast.error(error.error || 'Failed to process request');
      }
    } catch (error) {
      toast.error('Failed to process request');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSync = async (partnerId?: string) => {
    setSyncing(true);
    try {
      const res = await fetch('/api/federation/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId, syncType: 'FULL' }),
      });

      if (res.ok) {
        const data = await res.json();
        toast.success(`Sync completed for ${data.results?.length || 0} partner(s)`);
        fetchFederationData();
      } else {
        const error = await res.json();
        toast.error(error.error || 'Sync failed');
      }
    } catch (error) {
      toast.error('Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handlePromotePartner = async () => {
    if (!selectedPartner) return;

    setActionLoading(true);
    try {
      const res = await fetch('/api/federation/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'promote', partnerId: selectedPartner }),
      });

      if (res.ok) {
        const data = await res.json();
        toast.success(`${data.newPrinciple} is now the Principle`);
        setPromoteDialogOpen(false);
        setSelectedPartner(null);
        fetchFederationData();
      } else {
        const error = await res.json();
        toast.error(error.error || 'Failed to promote partner');
      }
    } catch (error) {
      toast.error('Failed to promote partner');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRequestPromotion = async () => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/federation/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request', reason: promotionReason }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.autoPromoted) {
          toast.success('Automatically promoted to Principle (Principle unreachable)');
        } else {
          toast.success('Promotion request sent. Waiting for response...');
        }
        setPromoteDialogOpen(false);
        setPromotionReason('');
        fetchFederationData();
      } else {
        const error = await res.json();
        toast.error(error.error || 'Failed to request promotion');
      }
    } catch (error) {
      toast.error('Failed to request promotion');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemovePartner = async (partnerId: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/federation/partners?id=${partnerId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        toast.success('Partner removed');
        setDeletePartnerDialog(null);
        fetchFederationData();
      } else {
        const error = await res.json();
        toast.error(error.error || 'Failed to remove partner');
      }
    } catch (error) {
      toast.error('Failed to remove partner');
    } finally {
      setActionLoading(false);
    }
  };

  const copyNodeId = () => {
    if (config?.nodeId) {
      navigator.clipboard.writeText(config.nodeId);
      toast.success('Node ID copied');
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'PRINCIPLE':
        return <Badge className="bg-blue-500">Principle</Badge>;
      case 'PARTNER':
        return <Badge className="bg-green-500">Partner</Badge>;
      default:
        return <Badge variant="secondary">Standalone</Badge>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <Badge variant="outline" className="text-yellow-600 border-yellow-600"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case 'ACKNOWLEDGED':
        return <Badge className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" />Acknowledged</Badge>;
      case 'REJECTED':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Rejected</Badge>;
      case 'COMPLETED':
        return <Badge className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" />Completed</Badge>;
      case 'FAILED':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      case 'IN_PROGRESS':
        return <Badge className="bg-blue-500"><Loader2 className="w-3 h-3 mr-1 animate-spin" />In Progress</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const incomingRequests = requests.filter((r) => r.requestType === 'INCOMING');
  const outgoingRequests = requests.filter((r) => r.requestType === 'OUTGOING');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Federation</h1>
          <p className="text-muted-foreground">Connect multiple Traffic Control Planes to work as a cluster</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchFederationData}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          {!config && (
            <Button onClick={() => setConfigDialogOpen(true)}>
              <Settings className="h-4 w-4 mr-2" />
              Configure Node
            </Button>
          )}
        </div>
      </div>

      {/* Node Configuration Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Network className="h-5 w-5" />
                This Node
              </CardTitle>
              <CardDescription>Federation configuration for this Traffic Control Plane</CardDescription>
            </div>
            {config && (
              <Button variant="outline" size="sm" onClick={() => setConfigDialogOpen(true)}>
                <Settings className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {config ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label className="text-muted-foreground text-xs">Node Name</Label>
                <p className="font-medium">{config.nodeName}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Node URL</Label>
                <p className="font-medium text-sm break-all">{config.nodeUrl}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Node ID</Label>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-muted px-2 py-1 rounded">{config.nodeId.slice(0, 12)}...</code>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={copyNodeId}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Role</Label>
                <div className="mt-1">{getRoleBadge(config.role)}</div>
              </div>
              {config.role === 'PARTNER' && config.principleUrl && (
                <div className="md:col-span-2">
                  <Label className="text-muted-foreground text-xs">Connected to Principle</Label>
                  <p className="font-medium text-sm">{config.principleUrl}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <Globe className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-4">Federation not configured</p>
              <Button onClick={() => setConfigDialogOpen(true)}>
                <Settings className="h-4 w-4 mr-2" />
                Configure Federation
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {config && (
        <Tabs defaultValue="partners" className="space-y-4">
          <TabsList>
            <TabsTrigger value="partners">
              <Users className="h-4 w-4 mr-2" />
              Partners {partners.length > 0 && `(${partners.length})`}
            </TabsTrigger>
            <TabsTrigger value="requests">
              <Send className="h-4 w-4 mr-2" />
              Requests {requests.length > 0 && `(${requests.length})`}
            </TabsTrigger>
            <TabsTrigger value="sync">
              <ArrowRightLeft className="h-4 w-4 mr-2" />
              Sync History
            </TabsTrigger>
          </TabsList>

          {/* Partners Tab */}
          <TabsContent value="partners">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Connected Partners</CardTitle>
                    <CardDescription>
                      {config.role === 'PRINCIPLE'
                        ? 'Partner nodes that receive configuration from this Principle'
                        : 'This node is a Partner - configuration is received from the Principle'}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {config.role === 'PRINCIPLE' && partners.length > 0 && (
                      <Button onClick={() => handleSync()} disabled={syncing}>
                        {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                        Sync All
                      </Button>
                    )}
                    {config.role !== 'PARTNER' && (
                      <Button variant="outline" onClick={() => setRequestDialogOpen(true)}>
                        <Plus className="h-4 w-4 mr-2" />
                        Request Partnership
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {config.role === 'PRINCIPLE' && partners.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Node Name</TableHead>
                        <TableHead>URL</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Last Sync</TableHead>
                        <TableHead>Last Heartbeat</TableHead>
                        <TableHead className="w-[100px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {partners.map((partner) => (
                        <TableRow key={partner.id}>
                          <TableCell className="font-medium">{partner.nodeName}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{partner.nodeUrl}</TableCell>
                          <TableCell>{getStatusBadge(partner.syncStatus)}</TableCell>
                          <TableCell className="text-sm">
                            {partner.lastSyncAt ? new Date(partner.lastSyncAt).toLocaleString() : 'Never'}
                          </TableCell>
                          <TableCell className="text-sm">
                            {partner.lastHeartbeat ? new Date(partner.lastHeartbeat).toLocaleString() : 'Never'}
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <ChevronDown className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleSync(partner.id)}>
                                  <RefreshCw className="h-4 w-4 mr-2" />
                                  Sync Now
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => { setSelectedPartner(partner.id); setPromoteDialogOpen(true); }}>
                                  <ArrowUp className="h-4 w-4 mr-2" />
                                  Promote to Principle
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-red-600"
                                  onClick={() => setDeletePartnerDialog(partner.id)}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Remove
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : config.role === 'PARTNER' ? (
                  <div className="text-center py-8">
                    <Activity className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground mb-2">This node is a Partner</p>
                    <p className="text-sm text-muted-foreground mb-4">Configuration is received from: {config.principleUrl}</p>
                    <Button onClick={() => setPromoteDialogOpen(true)}>
                      <ArrowUp className="h-4 w-4 mr-2" />
                      Request Promotion to Principle
                    </Button>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground mb-4">No partners connected</p>
                    <Button variant="outline" onClick={() => setRequestDialogOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Send Partnership Request
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Requests Tab */}
          <TabsContent value="requests">
            <div className="grid gap-4 md:grid-cols-2">
              {/* Incoming Requests */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Incoming Requests</CardTitle>
                  <CardDescription>Partnership requests from other nodes wanting to be your Partner</CardDescription>
                </CardHeader>
                <CardContent>
                  {incomingRequests.length > 0 ? (
                    <div className="space-y-3">
                      {incomingRequests.map((req) => (
                        <div key={req.id} className="border rounded-lg p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <p className="font-medium">{req.requesterNodeName}</p>
                              <p className="text-sm text-muted-foreground">{req.requesterNodeUrl}</p>
                            </div>
                            {getStatusBadge(req.status)}
                          </div>
                          {req.message && (
                            <p className="text-sm text-muted-foreground mb-2">"{req.message}"</p>
                          )}
                          <p className="text-xs text-muted-foreground mb-3">
                            Received: {new Date(req.createdAt).toLocaleString()}
                          </p>
                          {req.status === 'PENDING' && (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={() => handleRequestAction(req.id, 'acknowledge')}
                                disabled={actionLoading}
                              >
                                <Check className="h-4 w-4 mr-1" />
                                Acknowledge
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleRequestAction(req.id, 'reject', 'Request denied')}
                                disabled={actionLoading}
                              >
                                <X className="h-4 w-4 mr-1" />
                                Reject
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">No incoming requests</p>
                  )}
                </CardContent>
              </Card>

              {/* Outgoing Requests */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Outgoing Requests</CardTitle>
                  <CardDescription>Partnership requests you've sent to other nodes</CardDescription>
                </CardHeader>
                <CardContent>
                  {outgoingRequests.length > 0 ? (
                    <div className="space-y-3">
                      {outgoingRequests.map((req) => (
                        <div key={req.id} className="border rounded-lg p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <p className="font-medium">To: {req.targetNodeUrl}</p>
                            </div>
                            {getStatusBadge(req.status)}
                          </div>
                          {req.message && (
                            <p className="text-sm text-muted-foreground mb-2">"{req.message}"</p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            Sent: {new Date(req.createdAt).toLocaleString()}
                          </p>
                          {req.rejectionReason && (
                            <p className="text-sm text-red-500 mt-2">Reason: {req.rejectionReason}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-muted-foreground mb-4">No outgoing requests</p>
                      <Button variant="outline" onClick={() => setRequestDialogOpen(true)}>
                        <Send className="h-4 w-4 mr-2" />
                        Send Request
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Sync History Tab */}
          <TabsContent value="sync">
            <Card>
              <CardHeader>
                <CardTitle>Sync History</CardTitle>
                <CardDescription>Recent synchronization operations</CardDescription>
              </CardHeader>
              <CardContent>
                {syncLogs.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Direction</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Partner</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Entities</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {syncLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell>
                            <Badge variant="outline">
                              {log.direction === 'OUTGOING' ? '↑ Out' : '↓ In'}
                            </Badge>
                          </TableCell>
                          <TableCell>{log.syncType}</TableCell>
                          <TableCell>{log.partner?.nodeName || '-'}</TableCell>
                          <TableCell>{getStatusBadge(log.status)}</TableCell>
                          <TableCell>
                            {log.entitiesSynced && Object.keys(log.entitiesSynced).length > 0 ? (
                              <span className="text-xs">
                                {Object.entries(log.entitiesSynced)
                                  .map(([k, v]) => `${k}: ${v}`)
                                  .join(', ')}
                              </span>
                            ) : (
                              '-'
                            )}
                          </TableCell>
                          <TableCell>{log.durationMs ? `${log.durationMs}ms` : '-'}</TableCell>
                          <TableCell className="text-sm">
                            {new Date(log.startedAt).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-center text-muted-foreground py-8">No sync history</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* Configure Node Dialog */}
      <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configure Federation</DialogTitle>
            <DialogDescription>Set up this node for federation with other Traffic Control Planes</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Node Name</Label>
              <Input
                placeholder="e.g., US-East-1 Control Plane"
                value={configForm.nodeName}
                onChange={(e) => setConfigForm({ ...configForm, nodeName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Node URL</Label>
              <Input
                placeholder="e.g., https://tcp-east.example.com"
                value={configForm.nodeUrl}
                onChange={(e) => setConfigForm({ ...configForm, nodeUrl: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                The public URL where this TCP can be reached by other nodes
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveConfig} disabled={actionLoading}>
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Configuration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Request Dialog */}
      <Dialog open={requestDialogOpen} onOpenChange={setRequestDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Partnership</DialogTitle>
            <DialogDescription>
              Send a partnership request to another TCP. You will become a Partner that receives
              configuration from the Principle.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Target Node URL</Label>
              <Input
                placeholder="e.g., https://tcp-main.example.com"
                value={requestForm.targetNodeUrl}
                onChange={(e) => setRequestForm({ ...requestForm, targetNodeUrl: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Message (optional)</Label>
              <Textarea
                placeholder="Include a message with your request..."
                value={requestForm.message}
                onChange={(e) => setRequestForm({ ...requestForm, message: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSendRequest} disabled={actionLoading}>
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Send Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Promote Dialog */}
      <Dialog open={promoteDialogOpen} onOpenChange={setPromoteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {config?.role === 'PARTNER' ? 'Request Promotion' : 'Promote Partner'}
            </DialogTitle>
            <DialogDescription>
              {config?.role === 'PARTNER'
                ? 'Request to become the new Principle. If the current Principle does not respond within 30 seconds, you will be automatically promoted.'
                : 'Promote the selected partner to become the new Principle. This node will become a Partner.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {config?.role === 'PARTNER' ? (
              <div className="space-y-2">
                <Label>Reason (optional)</Label>
                <Textarea
                  placeholder="Why are you requesting promotion?"
                  value={promotionReason}
                  onChange={(e) => setPromotionReason(e.target.value)}
                />
              </div>
            ) : (
              <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                <div className="flex gap-2">
                  <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-yellow-800 dark:text-yellow-200">Warning</p>
                    <p className="text-yellow-700 dark:text-yellow-300">
                      After promotion, this node will become a Partner and receive configuration from the new Principle.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPromoteDialogOpen(false); setSelectedPartner(null); setPromotionReason(''); }}>
              Cancel
            </Button>
            <Button
              onClick={config?.role === 'PARTNER' ? handleRequestPromotion : handlePromotePartner}
              disabled={actionLoading}
            >
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {config?.role === 'PARTNER' ? 'Request Promotion' : 'Promote'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Partner Confirmation */}
      <AlertDialog open={!!deletePartnerDialog} onOpenChange={() => setDeletePartnerDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Partner</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this partner? They will no longer receive configuration updates.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deletePartnerDialog && handleRemovePartner(deletePartnerDialog)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
