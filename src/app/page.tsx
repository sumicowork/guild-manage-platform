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
  UserCheck,
  AlertTriangle,
  AlertOctagon,
  TrendingUp,
  Clock,
  User,
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
  AreaChart,
  Area,
} from 'recharts';

interface DashboardStats {
  totalFeeds: number;
  totalComments: number;
  totalMembers: number;
  activeMembers: number;
  todayNewFeeds: number;
  todayNewComments: number;
  todayViolations: number;
  totalViolations: number;
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

interface ContentTrend {
  date: string;
  feeds: number;
  comments: number;
}

interface HourlyActivity {
  hour: string;
  count: number;
}

interface TopAuthor {
  author: string;
  count: number;
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
  contentTrend: ContentTrend[];
  hourlyActivity: HourlyActivity[];
  topFeedAuthors: TopAuthor[];
  topCommentAuthors: TopAuthor[];
  lastCrawlTask: CrawlTaskStatus | null;
}

const PIE_COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

const statCards = [
  { key: 'totalFeeds', label: '帖子总数', icon: FileText, color: 'text-blue-400' },
  { key: 'totalComments', label: '评论总数', icon: MessageSquare, color: 'text-green-400' },
  { key: 'totalMembers', label: '成员总数', icon: Users, color: 'text-purple-400' },
  { key: 'activeMembers', label: '活跃成员', icon: UserCheck, color: 'text-emerald-400' },
  { key: 'todayNewFeeds', label: '今日新增帖', icon: TrendingUp, color: 'text-cyan-400' },
  { key: 'todayNewComments', label: '今日新增评', icon: MessageSquare, color: 'text-teal-400' },
  { key: 'todayViolations', label: '今日违规', icon: AlertTriangle, color: 'text-yellow-400' },
  { key: 'totalViolations', label: '累计违规', icon: AlertOctagon, color: 'text-red-400' },
] as const;

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const hasToken = useCallback(async () => {
    try {
      const data = await api.get<{ identityStatus: string }>('/auth/session');
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
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-8">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl bg-gray-100" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Skeleton className="h-80 rounded-xl bg-gray-100" />
            <Skeleton className="h-80 rounded-xl bg-gray-100" />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Skeleton className="h-64 rounded-xl bg-gray-100" />
            <Skeleton className="h-64 rounded-xl bg-gray-100" />
          </div>
        </div>
      </DashboardShell>
    );
  }

  if (!data) {
    return (
      <DashboardShell>
        <div className="flex h-64 items-center justify-center text-gray-400">暂无数据</div>
      </DashboardShell>
    );
  }

  const formatStat = (num: number) => {
    if (num >= 10000) return `${(num / 10000).toFixed(1)}万`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num.toLocaleString();
  };

  const formatTime = (t: string) => new Date(t).toLocaleString('zh-CN');

  return (
    <DashboardShell>
      <div className="space-y-6">
        {/* Crawl Dashboard */}
        <CrawlDashboard />

        {/* Stat cards — 8 cards, 4x2 on medium+ */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
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

        {/* Row 1: Content trend + Hourly activity */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* 30-day feed & comment trend */}
          <Card className="bg-white border-gray-200">
            <CardHeader>
              <CardTitle className="text-sm">帖子/评论增长趋势 (近30天)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={data.contentTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="date"
                    stroke="#9ca3af"
                    fontSize={11}
                    tickFormatter={(v: string) => v.slice(5)}
                  />
                  <YAxis stroke="#9ca3af" fontSize={11} allowDecimals={false} />
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      color: '#111827',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area
                    type="monotone"
                    dataKey="feeds"
                    stroke="#3b82f6"
                    fill="#3b82f620"
                    strokeWidth={2}
                    name="帖子"
                  />
                  <Area
                    type="monotone"
                    dataKey="comments"
                    stroke="#10b981"
                    fill="#10b98120"
                    strokeWidth={2}
                    name="评论"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* 24h hourly activity */}
          <Card className="bg-white border-gray-200">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="size-4 text-blue-400" />
                近 24h 分时段活跃度
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data.hourlyActivity}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="hour" stroke="#9ca3af" fontSize={11} />
                  <YAxis stroke="#9ca3af" fontSize={11} allowDecimals={false} />
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      color: '#111827',
                    }}
                  />
                  <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="帖子数" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Row 2: Top authors + Violation trend */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Top authors */}
          <Card className="bg-white border-gray-200">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <User className="size-4 text-purple-400" />
                活跃作者 Top10
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                {/* Feed authors */}
                <div>
                  <p className="text-xs text-gray-400 mb-2 font-medium">发帖</p>
                  <div className="space-y-1.5">
                    {data.topFeedAuthors.map((a, i) => (
                      <div key={a.author} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-gray-700 truncate max-w-[120px]" title={a.author}>
                          <span className="text-gray-300 w-4 text-right text-[10px]">{i + 1}</span>
                          {a.author}
                        </span>
                        <span className="text-gray-400 shrink-0">{a.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Comment authors */}
                <div>
                  <p className="text-xs text-gray-400 mb-2 font-medium">评论</p>
                  <div className="space-y-1.5">
                    {data.topCommentAuthors.map((a, i) => (
                      <div key={a.author} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-gray-700 truncate max-w-[120px]" title={a.author}>
                          <span className="text-gray-300 w-4 text-right text-[10px]">{i + 1}</span>
                          {a.author}
                        </span>
                        <span className="text-gray-400 shrink-0">{a.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Violation trend (7-day) */}
          <Card className="bg-white border-gray-200">
            <CardHeader>
              <CardTitle className="text-sm">违规趋势 (近7天)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={data.violationTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} tickFormatter={(v: string) => v.slice(5)} />
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
        </div>

        {/* Row 3: Violation reasons + Channel distribution + Last crawl */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Violation reason pie */}
          <Card className="bg-white border-gray-200">
            <CardHeader>
              <CardTitle className="text-sm">违规原因分布</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={data.violationReasons}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={85}
                    paddingAngle={2}
                    dataKey="count"
                    nameKey="reason"
                    label={(props: { name?: string; percent?: number }) =>
                      `${props.name || ''} ${((props.percent || 0) * 100).toFixed(0)}%`
                    }
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

          {/* Channel distribution bar */}
          <Card className="bg-white border-gray-200 lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-sm">版块分布</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.channelDistribution}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="channel" stroke="#9ca3af" fontSize={10} angle={-30} textAnchor="end" height={60} />
                  <YAxis stroke="#9ca3af" fontSize={11} allowDecimals={false} />
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      color: '#111827',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="feeds" fill="#3b82f6" name="帖子" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="comments" fill="#10b981" name="评论" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Last crawl task */}
          <Card className="bg-white border-gray-200">
            <CardHeader>
              <CardTitle className="text-sm">最近爬取任务</CardTitle>
            </CardHeader>
            <CardContent>
              {data.lastCrawlTask ? (
                <div className="space-y-2.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">类型</span>
                    <span className="text-gray-900 font-medium">{data.lastCrawlTask.type}</span>
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
                    <span className="text-gray-500">开始</span>
                    <span className="text-gray-900 text-xs">{formatTime(data.lastCrawlTask.startedAt)}</span>
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
                          <span className="text-gray-500">错误</span>
                          <span className="text-red-600">{data.lastCrawlTask.stats.errors}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="flex h-32 items-center justify-center text-gray-400">暂无爬取任务</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardShell>
  );
}
