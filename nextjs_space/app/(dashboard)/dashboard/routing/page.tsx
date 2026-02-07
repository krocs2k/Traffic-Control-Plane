"use client";

import { useState, useEffect, useRef } from 'react';
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
  Bot,
  Send,
  Wand2,
  Code,
  Loader2,
  User,
  CheckCircle,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
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

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
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

function extractJsonBlocks(text: string): { conditions: string | null; actions: string | null } {
  let conditions: string | null = null;
  let actions: string | null = null;

  // Try to extract conditions block
  const conditionsMatch = text.match(/```conditions\s*([\s\S]*?)```/i);
  if (conditionsMatch) {
    conditions = conditionsMatch[1].trim();
  }

  // Try to extract actions block
  const actionsMatch = text.match(/```actions\s*([\s\S]*?)```/i);
  if (actionsMatch) {
    actions = actionsMatch[1].trim();
  }

  // Fallback: try to extract any JSON arrays/objects from code blocks
  if (!conditions && !actions) {
    const jsonBlocks = text.match(/```(?:json)?\s*([\s\S]*?)```/gi);
    if (jsonBlocks) {
      for (const block of jsonBlocks) {
        const content = block.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
        try {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed) && !conditions) {
            conditions = JSON.stringify(parsed, null, 2);
          } else if (typeof parsed === 'object' && !Array.isArray(parsed) && !actions) {
            actions = JSON.stringify(parsed, null, 2);
          }
        } catch (e) {
          // Not valid JSON, skip
        }
      }
    }
  }

  return { conditions, actions };
}

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

  // AI Assistant state
  const [configMode, setConfigMode] = useState<'ai' | 'manual'>('ai');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [extractedJson, setExtractedJson] = useState<{ conditions: string | null; actions: string | null }>({ conditions: null, actions: null });
  const chatEndRef = useRef<HTMLDivElement>(null);

  const orgId = session?.user?.currentOrgId;
  const userRole = session?.user?.currentOrgRole ?? 'VIEWER';
  const canManage = hasPermission(userRole, 'manage_routing');

  useEffect(() => {
    if (orgId) {
      fetchPolicies();
      fetchClusters();
    }
  }, [orgId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

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
    // Reset AI state
    setChatMessages([{
      role: 'assistant',
      content: "Hi! I'm here to help you configure routing conditions and actions. Tell me what you'd like to achieve, for example:\n\n• \"Route 10% of traffic to canary\"\n• \"Block requests from specific countries\"\n• \"Route API v2 requests to new backend\"\n• \"Set up header-based routing for beta users\"\n\nWhat would you like to configure?"
    }]);
    setChatInput('');
    setExtractedJson({ conditions: null, actions: null });
    setConfigMode('ai');
    setPolicyDialogOpen(true);
  };

  const savePolicy = async () => {
    try {
      let conditions, actions;
      try {
        conditions = JSON.parse(policyForm.conditions);
        actions = JSON.parse(policyForm.actions);
      } catch (e) {
        toast.error('Invalid JSON in conditions or actions');
        return;
      }

      const payload = {
        orgId,
        name: policyForm.name,
        description: policyForm.description || null,
        type: policyForm.type,
        priority: parseInt(policyForm.priority),
        clusterId: policyForm.clusterId || null,
        conditions,
        actions,
      };

      const url = editingPolicy
        ? `/api/routing-policies/${editingPolicy.id}`
        : '/api/routing-policies';
      const method = editingPolicy ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('Failed to save policy');

      toast.success(editingPolicy ? 'Policy updated' : 'Policy created');
      setPolicyDialogOpen(false);
      fetchPolicies();
    } catch (error) {
      console.error('Error saving policy:', error);
      toast.error('Failed to save policy');
    }
  };

  const togglePolicyStatus = async (policy: RoutingPolicy) => {
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
      toast.error('Failed to toggle policy status');
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

  const sendChatMessage = async () => {
    if (!chatInput.trim() || isAiLoading) return;

    const userMessage: ChatMessage = { role: 'user', content: chatInput };
    setChatMessages(prev => [...prev, userMessage]);
    setChatInput('');
    setIsAiLoading(true);

    try {
      const response = await fetch('/api/routing-policies/ai-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...chatMessages, userMessage].filter(m => m.role !== 'assistant' || chatMessages.indexOf(m) > 0).map(m => ({
            role: m.role,
            content: m.content
          }))
        }),
      });

      if (!response.ok) throw new Error('Failed to get AI response');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = '';
      let partialRead = '';

      // Add empty assistant message that we'll update
      setChatMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;

        partialRead += decoder.decode(value, { stream: true });
        const lines = partialRead.split('\n');
        partialRead = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                assistantMessage += parsed.content;
                setChatMessages(prev => {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1] = { role: 'assistant', content: assistantMessage };
                  return newMessages;
                });
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }

      // Extract JSON from the response
      const extracted = extractJsonBlocks(assistantMessage);
      if (extracted.conditions || extracted.actions) {
        setExtractedJson(extracted);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Failed to get AI response');
      setChatMessages(prev => prev.slice(0, -1)); // Remove empty assistant message
    } finally {
      setIsAiLoading(false);
    }
  };

  const applyExtractedJson = () => {
    if (extractedJson.conditions) {
      setPolicyForm(prev => ({ ...prev, conditions: extractedJson.conditions! }));
    }
    if (extractedJson.actions) {
      setPolicyForm(prev => ({ ...prev, actions: extractedJson.actions! }));
    }
    toast.success('JSON applied to form');
    setConfigMode('manual');
  };

  if (!orgId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Please select an organization</p>
      </div>
    );
  }

  const policyTypeCounts = policies.reduce((acc, p) => {
    acc[p.type] = (acc[p.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const activeCount = policies.filter(p => p.isActive).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Routing Policies</h1>
          <p className="text-muted-foreground">Configure traffic routing rules and conditions</p>
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
        {Object.entries(POLICY_TYPE_LABELS).map(([type, label]) => (
          <Card key={type} className="p-4">
            <div className="flex items-center gap-2">
              {POLICY_TYPE_ICONS[type]}
              <div>
                <div className="text-2xl font-bold">{policyTypeCounts[type] || 0}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Route className="h-5 w-5" />
            Policies
            <Badge variant="secondary" className="ml-2">{activeCount} active</Badge>
          </CardTitle>
          <CardDescription>Manage routing policies by priority order</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : policies.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Route className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No routing policies</h3>
              <p className="text-muted-foreground text-center mt-1">
                Create routing policies to control traffic distribution.
              </p>
              {canManage && (
                <Button className="mt-4" onClick={() => openPolicyDialog()}>
                  <Plus className="h-4 w-4 mr-2" />
                  New Policy
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Priority</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Conditions</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage && <TableHead className="w-16"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.sort((a, b) => a.priority - b.priority).map(policy => (
                  <TableRow key={policy.id}>
                    <TableCell className="font-mono text-sm">{policy.priority}</TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{policy.name}</div>
                        {policy.description && (
                          <div className="text-xs text-muted-foreground">{policy.description}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="flex items-center gap-1 w-fit">
                        {POLICY_TYPE_ICONS[policy.type]}
                        {POLICY_TYPE_LABELS[policy.type] || policy.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {policy.cluster?.name || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-mono">
                        {Array.isArray(policy.conditions) ? `${policy.conditions.length} rule${policy.conditions.length !== 1 ? 's' : ''}` : '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {canManage ? (
                          <Switch
                            checked={policy.isActive}
                            onCheckedChange={() => togglePolicyStatus(policy)}
                          />
                        ) : (
                          policy.isActive ? (
                            <Badge className="bg-green-100 text-green-800">Active</Badge>
                          ) : (
                            <Badge variant="secondary">Inactive</Badge>
                          )
                        )}
                      </div>
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
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
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={policyDialogOpen} onOpenChange={setPolicyDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingPolicy ? 'Edit Policy' : 'New Routing Policy'}</DialogTitle>
            <DialogDescription>
              {editingPolicy ? 'Update the routing policy configuration' : 'Create a new routing policy with AI assistance or manual entry'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
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

            <Tabs value={configMode} onValueChange={(v) => setConfigMode(v as 'ai' | 'manual')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="ai" className="flex items-center gap-2">
                  <Wand2 className="h-4 w-4" />
                  AI Assistant
                </TabsTrigger>
                <TabsTrigger value="manual" className="flex items-center gap-2">
                  <Code className="h-4 w-4" />
                  Manual Entry
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="ai" className="mt-4">
                <Card className="border">
                  <div className="h-[200px] overflow-y-auto p-4">
                    <div className="space-y-4">
                      {chatMessages.map((msg, i) => (
                        <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          {msg.role === 'assistant' && (
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                              <Bot className="h-4 w-4 text-primary" />
                            </div>
                          )}
                          <div className={`max-w-[80%] rounded-lg px-4 py-2 ${msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                            <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                          </div>
                          {msg.role === 'user' && (
                            <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                              <User className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                      ))}
                      {isAiLoading && chatMessages[chatMessages.length - 1]?.role !== 'assistant' && (
                        <div className="flex gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <Loader2 className="h-4 w-4 text-primary animate-spin" />
                          </div>
                          <div className="bg-muted rounded-lg px-4 py-2">
                            <p className="text-sm text-muted-foreground">Thinking...</p>
                          </div>
                        </div>
                      )}
                      <div ref={chatEndRef} />
                    </div>
                  </div>
                  
                  {(extractedJson.conditions || extractedJson.actions) && (
                    <div className="p-3 border-t bg-green-50 dark:bg-green-950">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300">
                          <CheckCircle className="h-4 w-4" />
                          <span>
                            Generated: {extractedJson.conditions ? 'Conditions' : ''}
                            {extractedJson.conditions && extractedJson.actions ? ' & ' : ''}
                            {extractedJson.actions ? 'Actions' : ''}
                          </span>
                        </div>
                        <Button size="sm" onClick={applyExtractedJson}>
                          Apply to Form
                        </Button>
                      </div>
                    </div>
                  )}
                  
                  <div className="p-3 border-t">
                    <form onSubmit={(e) => { e.preventDefault(); sendChatMessage(); }} className="flex gap-2">
                      <Input
                        placeholder="Describe what you want to configure..."
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        disabled={isAiLoading}
                        className="flex-1"
                      />
                      <Button type="submit" disabled={isAiLoading || !chatInput.trim()}>
                        {isAiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </Button>
                    </form>
                    <p className="text-xs text-muted-foreground mt-2">
                      Tip: Say &quot;generate&quot; when ready to create the JSON configuration
                    </p>
                  </div>
                </Card>
              </TabsContent>
              
              <TabsContent value="manual" className="mt-4 space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="policy-conditions">Conditions (JSON)</Label>
                  <Textarea
                    id="policy-conditions"
                    value={policyForm.conditions}
                    onChange={(e) => setPolicyForm({ ...policyForm, conditions: e.target.value })}
                    rows={6}
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
                    rows={6}
                    className="font-mono text-sm"
                    placeholder='{"type": "route", "weight": 10}'
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setPolicyDialogOpen(false)}>Cancel</Button>
            <Button onClick={savePolicy}>Save Policy</Button>
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
