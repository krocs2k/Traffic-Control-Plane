"use client";

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  Plus,
  Beaker,
  Play,
  Pause,
  StopCircle,
  Trash2,
  Edit,
  MoreVertical,
  FlaskConical,
  GitBranch,
  BarChart3,
  RefreshCw,
  ChevronRight,
  Target,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import dynamic from 'next/dynamic';

// Lazy load recharts components to reduce initial bundle size
const LineChart = dynamic(() => import('recharts').then(mod => mod.LineChart), { ssr: false });
const Line = dynamic(() => import('recharts').then(mod => mod.Line), { ssr: false });
const BarChart = dynamic(() => import('recharts').then(mod => mod.BarChart), { ssr: false });
const Bar = dynamic(() => import('recharts').then(mod => mod.Bar), { ssr: false });
const XAxis = dynamic(() => import('recharts').then(mod => mod.XAxis), { ssr: false });
const YAxis = dynamic(() => import('recharts').then(mod => mod.YAxis), { ssr: false });
const CartesianGrid = dynamic(() => import('recharts').then(mod => mod.CartesianGrid), { ssr: false });
const Tooltip = dynamic(() => import('recharts').then(mod => mod.Tooltip), { ssr: false });
const ResponsiveContainer = dynamic(() => import('recharts').then(mod => mod.ResponsiveContainer), { ssr: false });
const Legend = dynamic(() => import('recharts').then(mod => mod.Legend), { ssr: false });

interface ExperimentVariant {
  id: string;
  name: string;
  description?: string;
  backendId?: string;
  weight: number;
  isControl: boolean;
  config: Record<string, unknown>;
}

interface ExperimentMetric {
  id: string;
  experimentId: string;
  variantId?: string;
  variant?: ExperimentVariant;
  requestCount: number;
  errorCount: number;
  avgLatencyMs: number;
  p50LatencyMs?: number;
  p95LatencyMs?: number;
  p99LatencyMs?: number;
  conversionRate?: number;
  recordedAt: string;
}

interface Experiment {
  id: string;
  name: string;
  description?: string;
  type: string;
  status: string;
  clusterId?: string;
  targetRoutes: string[];
  startedAt?: string;
  endedAt?: string;
  rolloutPercentage: number;
  successMetric?: string;
  variants: ExperimentVariant[];
  metrics: ExperimentMetric[];
  createdAt: string;
}

interface Cluster {
  id: string;
  name: string;
}

