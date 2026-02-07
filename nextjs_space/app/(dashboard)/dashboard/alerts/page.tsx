"use client";

import { useState, useEffect, useCallback } from 'react';
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
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import {
  Plus,
  Bell,
  BellRing,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  XCircle,
  RefreshCw,
  Trash2,
  Edit,
  MoreVertical,
  Clock,
  Activity,
  Zap,
  VolumeX,
  Eye,
  Settings,
  Play,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface AlertRule {
  id: string;
  name: string;
  description?: string;
  type: string;
  isActive: boolean;
  metric: string;
  condition: string;
  threshold: number;
  duration: number;
  severity: string;
  targetType?: string;
  targetId?: string;
  cooldownMs: number;
  notifyChannels: string[];
  alerts: Alert[];
  createdAt: string;
}

interface Alert {
  id: string;
  ruleId?: string;
  severity: string;
  status: string;
  title: string;
  message: string;
  metricValue?: number;
  threshold?: number;
  targetType?: string;
  targetId?: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  createdAt: string;
  rule?: { name: string; metric: string; condition: string };
}

const METRICS = [
  { value: 'latency', label: 'Latency (ms)' },
  { value: 'error_rate', label: 'Error Rate (%)' },
  { value: 'requests_per_second', label: 'Requests/Second' },
  { value: 'cpu_usage', label: 'CPU Usage (%)' },
  { value: 'memory_usage', label: 'Memory Usage (%)' },
  { value: 'connection_count', label: 'Connection Count' },
  { value: 'queue_depth', label: 'Queue Depth' },
];

const CONDITIONS = [
  { value: '>', label: 'Greater than (>)' },
  { value: '>=', label: 'Greater or equal (>=)' },
  { value: '<', label: 'Less than (<)' },
  { value: '<=', label: 'Less or equal (<=)' },
  { value: '==', label: 'Equal to (==)' },
];

const SEVERITIES = [
  { value: 'LOW', label: 'Low', color: 'bg-blue-100 text-blue-800' },
  { value: 'MEDIUM', label: 'Medium', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'HIGH', label: 'High', color: 'bg-orange-100 text-orange-800' },
  { value: 'CRITICAL', label: 'Critical', color: 'bg-red-100 text-red-800' },
];

export default function AlertsPage() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('alerts');
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [editRule, setEditRule] = useState<AlertRule | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedRule, setSelectedRule] = useState<AlertRule | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    type: 'THRESHOLD',
    metric: 'latency',
    condition: '>',
    threshold: 100,
    duration: 60000,
    severity: 'MEDIUM',
    targetType: '',
    targetId: '',
    cooldownMs: 300000,
  });

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch('/api/alerts/rules');
      if (res.ok) {
        const data = await res.json();
        setRules(data);
      }
    } catch (error) {
      console.error('Error fetching alert rules:', error);
    }
  }, []);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/alerts?limit=100');
      if (res.ok) {
        const data = await res.json();
        setAlerts(data);
      }
    } catch (error) {
      console.error('Error fetching alerts:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
    fetchAlerts();

    // Poll for new alerts every 10 seconds
    const interval = setInterval(() => {
      fetchAlerts();
    }, 10000);

    return () => clearInterval(interval);
  }, [fetchRules, fetchAlerts]);

  const handleSubmitRule = async () => {
    try {
      const url = editRule ? `/api/alerts/rules/${editRule.id}` : '/api/alerts/rules';
      const method = editRule ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        toast.success(editRule ? 'Rule updated' : 'Rule created');
        setRuleDialogOpen(false);
        resetForm();
        fetchRules();
      } else {
        const error = await res.json();
        toast.error(error.error || 'Failed to save rule');
      }
    } catch (error) {
      console.error('Error saving rule:', error);
      toast.error('Failed to save rule');
    }
  };

  const handleToggleRule = async (rule: AlertRule) => {
    try {
      const res = await fetch(`/api/alerts/rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !rule.isActive }),
      });

      if (res.ok) {
        toast.success(`Rule ${rule.isActive ? 'disabled' : 'enabled'}`);
        fetchRules();
      }
    } catch (error) {
      console.error('Error toggling rule:', error);
      toast.error('Failed to toggle rule');
    }
  };

  const handleDeleteRule = async () => {
    if (!selectedRule) return;

    try {
      const res = await fetch(`/api/alerts/rules/${selectedRule.id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        toast.success('Rule deleted');
        setDeleteDialogOpen(false);
        setSelectedRule(null);
        fetchRules();
      } else {
        toast.error('Failed to delete rule');
      }
    } catch (error) {
      console.error('Error deleting rule:', error);
      toast.error('Failed to delete rule');
    }
  };

  const handleAlertAction = async (alert: Alert, action: 'ACKNOWLEDGED' | 'RESOLVED' | 'SILENCED') => {
    try {
      const res = await fetch(`/api/alerts/${alert.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: action }),
      });

      if (res.ok) {
        toast.success(`Alert ${action.toLowerCase()}`);
        fetchAlerts();
      }
    } catch (error) {
      console.error('Error updating alert:', error);
      toast.error('Failed to update alert');
    }
  };

  const simulateAlerts = async () => {
    try {
      const res = await fetch('/api/alerts/simulate', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        toast.success(data.message);
        fetchAlerts();
      }
    } catch (error) {
      console.error('Error simulating alerts:', error);
      toast.error('Failed to simulate alerts');
    }
  };

  const openEditDialog = (rule: AlertRule) => {
    setEditRule(rule);
    setFormData({
      name: rule.name,
      description: rule.description || '',
      type: rule.type,
      metric: rule.metric,
      condition: rule.condition,
      threshold: rule.threshold,
      duration: rule.duration,
      severity: rule.severity,
      targetType: rule.targetType || '',
      targetId: rule.targetId || '',
      cooldownMs: rule.cooldownMs,
    });
    setRuleDialogOpen(true);
  };

  const resetForm = () => {
    setEditRule(null);
    setFormData({
      name: '',
      description: '',
      type: 'THRESHOLD',
      metric: 'latency',
      condition: '>',
      threshold: 100,
      duration: 60000,
      severity: 'MEDIUM',
      targetType: '',
      targetId: '',
      cooldownMs: 300000,
    });
  };

  const getSeverityBadge = (severity: string) => {
    const sev = SEVERITIES.find(s => s.value === severity);
    return <Badge className={sev?.color || 'bg-gray-100'}>{severity}</Badge>;
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      ACTIVE: 'bg-red-100 text-red-800',
      ACKNOWLEDGED: 'bg-yellow-100 text-yellow-800',
      RESOLVED: 'bg-green-100 text-green-800',
      SILENCED: 'bg-gray-100 text-gray-800',
    };
    return <Badge className={colors[status] || 'bg-gray-100'}>{status}</Badge>;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return <BellRing className="h-4 w-4 text-red-500" />;
      case 'ACKNOWLEDGED':
        return <Eye className="h-4 w-4 text-yellow-500" />;
      case 'RESOLVED':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'SILENCED':
        return <VolumeX className="h-4 w-4 text-gray-500" />;
      default:
        return <Bell className="h-4 w-4" />;
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
        return <XCircle className="h-5 w-5 text-red-500" />;
      case 'HIGH':
        return <AlertCircle className="h-5 w-5 text-orange-500" />;
      case 'MEDIUM':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'LOW':
        return <Bell className="h-5 w-5 text-blue-500" />;
      default:
        return <Bell className="h-5 w-5" />;
    }
  };

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const activeAlerts = alerts.filter(a => a.status === 'ACTIVE');
  const criticalAlerts = activeAlerts.filter(a => a.severity === 'CRITICAL');
  const acknowledgedAlerts = alerts.filter(a => a.status === 'ACKNOWLEDGED');

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <BellRing className="h-8 w-8" />
            Real-Time Alerting
          </h1>
          <p className="text-muted-foreground mt-1">
            Monitor and respond to system alerts in real-time
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { fetchAlerts(); fetchRules(); }}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" onClick={simulateAlerts}>
            <Zap className="h-4 w-4 mr-2" />
            Simulate Alerts
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className={activeAlerts.length > 0 ? 'border-red-200 bg-red-50' : ''}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Alerts</CardTitle>
            <BellRing className={`h-4 w-4 ${activeAlerts.length > 0 ? 'text-red-500 animate-pulse' : 'text-muted-foreground'}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeAlerts.length}</div>
            <p className="text-xs text-muted-foreground">Require attention</p>
          </CardContent>
        </Card>
        <Card className={criticalAlerts.length > 0 ? 'border-red-300 bg-red-100' : ''}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Critical</CardTitle>
            <XCircle className={`h-4 w-4 ${criticalAlerts.length > 0 ? 'text-red-600' : 'text-muted-foreground'}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{criticalAlerts.length}</div>
            <p className="text-xs text-muted-foreground">Immediate action needed</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Acknowledged</CardTitle>
            <Eye className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{acknowledgedAlerts.length}</div>
            <p className="text-xs text-muted-foreground">Being investigated</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alert Rules</CardTitle>
            <Settings className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{rules.filter(r => r.isActive).length}</div>
            <p className="text-xs text-muted-foreground">Active rules</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="alerts" className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Alerts
            {activeAlerts.length > 0 && (
              <Badge variant="destructive" className="ml-1 px-1.5 py-0 text-xs">
                {activeAlerts.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="rules" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Rules
          </TabsTrigger>
        </TabsList>

        <TabsContent value="alerts" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Alert Feed</CardTitle>
              <CardDescription>Real-time alerts from your infrastructure</CardDescription>
            </CardHeader>
            <CardContent>
              {alerts.length === 0 ? (
                <div className="text-center py-12">
                  <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-4" />
                  <h3 className="text-lg font-semibold">All Clear</h3>
                  <p className="text-muted-foreground mb-4">No alerts at the moment</p>
                  <Button variant="outline" onClick={simulateAlerts}>
                    <Zap className="h-4 w-4 mr-2" />
                    Simulate Test Alerts
                  </Button>
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="space-y-3">
                    {alerts.map((alert) => (
                      <Card key={alert.id} className={`${
                        alert.status === 'ACTIVE' && alert.severity === 'CRITICAL' ? 'border-red-300 bg-red-50' :
                        alert.status === 'ACTIVE' ? 'border-yellow-200 bg-yellow-50' : ''
                      }`}>
                        <CardContent className="pt-4">
                          <div className="flex items-start justify-between">
                            <div className="flex items-start gap-3">
                              {getSeverityIcon(alert.severity)}
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold">{alert.title}</span>
                                  {getSeverityBadge(alert.severity)}
                                  {getStatusBadge(alert.status)}
                                </div>
                                <p className="text-sm text-muted-foreground">{alert.message}</p>
                                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                  <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {new Date(alert.createdAt).toLocaleString()}
                                  </span>
                                  {alert.metricValue !== undefined && alert.threshold !== undefined && (
                                    <span className="flex items-center gap-1">
                                      <Activity className="h-3 w-3" />
                                      Value: {alert.metricValue.toFixed(2)} (threshold: {alert.threshold})
                                    </span>
                                  )}
                                  {alert.acknowledgedBy && (
                                    <span>Acknowledged by: {alert.acknowledgedBy}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {alert.status === 'ACTIVE' && (
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleAlertAction(alert, 'ACKNOWLEDGED')}
                                  >
                                    <Eye className="h-4 w-4 mr-1" />
                                    Acknowledge
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleAlertAction(alert, 'RESOLVED')}
                                  >
                                    <CheckCircle className="h-4 w-4 mr-1" />
                                    Resolve
                                  </Button>
                                </>
                              )}
                              {alert.status === 'ACKNOWLEDGED' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleAlertAction(alert, 'RESOLVED')}
                                >
                                  <CheckCircle className="h-4 w-4 mr-1" />
                                  Resolve
                                </Button>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rules" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Alert Rules</CardTitle>
                  <CardDescription>Configure conditions that trigger alerts</CardDescription>
                </div>
                <Button onClick={() => { resetForm(); setRuleDialogOpen(true); }}>
                  <Plus className="h-4 w-4 mr-2" />
                  New Rule
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {rules.length === 0 ? (
                <div className="text-center py-12">
                  <Settings className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold">No alert rules</h3>
                  <p className="text-muted-foreground mb-4">Create rules to monitor your infrastructure</p>
                  <Button onClick={() => { resetForm(); setRuleDialogOpen(true); }}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Rule
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Condition</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Active Alerts</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules.map((rule) => (
                      <TableRow key={rule.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{rule.name}</div>
                            {rule.description && (
                              <div className="text-sm text-muted-foreground truncate max-w-xs">
                                {rule.description}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <code className="text-sm bg-muted px-2 py-1 rounded">
                            {rule.metric} {rule.condition} {rule.threshold}
                          </code>
                        </TableCell>
                        <TableCell>{getSeverityBadge(rule.severity)}</TableCell>
                        <TableCell>
                          <Switch
                            checked={rule.isActive}
                            onCheckedChange={() => handleToggleRule(rule)}
                          />
                        </TableCell>
                        <TableCell>
                          {rule.alerts && rule.alerts.length > 0 ? (
                            <Badge variant="destructive">{rule.alerts.length}</Badge>
                          ) : (
                            <Badge variant="outline">0</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditDialog(rule)}>
                                <Edit className="h-4 w-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-red-600"
                                onClick={() => {
                                  setSelectedRule(rule);
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
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create/Edit Rule Dialog */}
      <Dialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editRule ? 'Edit Alert Rule' : 'Create Alert Rule'}</DialogTitle>
            <DialogDescription>
              Define conditions that will trigger alerts
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Rule Name</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., High Latency Alert"
              />
            </div>

            <div className="space-y-2">
              <Label>Description (Optional)</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe when this alert should fire"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Metric</Label>
                <Select
                  value={formData.metric}
                  onValueChange={(value) => setFormData({ ...formData, metric: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METRICS.map((metric) => (
                      <SelectItem key={metric.value} value={metric.value}>
                        {metric.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Condition</Label>
                <Select
                  value={formData.condition}
                  onValueChange={(value) => setFormData({ ...formData, condition: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDITIONS.map((cond) => (
                      <SelectItem key={cond.value} value={cond.value}>
                        {cond.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Threshold</Label>
                <Input
                  type="number"
                  value={formData.threshold}
                  onChange={(e) => setFormData({ ...formData, threshold: parseFloat(e.target.value) || 0 })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Severity</Label>
              <Select
                value={formData.severity}
                onValueChange={(value) => setFormData({ ...formData, severity: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((sev) => (
                    <SelectItem key={sev.value} value={sev.value}>
                      <div className="flex items-center gap-2">
                        {getSeverityIcon(sev.value)}
                        {sev.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Duration (seconds)</Label>
                <Input
                  type="number"
                  value={formData.duration / 1000}
                  onChange={(e) => setFormData({ ...formData, duration: (parseFloat(e.target.value) || 60) * 1000 })}
                />
                <p className="text-xs text-muted-foreground">Condition must be true for this duration</p>
              </div>

              <div className="space-y-2">
                <Label>Cooldown (minutes)</Label>
                <Input
                  type="number"
                  value={formData.cooldownMs / 60000}
                  onChange={(e) => setFormData({ ...formData, cooldownMs: (parseFloat(e.target.value) || 5) * 60000 })}
                />
                <p className="text-xs text-muted-foreground">Minimum time between alerts</p>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setRuleDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmitRule} disabled={!formData.name || !formData.metric}>
              {editRule ? 'Update Rule' : 'Create Rule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Alert Rule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedRule?.name}"? This will also delete all associated alerts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteRule} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
