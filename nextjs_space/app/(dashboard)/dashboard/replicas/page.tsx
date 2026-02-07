"use client";

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import {
  Database,
  Plus,
  Pencil,
  Trash2,
  MoreVertical,
  RefreshCw,
  Activity,
  CheckCircle2,
  Clock,
  WifiOff,
  Globe,
  Gauge,
  Wifi,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { toast } from 'sonner';
import { hasPermission } from '@/lib/types';

interface ReadReplica {
  id: string;
  name: string;
  host: string;
  port: number;
  region: string | null;
  maxAcceptableLagMs: number;
  currentLagMs: number;
  status: string;
  lastHealthCheck: string | null;
  isActive: boolean;
  lagMetrics: { lagMs: number; recordedAt: string }[];
}

const STATUS_ICONS = {
  SYNCED: <CheckCircle2 className="h-5 w-5 text-green-500" />,
  LAGGING: <Clock className="h-5 w-5 text-yellow-500" />,
  CATCHING_UP: <Activity className="h-5 w-5 text-blue-500" />,
  OFFLINE: <WifiOff className="h-5 w-5 text-red-500" />,
};

const STATUS_LABELS = {
  SYNCED: 'Synced',
  LAGGING: 'Lagging',
  CATCHING_UP: 'Catching Up',
  OFFLINE: 'Offline',
};

const STATUS_COLORS = {
  SYNCED: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  LAGGING: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  CATCHING_UP: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  OFFLINE: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

function formatLag(lagMs: number): string {
  if (lagMs < 1000) return `${lagMs}ms`;
  if (lagMs < 60000) return `${(lagMs / 1000).toFixed(1)}s`;
  return `${(lagMs / 60000).toFixed(1)}m`;
}

export default function ReplicasPage() {
  const { data: session } = useSession() || {};
  const [replicas, setReplicas] = useState<ReadReplica[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReplica, setSelectedReplica] = useState<ReadReplica | null>(null);

  const [replicaDialogOpen, setReplicaDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingReplica, setEditingReplica] = useState<ReadReplica | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReadReplica | null>(null);

  const [replicaForm, setReplicaForm] = useState({
    name: '',
    host: '',
    port: '5432',
    region: '',
    maxAcceptableLagMs: '1000',
  });

  const orgId = session?.user?.currentOrgId;
  const userRole = session?.user?.currentOrgRole ?? 'VIEWER';
  const canManage = hasPermission(userRole, 'manage_replicas');

  useEffect(() => {
    if (orgId) {
      fetchReplicas();
    }
  }, [orgId]);

  const fetchReplicas = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/read-replicas?orgId=${orgId}`);
      if (res.ok) {
        const data = await res.json();
        setReplicas(data.replicas || []);
      }
    } catch (error) {
      console.error('Error fetching replicas:', error);
      toast.error('Failed to load read replicas');
    } finally {
      setLoading(false);
    }
  };

  const openReplicaDialog = (replica?: ReadReplica) => {
    if (replica) {
      setEditingReplica(replica);
      setReplicaForm({
        name: replica.name,
        host: replica.host,
        port: replica.port.toString(),
        region: replica.region || '',
        maxAcceptableLagMs: replica.maxAcceptableLagMs.toString(),
      });
    } else {
      setEditingReplica(null);
      setReplicaForm({
        name: '',
        host: '',
        port: '5432',
        region: '',
        maxAcceptableLagMs: '1000',
      });
    }
    setReplicaDialogOpen(true);
  };

  const saveReplica = async () => {
    try {
      const payload = {
        name: replicaForm.name,
        host: replicaForm.host,
        port: parseInt(replicaForm.port),
        region: replicaForm.region || null,
        maxAcceptableLagMs: parseInt(replicaForm.maxAcceptableLagMs),
      };

      if (editingReplica) {
        const res = await fetch(`/api/read-replicas/${editingReplica.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to update replica');
        toast.success('Replica updated successfully');
      } else {
        const res = await fetch('/api/read-replicas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, orgId }),
        });
        if (!res.ok) throw new Error('Failed to create replica');
        toast.success('Replica created successfully');
      }
      setReplicaDialogOpen(false);
      fetchReplicas();
    } catch (error) {
      console.error('Error saving replica:', error);
      toast.error('Failed to save replica');
    }
  };

  const testLagAwareSelection = async () => {
    try {
      const res = await fetch('/api/read-replicas/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      });
      const data = await res.json();
      if (data.selected) {
        toast.success(`Selected: ${data.selected.name} (${data.selected.lagFormatted} lag)`, {
          description: data.reason,
        });
        setSelectedReplica(replicas.find(r => r.id === data.selected.id) || null);
      } else {
        toast.warning(data.message || 'No suitable replica found');
      }
    } catch (error) {
      console.error('Error testing selection:', error);
      toast.error('Failed to test lag-aware selection');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/read-replicas/${deleteTarget.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete replica');
      toast.success('Replica deleted successfully');
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      fetchReplicas();
    } catch (error) {
      console.error('Error deleting replica:', error);
      toast.error('Failed to delete replica');
    }
  };

  if (!orgId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Please select an organization</p>
      </div>
    );
  }

  const syncedCount = replicas.filter(r => r.status === 'SYNCED').length;
  const laggingCount = replicas.filter(r => r.status === 'LAGGING' || r.status === 'CATCHING_UP').length;
  const offlineCount = replicas.filter(r => r.status === 'OFFLINE').length;
  const avgLag = replicas.length > 0
    ? Math.round(replicas.reduce((sum, r) => sum + r.currentLagMs, 0) / replicas.length)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Read Replicas</h1>
          <p className="text-muted-foreground">Monitor and manage lag-aware read replicas</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchReplicas}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={testLagAwareSelection}>
            <Gauge className="h-4 w-4 mr-2" />
            Test Selection
          </Button>
          {canManage && (
            <Button onClick={() => openReplicaDialog()}>
              <Plus className="h-4 w-4 mr-2" />
              Add Replica
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <div>
                <div className="text-2xl font-bold">{syncedCount}</div>
                <div className="text-xs text-muted-foreground">Synced</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-yellow-500" />
              <div>
                <div className="text-2xl font-bold">{laggingCount}</div>
                <div className="text-xs text-muted-foreground">Lagging</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <WifiOff className="h-5 w-5 text-red-500" />
              <div>
                <div className="text-2xl font-bold">{offlineCount}</div>
                <div className="text-xs text-muted-foreground">Offline</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-blue-500" />
              <div>
                <div className="text-2xl font-bold">{formatLag(avgLag)}</div>
                <div className="text-xs text-muted-foreground">Avg Lag</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-6 w-32 bg-muted rounded" />
              </CardHeader>
              <CardContent>
                <div className="h-24 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : replicas.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Database className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No read replicas</h3>
            <p className="text-muted-foreground text-center mt-1">
              Add read replicas to enable lag-aware routing for database reads.
            </p>
            {canManage && (
              <Button className="mt-4" onClick={() => openReplicaDialog()}>
                <Plus className="h-4 w-4 mr-2" />
                Add Replica
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {replicas.map(replica => (
            <Card
              key={replica.id}
              className={`transition-all cursor-pointer hover:shadow-md ${selectedReplica?.id === replica.id ? 'ring-2 ring-primary' : ''}`}
              onClick={() => setSelectedReplica(selectedReplica?.id === replica.id ? null : replica)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {STATUS_ICONS[replica.status as keyof typeof STATUS_ICONS]}
                    <CardTitle className="text-base">{replica.name}</CardTitle>
                  </div>
                  {canManage && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openReplicaDialog(replica)}>
                          <Pencil className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-red-600"
                          onClick={() => {
                            setDeleteTarget(replica);
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
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Wifi className="h-3 w-3" />
                  {replica.host}:{replica.port}
                  {replica.region && (
                    <Badge variant="outline" className="ml-2 text-xs">
                      <Globe className="h-3 w-3 mr-1" />
                      {replica.region}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                    <Badge className={STATUS_COLORS[replica.status as keyof typeof STATUS_COLORS]}>
                      {STATUS_LABELS[replica.status as keyof typeof STATUS_LABELS] || replica.status}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Replication Lag</span>
                      <span className="font-medium">{formatLag(replica.currentLagMs)}</span>
                    </div>
                    <Progress
                      value={Math.min((replica.currentLagMs / replica.maxAcceptableLagMs) * 100, 100)}
                      className={replica.currentLagMs > replica.maxAcceptableLagMs ? 'bg-red-200' : ''}
                    />
                    <div className="text-xs text-muted-foreground text-right">
                      Max: {formatLag(replica.maxAcceptableLagMs)}
                    </div>
                  </div>
                  {replica.lastHealthCheck && (
                    <div className="text-xs text-muted-foreground">
                      Last check: {new Date(replica.lastHealthCheck).toLocaleString()}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedReplica && (
        <Card className="border-primary">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              Selected Replica: {selectedReplica.name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Host:</span>
                <p className="font-medium">{selectedReplica.host}:{selectedReplica.port}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Region:</span>
                <p className="font-medium">{selectedReplica.region || 'N/A'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Status:</span>
                <Badge className={`ml-1 ${STATUS_COLORS[selectedReplica.status as keyof typeof STATUS_COLORS]}`}>
                  {STATUS_LABELS[selectedReplica.status as keyof typeof STATUS_LABELS] || selectedReplica.status}
                </Badge>
              </div>
              <div>
                <span className="text-muted-foreground">Current Lag:</span>
                <p className="font-medium">{formatLag(selectedReplica.currentLagMs)}</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => setSelectedReplica(null)}
            >
              Clear Selection
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={replicaDialogOpen} onOpenChange={setReplicaDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingReplica ? 'Edit Replica' : 'Add Read Replica'}</DialogTitle>
            <DialogDescription>
              {editingReplica ? 'Update the replica configuration' : 'Add a new read replica for lag-aware routing'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="replica-name">Name</Label>
              <Input
                id="replica-name"
                value={replicaForm.name}
                onChange={(e) => setReplicaForm({ ...replicaForm, name: e.target.value })}
                placeholder="replica-us-east-1"
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 grid gap-2">
                <Label htmlFor="replica-host">Host</Label>
                <Input
                  id="replica-host"
                  value={replicaForm.host}
                  onChange={(e) => setReplicaForm({ ...replicaForm, host: e.target.value })}
                  placeholder="replica.db.example.com"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="replica-port">Port</Label>
                <Input
                  id="replica-port"
                  type="number"
                  value={replicaForm.port}
                  onChange={(e) => setReplicaForm({ ...replicaForm, port: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="replica-region">Region</Label>
                <Input
                  id="replica-region"
                  value={replicaForm.region}
                  onChange={(e) => setReplicaForm({ ...replicaForm, region: e.target.value })}
                  placeholder="us-east-1"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="replica-lag">Max Acceptable Lag (ms)</Label>
                <Input
                  id="replica-lag"
                  type="number"
                  value={replicaForm.maxAcceptableLagMs}
                  onChange={(e) => setReplicaForm({ ...replicaForm, maxAcceptableLagMs: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplicaDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveReplica}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete replica?</AlertDialogTitle>
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
