'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { CrawlDashboard } from '@/components/CrawlDashboard';
import { DashboardShell } from '@/components/DashboardShell';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  FileText,
  MessageSquare,
  Users,
  AlertTriangle,
  AlertOctagon,
  TrendingUp,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
} from 'recharts';

interface DashboardStats {
  totalFeeds: number;
  totalComments: number;
  totalMembers: number;
  todayViolations: number;
  totalViolations: number;
  todayNewFeeds: number;
}

interface ViolationTrend {
  date: string;
  count: number;
}

interface ViolationReason {
  reason: string;
  count: number;
}

interface ChannelDistribution {
  channel: string;
  feeds: number;
  comments: number;
}

interface CrawlTaskStatus {
  id: number;
  type: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  stats?: {
    feedsNew: number;
    feedsUpdated: number;
    commentsNew: number;
    errors: number;
  };
}

interface DashboardData {
  stats: DashboardStats;
  violationTrend: ViolationTrend[];
  violationReasons: ViolationReason[];
  channelDistribution: ChannelDistribution[];
  lastCrawlTask: CrawlTaskStatus | null;
}

const PIE_COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

const statCards = [
  { key: 'totalFeeds', label: '帖子总数', icon: FileText, color: 'text-blue-400' },
  { key: 'totalComments', label: '评论总数', icon: MessageSquare, color: 'text-green-400' },
  { key: 'totalMembers', label: '成员总数', icon: Users, color: 'text-purple-400' },
  { key: 'todayViolations', label: '今日违规', icon: AlertTriangle, color: 'text-yellow-400' },
  { key: 'totalViolations', label: '累计违规', icon: AlertOctagon, color: 'text-red-400' },
  { key: 'todayNewFeeds', label: '今日新增帖', icon: TrendingUp, color: 'text-cyan-400' },
];

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const hasToken = useCallback(async () => {
    try {
      const data = await api.get<{ identityStatus: string }>('/auth/session');
      // Check if identity needs setup
      if (data.identityStatus !== 'ready') {
        router.replace('/identity-setup');
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await hasToken();
      if (cancelled) return;
      if (!ok) {
        router.replace('/login');
        return;
      }
      fetchDashboard();
    })();
    return () => { cancelled = true; };
  }, [hasToken, router]);

  const fetchDashboard = async () => {
    try {
      const result = await api.get<DashboardData>('/dashboard');
      setData(result);
    } catch (err) {
      toast.error('获取仪表盘数据失败');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <DashboardShell>
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl bg-gray-100" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Skeleton className="h-80 rounded-xl bg-gray-100" />
            <Skeleton className="h-80 rounded-xl bg-gray-100" />
          </div>
        </div>
      </DashboardShell>
    );
  }

  if (!data) {
    return (
      <DashboardShell>
        <div className="flex h-64 items-center justify-center text-gray-400">
          暂无数据
        </div>
      </DashboardShell>
    );
  }

  const formatStat = (num: number) => {
    if (num >= 10000) return `${(num / 10000).toFixed(1)}万`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num.toLocaleString();
  };

  return (
    <DashboardShell>
      <div className="space-y-6">
        {/* Crawl Dashboard */}
        <CrawlDashboard />

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {statCards.map((card) => {
            const Icon = card.icon;
            const value = data.stats[card.key as keyof DashboardStats];
            return (
              <Card key={card.key} className="bg-white border-gray-200">
                <CardContent className="flex flex-col gap-2 pt-4">
                  <div className="flex items-center gap-2">
                    <Icon className={`size-4 ${card.color}`} />
                    <span className="text-xs text-gray-500">{card.label}</span>
                  </div>
                  <span className="text-2xl font-bold text-gray-900">{formatStat(value)}</span>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Violation trend */}
          <Card className="bg-white border-gray-200">
            <CardHeader>
              <CardTitle className="text-sm">违规趋势 (近7天)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={data.violationTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
                  <YAxis stroke="#9ca3af" fontSize={12} allowDecimals={false} />
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      color: '#111827',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="#ef4444"
                    strokeWidth={2}
                    dot={{ fill: '#ef4444', r: 4 }}
                    name="违规数"
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Violation reason distribution */}
          <Card className="bg-white border-gray-200">
            <CardHeader>
              <CardTitle className="text-sm">违规原因分布</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={data.violationReasons}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="count"
                    nameKey="reason"
                    label={(props: { name?: string; percent?: number }) => `${props.name || ''} ${((props.percent || 0) * 100).toFixed(0)}%`}
                    labelLine={{ stroke: '#9ca3af' }}
                    fontSize={11}
                  >
                    {data.violationReasons.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      color: '#111827',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Channel distribution + Last crawl */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="bg-white border-gray-200 lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm">版块分布</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.channelDistribution}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="channel" stroke="#9ca3af" fontSize={12} />
                  <YAxis stroke="#9ca3af" fontSize={12} allowDecimals={false} />
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      color: '#111827',
                    }}
                  />
                  <Legend wrapperStyle={{ color: '#6b7280', fontSize: 12 }} />
                  <Bar dataKey="feeds" fill="#3b82f6" name="帖子" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="comments" fill="#10b981" name="评论" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="bg-white border-gray-200">
            <CardHeader>
              <CardTitle className="text-sm">最近爬取任务</CardTitle>
            </CardHeader>
            <CardContent>
              {data.lastCrawlTask ? (
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">类型</span>
                    <span className="text-gray-900">{data.lastCrawlTask.type}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">状态</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        data.lastCrawlTask.status === 'completed'
                          ? 'bg-green-50 text-green-600'
                          : data.lastCrawlTask.status === 'running'
                            ? 'bg-blue-50 text-blue-600'
                            : data.lastCrawlTask.status === 'failed'
                              ? 'bg-red-50 text-red-600'
                              : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {data.lastCrawlTask.status}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">开始时间</span>
                    <span className="text-gray-900">
                      {new Date(data.lastCrawlTask.startedAt).toLocaleString('zh-CN')}
                    </span>
                  </div>
                  {data.lastCrawlTask.stats && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-gray-500">新增帖子</span>
                        <span className="text-gray-900">{data.lastCrawlTask.stats.feedsNew}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">更新帖子</span>
                        <span className="text-gray-900">{data.lastCrawlTask.stats.feedsUpdated}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">新增评论</span>
                        <span className="text-gray-900">{data.lastCrawlTask.stats.commentsNew}</span>
                      </div>
                      {data.lastCrawlTask.stats.errors > 0 && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">错误数</span>
                          <span className="text-red-600">{data.lastCrawlTask.stats.errors}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="flex h-32 items-center justify-center text-gray-400">
                  暂无爬取任务
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardShell>
  );
}
