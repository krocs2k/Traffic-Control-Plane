"use client";

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import {
  Bell,
  BellOff,
  Check,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  RefreshCw,
  Trash2,
  Filter,
  Lightbulb,
  Sparkles,
  Shield,
  Server,
  Database,
  Route,
  TrendingUp,
  Loader2,
  ChevronRight,
  Clock,
  Zap,
  DollarSign,
  Settings2,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';

interface Notification {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  resourceType: string | null;
  resourceId: string | null;
  isRead: boolean;
  createdAt: string;
}

interface Recommendation {
  id: string;
  category: string;
  title: string;
  description: string;
  impact: string | null;
  confidence: number;
  status: string;
  resourceType: string | null;
  createdAt: string;
}

const SEVERITY_CONFIG = {
  INFO: { icon: Info, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-950', border: 'border-blue-200' },
  WARNING: { icon: AlertTriangle, color: 'text-yellow-500', bg: 'bg-yellow-50 dark:bg-yellow-950', border: 'border-yellow-200' },
  ERROR: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950', border: 'border-red-200' },
  CRITICAL: { icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-900', border: 'border-red-300' },
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  BACKEND_HEALTH: <Server className="h-4 w-4" />,
  REPLICA_LAG: <Database className="h-4 w-4" />,
  POLICY_CHANGE: <Route className="h-4 w-4" />,
  SECURITY: <Shield className="h-4 w-4" />,
  SYSTEM: <Settings2 className="h-4 w-4" />,
  RECOMMENDATION: <Lightbulb className="h-4 w-4" />,
};

const CATEGORY_CONFIG = {
  PERFORMANCE: { icon: Zap, color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-950' },
  RELIABILITY: { icon: Shield, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-950' },
  COST: { icon: DollarSign, color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-950' },
  SECURITY: { icon: Shield, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950' },
  CONFIGURATION: { icon: Settings2, color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-950' },
};

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export default function NotificationsPage() {
  const { data: session } = useSession() || {};
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');

  const orgId = session?.user?.currentOrgId;

  useEffect(() => {
    if (orgId) {
      fetchNotifications();
      fetchRecommendations();
    }
  }, [orgId]);

  const fetchNotifications = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/notifications?orgId=${orgId}`);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchRecommendations = async () => {
    try {
      const res = await fetch(`/api/recommendations?orgId=${orgId}`);
      if (res.ok) {
        const data = await res.json();
        setRecommendations(data.recommendations || []);
      }
    } catch (error) {
      console.error('Error fetching recommendations:', error);
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      await fetch(`/api/notifications/${notificationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRead: true }),
      });
      setNotifications(prev => prev.map(n => n.id === notificationId ? { ...n, isRead: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, markAll: true }),
      });
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
      toast.success('All notifications marked as read');
    } catch (error) {
      console.error('Error marking all as read:', error);
      toast.error('Failed to mark notifications as read');
    }
  };

  const dismissNotification = async (notificationId: string) => {
    try {
      await fetch(`/api/notifications/${notificationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDismissed: true }),
      });
      setNotifications(prev => prev.filter(n => n.id !== notificationId));
      toast.success('Notification dismissed');
    } catch (error) {
      console.error('Error dismissing notification:', error);
      toast.error('Failed to dismiss notification');
    }
  };

  const generateRecommendations = async () => {
    try {
      setGenerating(true);
      const res = await fetch('/api/recommendations/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      });
      if (res.ok) {
        const data = await res.json();
        setRecommendations(prev => [...data.recommendations, ...prev]);
        toast.success(`Generated ${data.recommendations.length} new recommendations`);
      } else {
        throw new Error('Failed to generate');
      }
    } catch (error) {
      console.error('Error generating recommendations:', error);
      toast.error('Failed to generate recommendations');
    } finally {
      setGenerating(false);
    }
  };

  const updateRecommendationStatus = async (recId: string, status: 'ACCEPTED' | 'REJECTED') => {
    try {
      await fetch(`/api/recommendations/${recId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      setRecommendations(prev => prev.filter(r => r.id !== recId));
      toast.success(`Recommendation ${status.toLowerCase()}`);
    } catch (error) {
      console.error('Error updating recommendation:', error);
      toast.error('Failed to update recommendation');
    }
  };

  const filteredNotifications = notifications.filter(n => {
    if (typeFilter !== 'all' && n.type !== typeFilter) return false;
    if (severityFilter !== 'all' && n.severity !== severityFilter) return false;
    return true;
  });

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
          <h1 className="text-2xl font-bold tracking-tight">Notifications & Recommendations</h1>
          <p className="text-muted-foreground">Stay informed about your infrastructure and get AI-powered suggestions</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { fetchNotifications(); fetchRecommendations(); }}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <Tabs defaultValue="notifications" className="space-y-4">
        <TabsList>
          <TabsTrigger value="notifications" className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Notifications
            {unreadCount > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-xs">
                {unreadCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="recommendations" className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4" />
            Recommendations
            {recommendations.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {recommendations.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="notifications" className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[160px]">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="BACKEND_HEALTH">Backend Health</SelectItem>
                  <SelectItem value="REPLICA_LAG">Replica Lag</SelectItem>
                  <SelectItem value="POLICY_CHANGE">Policy Change</SelectItem>
                  <SelectItem value="SECURITY">Security</SelectItem>
                  <SelectItem value="SYSTEM">System</SelectItem>
                </SelectContent>
              </Select>
              <Select value={severityFilter} onValueChange={setSeverityFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Filter by severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Severities</SelectItem>
                  <SelectItem value="CRITICAL">Critical</SelectItem>
                  <SelectItem value="ERROR">Error</SelectItem>
                  <SelectItem value="WARNING">Warning</SelectItem>
                  <SelectItem value="INFO">Info</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {unreadCount > 0 && (
              <Button variant="outline" size="sm" onClick={markAllAsRead}>
                <Check className="h-4 w-4 mr-2" />
                Mark all as read
              </Button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredNotifications.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <BellOff className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No notifications</h3>
                <p className="text-muted-foreground text-center mt-1">
                  You&apos;re all caught up! No new notifications to display.
                </p>
              </CardContent>
            </Card>
          ) : (
            <ScrollArea className="h-[600px]">
              <div className="space-y-2">
                {filteredNotifications.map(notification => {
                  const config = SEVERITY_CONFIG[notification.severity as keyof typeof SEVERITY_CONFIG] || SEVERITY_CONFIG.INFO;
                  const Icon = config.icon;
                  return (
                    <Card
                      key={notification.id}
                      className={`${config.bg} ${config.border} ${!notification.isRead ? 'border-l-4' : ''} transition-all hover:shadow-sm cursor-pointer`}
                      onClick={() => !notification.isRead && markAsRead(notification.id)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-4">
                          <div className={`mt-0.5 ${config.color}`}>
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium">{notification.title}</span>
                              <Badge variant="outline" className="text-xs">
                                {TYPE_ICONS[notification.type]}
                                <span className="ml-1">{notification.type.replace('_', ' ')}</span>
                              </Badge>
                              {!notification.isRead && (
                                <Badge className="bg-blue-500">New</Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">{notification.message}</p>
                            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatTimeAgo(notification.createdAt)}
                              </span>
                              {notification.resourceType && (
                                <span>Resource: {notification.resourceType}</span>
                              )}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={(e) => { e.stopPropagation(); dismissNotification(notification.id); }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        <TabsContent value="recommendations" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              AI-powered recommendations based on your infrastructure configuration
            </p>
            <Button onClick={generateRecommendations} disabled={generating}>
              {generating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              Generate Recommendations
            </Button>
          </div>

          {recommendations.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Lightbulb className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No recommendations</h3>
                <p className="text-muted-foreground text-center mt-1 mb-4">
                  Click &quot;Generate Recommendations&quot; to analyze your infrastructure and get AI-powered suggestions.
                </p>
                <Button onClick={generateRecommendations} disabled={generating}>
                  {generating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  Generate Now
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {recommendations.map(rec => {
                const catConfig = CATEGORY_CONFIG[rec.category as keyof typeof CATEGORY_CONFIG] || CATEGORY_CONFIG.CONFIGURATION;
                const CatIcon = catConfig.icon;
                return (
                  <Card key={rec.id} className={`${catConfig.bg} border`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`p-2 rounded-lg bg-background ${catConfig.color}`}>
                            <CatIcon className="h-5 w-5" />
                          </div>
                          <div>
                            <CardTitle className="text-base">{rec.title}</CardTitle>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant="outline">{rec.category}</Badge>
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <TrendingUp className="h-3 w-3" />
                                {Math.round(rec.confidence * 100)}% confidence
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8"
                            onClick={() => updateRecommendationStatus(rec.id, 'ACCEPTED')}
                          >
                            <ThumbsUp className="h-4 w-4 mr-1" />
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8"
                            onClick={() => updateRecommendationStatus(rec.id, 'REJECTED')}
                          >
                            <ThumbsDown className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground mb-2">{rec.description}</p>
                      {rec.impact && (
                        <div className="flex items-center gap-2 text-sm">
                          <ChevronRight className="h-4 w-4 text-green-500" />
                          <span className="text-green-700 dark:text-green-300">Impact: {rec.impact}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatTimeAgo(rec.createdAt)}
                        </span>
                        {rec.resourceType && (
                          <span>Affects: {rec.resourceType}</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