export default function ExperimentsPage() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedExperiment, setSelectedExperiment] = useState<Experiment | null>(null);
  const [activeTab, setActiveTab] = useState('overview');

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    type: 'AB_TEST',
    clusterId: '',
    targetRoutes: '',
    rolloutPercentage: 10,
    successMetric: '',
    variants: [
      { name: 'Control', description: 'Original version', weight: 50, isControl: true },
      { name: 'Variant A', description: 'Test version', weight: 50, isControl: false },
    ],
  });

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    fetchExperiments();
    fetchClusters();
  }, []);

  const fetchExperiments = async () => {
    try {
      const res = await fetch('/api/experiments');
      if (res.ok) {
        const data = await res.json();
        setExperiments(data);
      }
    } catch (error) {
      console.error('Error fetching experiments:', error);
      toast.error('Failed to fetch experiments');
    } finally {
      setLoading(false);
    }
  };

  const fetchClusters = async () => {
    try {
      const res = await fetch('/api/backends/clusters');
      if (res.ok) {
        const data = await res.json();
        setClusters(data.clusters || []);
      }
    } catch (error) {
      console.error('Error fetching clusters:', error);
    }
  };

  const handleSubmit = async () => {
    try {
      const payload = {
        ...formData,
        targetRoutes: formData.targetRoutes.split(',').map(r => r.trim()).filter(Boolean),
        clusterId: formData.clusterId || undefined,
      };

      const res = await fetch('/api/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        toast.success('Experiment created successfully');
        setDialogOpen(false);
        resetForm();
        fetchExperiments();
      } else {
        const error = await res.json();
        toast.error(error.error || 'Failed to create experiment');
      }
    } catch (error) {
      console.error('Error creating experiment:', error);
      toast.error('Failed to create experiment');
    }
  };

  const handleStatusChange = async (experiment: Experiment, newStatus: string) => {
    try {
      const res = await fetch(`/api/experiments/${experiment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        toast.success(`Experiment ${newStatus.toLowerCase()}`);
        fetchExperiments();
      } else {
        toast.error('Failed to update experiment status');
      }
    } catch (error) {
      console.error('Error updating experiment:', error);
      toast.error('Failed to update experiment');
    }
  };

  const handleDelete = async () => {
    if (!selectedExperiment) return;

    try {
      const res = await fetch(`/api/experiments/${selectedExperiment.id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        toast.success('Experiment deleted successfully');
        setDeleteDialogOpen(false);
        setSelectedExperiment(null);
        fetchExperiments();
      } else {
        toast.error('Failed to delete experiment');
      }
    } catch (error) {
      console.error('Error deleting experiment:', error);
      toast.error('Failed to delete experiment');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      type: 'AB_TEST',
      clusterId: '',
      targetRoutes: '',
      rolloutPercentage: 10,
      successMetric: '',
      variants: [
        { name: 'Control', description: 'Original version', weight: 50, isControl: true },
        { name: 'Variant A', description: 'Test version', weight: 50, isControl: false },
      ],
    });
  };

  const addVariant = () => {
    const newVariantName = `Variant ${String.fromCharCode(65 + formData.variants.length - 1)}`;
    setFormData({
      ...formData,
      variants: [
        ...formData.variants,
        { name: newVariantName, description: '', weight: 0, isControl: false },
      ],
    });
  };

  const removeVariant = (index: number) => {
    if (formData.variants.length <= 2) return;
    const newVariants = formData.variants.filter((_, i) => i !== index);
    setFormData({ ...formData, variants: newVariants });
  };

  const updateVariant = (index: number, field: string, value: string | number | boolean) => {
    const newVariants = [...formData.variants];
    newVariants[index] = { ...newVariants[index], [field]: value };
    setFormData({ ...formData, variants: newVariants });
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      DRAFT: 'bg-gray-100 text-gray-800',
      RUNNING: 'bg-green-100 text-green-800',
      PAUSED: 'bg-yellow-100 text-yellow-800',
      COMPLETED: 'bg-blue-100 text-blue-800',
      ABORTED: 'bg-red-100 text-red-800',
    };
    return <Badge className={colors[status] || 'bg-gray-100'}>{status}</Badge>;
  };

  const getTypeBadge = (type: string) => {
    const colors: Record<string, string> = {
      AB_TEST: 'bg-purple-100 text-purple-800',
      CANARY: 'bg-orange-100 text-orange-800',
      BLUE_GREEN: 'bg-cyan-100 text-cyan-800',
      FEATURE_FLAG: 'bg-indigo-100 text-indigo-800',
    };
    return <Badge className={colors[type] || 'bg-gray-100'}>{type.replace('_', ' ')}</Badge>;
  };

  const getAggregatedMetrics = (experiment: Experiment) => {
    if (!experiment.metrics || experiment.metrics.length === 0) return null;

    const variantMetrics: Record<string, { requests: number; errors: number; latency: number; count: number }> = {};

    for (const metric of experiment.metrics) {
      const variantId = metric.variantId || 'unknown';
      if (!variantMetrics[variantId]) {
        variantMetrics[variantId] = { requests: 0, errors: 0, latency: 0, count: 0 };
      }
      variantMetrics[variantId].requests += metric.requestCount;
      variantMetrics[variantId].errors += metric.errorCount;
      variantMetrics[variantId].latency += metric.avgLatencyMs;
      variantMetrics[variantId].count += 1;
    }

    return experiment.variants.map(variant => {
      const metrics = variantMetrics[variant.id] || { requests: 0, errors: 0, latency: 0, count: 1 };
      return {
        name: variant.name,
        isControl: variant.isControl,
        requests: metrics.requests,
        errorRate: metrics.requests > 0 ? (metrics.errors / metrics.requests) * 100 : 0,
        avgLatency: metrics.latency / metrics.count,
      };
    });
  };

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const runningExperiments = experiments.filter(e => e.status === 'RUNNING');
  const draftExperiments = experiments.filter(e => e.status === 'DRAFT');
  const completedExperiments = experiments.filter(e => e.status === 'COMPLETED' || e.status === 'ABORTED');

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <FlaskConical className="h-8 w-8" />
            Canary & A/B Testing
          </h1>
          <p className="text-muted-foreground mt-1">
            Create and manage traffic experiments for canary deployments and A/B tests
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchExperiments}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Experiment
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Running</CardTitle>
            <Play className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{runningExperiments.length}</div>
            <p className="text-xs text-muted-foreground">Active experiments</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Draft</CardTitle>
            <Edit className="h-4 w-4 text-gray-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{draftExperiments.length}</div>
            <p className="text-xs text-muted-foreground">Pending start</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckCircle className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{completedExperiments.length}</div>
            <p className="text-xs text-muted-foreground">Finished experiments</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total</CardTitle>
            <Beaker className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{experiments.length}</div>
            <p className="text-xs text-muted-foreground">All experiments</p>
          </CardContent>
        </Card>
      </div>

      {/* Experiments Table */}
      <Card>
        <CardHeader>
          <CardTitle>Experiments</CardTitle>
          <CardDescription>Manage your canary deployments and A/B tests</CardDescription>
        </CardHeader>
        <CardContent>
          {experiments.length === 0 ? (
            <div className="text-center py-12">
              <FlaskConical className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold">No experiments yet</h3>
              <p className="text-muted-foreground mb-4">Create your first experiment to start testing</p>
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create Experiment
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Rollout %</TableHead>
                  <TableHead>Variants</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {experiments.map((experiment) => {
                  const metrics = getAggregatedMetrics(experiment);
                  return (
                    <TableRow key={experiment.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{experiment.name}</div>
                          {experiment.description && (
                            <div className="text-sm text-muted-foreground truncate max-w-xs">
                              {experiment.description}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{getTypeBadge(experiment.type)}</TableCell>
                      <TableCell>{getStatusBadge(experiment.status)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={experiment.rolloutPercentage} className="w-16 h-2" />
                          <span className="text-sm">{experiment.rolloutPercentage}%</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <GitBranch className="h-4 w-4 text-muted-foreground" />
                          <span>{experiment.variants.length}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(experiment.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {experiment.status === 'DRAFT' && (
                              <DropdownMenuItem onClick={() => handleStatusChange(experiment, 'RUNNING')}>
                                <Play className="h-4 w-4 mr-2 text-green-500" />
                                Start
                              </DropdownMenuItem>
                            )}
                            {experiment.status === 'RUNNING' && (
                              <>
                                <DropdownMenuItem onClick={() => handleStatusChange(experiment, 'PAUSED')}>
                                  <Pause className="h-4 w-4 mr-2 text-yellow-500" />
                                  Pause
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleStatusChange(experiment, 'COMPLETED')}>
                                  <CheckCircle className="h-4 w-4 mr-2 text-blue-500" />
                                  Complete
                                </DropdownMenuItem>
                              </>
                            )}
                            {experiment.status === 'PAUSED' && (
                              <DropdownMenuItem onClick={() => handleStatusChange(experiment, 'RUNNING')}>
                                <Play className="h-4 w-4 mr-2 text-green-500" />
                                Resume
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => handleStatusChange(experiment, 'ABORTED')}>
                              <StopCircle className="h-4 w-4 mr-2 text-red-500" />
                              Abort
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600"
                              onClick={() => {
                                setSelectedExperiment(experiment);
                                setDeleteDialogOpen(true);
                              }}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Experiment Results Section */}
      {experiments.filter(e => e.metrics && e.metrics.length > 0).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Experiment Results
            </CardTitle>
            <CardDescription>Performance comparison across experiment variants</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {experiments
                .filter(e => e.metrics && e.metrics.length > 0)
                .map(experiment => {
                  const chartData = getAggregatedMetrics(experiment);
                  if (!chartData) return null;

                  return (
                    <div key={experiment.id} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="font-semibold">{experiment.name}</h3>
                          {getStatusBadge(experiment.status)}
                        </div>
                      </div>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="name" />
                            <YAxis yAxisId="left" orientation="left" stroke="#8884d8" />
                            <YAxis yAxisId="right" orientation="right" stroke="#82ca9d" />
                            <Tooltip />
                            <Legend />
                            <Bar yAxisId="left" dataKey="avgLatency" name="Avg Latency (ms)" fill="#8884d8" />
                            <Bar yAxisId="right" dataKey="errorRate" name="Error Rate (%)" fill="#ff7300" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create Experiment Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Experiment</DialogTitle>
            <DialogDescription>
              Set up a new canary deployment or A/B test for your traffic
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="basic" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="basic">Basic Info</TabsTrigger>
              <TabsTrigger value="variants">Variants</TabsTrigger>
              <TabsTrigger value="targeting">Targeting</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="name">Experiment Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., New Checkout Flow Test"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe the purpose of this experiment"
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="type">Experiment Type</Label>
                <Select
                  value={formData.type}
                  onValueChange={(value) => setFormData({ ...formData, type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AB_TEST">A/B Test</SelectItem>
                    <SelectItem value="CANARY">Canary Deployment</SelectItem>
                    <SelectItem value="BLUE_GREEN">Blue/Green</SelectItem>
                    <SelectItem value="FEATURE_FLAG">Feature Flag</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="successMetric">Success Metric (Optional)</Label>
                <Input
                  id="successMetric"
                  value={formData.successMetric}
                  onChange={(e) => setFormData({ ...formData, successMetric: e.target.value })}
                  placeholder="e.g., latency < 100ms, error_rate < 1%"
                />
              </div>
            </TabsContent>

            <TabsContent value="variants" className="space-y-4 mt-4">
              <div className="space-y-4">
                {formData.variants.map((variant, index) => (
                  <Card key={index}>
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{variant.name}</span>
                          {variant.isControl && (
                            <Badge variant="outline">Control</Badge>
                          )}
                        </div>
                        {!variant.isControl && formData.variants.length > 2 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeVariant(index)}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Name</Label>
                          <Input
                            value={variant.name}
                            onChange={(e) => updateVariant(index, 'name', e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Weight (%)</Label>
                          <Input
                            type="number"
                            value={variant.weight}
                            onChange={(e) => updateVariant(index, 'weight', parseInt(e.target.value) || 0)}
                            min={0}
                            max={100}
                          />
                        </div>
                      </div>

                      <div className="mt-4 space-y-2">
                        <Label>Description</Label>
                        <Input
                          value={variant.description}
                          onChange={(e) => updateVariant(index, 'description', e.target.value)}
                          placeholder="Describe this variant"
                        />
                      </div>
                    </CardContent>
                  </Card>
                ))}

                <Button variant="outline" onClick={addVariant} className="w-full">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Variant
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="targeting" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="cluster">Target Cluster (Optional)</Label>
                <Select
                  value={formData.clusterId || '__none__'}
                  onValueChange={(value) => setFormData({ ...formData, clusterId: value === '__none__' ? '' : value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a cluster" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">All Clusters</SelectItem>
                    {clusters.map((cluster) => (
                      <SelectItem key={cluster.id} value={cluster.id}>
                        {cluster.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="targetRoutes">Target Routes (comma-separated)</Label>
                <Input
                  id="targetRoutes"
                  value={formData.targetRoutes}
                  onChange={(e) => setFormData({ ...formData, targetRoutes: e.target.value })}
                  placeholder="/api/*, /checkout/*"
                />
              </div>

              <div className="space-y-4">
                <Label>Rollout Percentage: {formData.rolloutPercentage}%</Label>
                <Slider
                  value={[formData.rolloutPercentage]}
                  onValueChange={(value) => setFormData({ ...formData, rolloutPercentage: value[0] })}
                  max={100}
                  step={1}
                />
                <p className="text-sm text-muted-foreground">
                  Percentage of traffic that will be part of this experiment
                </p>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!formData.name}>
              Create Experiment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Experiment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedExperiment?.name}"? This action cannot be undone
              and all associated metrics will be lost.
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
