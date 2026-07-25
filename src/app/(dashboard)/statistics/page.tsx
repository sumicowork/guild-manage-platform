'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, FileText, MessageCircle, TrendingUp, Activity, Calendar } from 'lucide-react';

interface Stats {
  overview: { dau: number; wau: number; mau: number; stickyRatio: number };
  members: { total: number; active: number; left: number; newToday: number; newThisWeek: number; newThisMonth: number };
  content: { totalFeeds: number; feedsToday: number; feedsThisWeek: number; totalComments: number; commentsToday: number; commentsThisWeek: number };
  dailyTrend: Array<{ date: string; feeds: number; comments: number; authors: number }>;
  hourlyActivity: Array<{ hour: number; feeds: number; comments: number }>;
  topAuthors: Array<{ tinyid: string; nickname: string; postCount: number }>;
}

function fmtNum(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function TrendBar({ data, max, label }: { data: number; max: number; label: string }) {
  const pct = max > 0 ? Math.round((data / max) * 100) : 0;
  return (
    <div className="flex items-center gap-1 text-[11px]" title={label + ': ' + data}>
      <span className="w-10 text-right text-gray-400">{fmtNum(data)}</span>
      <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-blue-400 rounded-full transition-all" style={{ width: pct + '%', minWidth: data > 0 ? '2px' : '0' }} />
      </div>
    </div>
  );
}

export default function StatisticsPage() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedDate, setSelectedDate] = useState<number | null>(null);

  useEffect(() => {
    api.get<Stats>('/statistics')
      .then((r) => setStats(r))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">数据统计</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl bg-gray-200" />
          ))}
        </div>
      </div>
    );
  }

  if (!stats) return <p className="text-gray-400 text-sm">暂无数据</p>;

  const trendMax = Math.max(...stats.dailyTrend.map(d => d.authors), 1);

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-gray-900">数据统计</h2>

      {/* Overview cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-gray-100">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <Users className="size-4" /> DAU
            </div>
            <div className="text-2xl font-bold text-gray-900">{fmtNum(stats.overview.dau)}</div>
            <div className="text-xs text-gray-400 mt-1">
              粘性比 {stats.overview.stickyRatio}%{stats.overview.stickyRatio >= 50 ? ' · 高' : ''}
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-100">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <Activity className="size-4" /> WAU
            </div>
            <div className="text-2xl font-bold text-gray-900">{fmtNum(stats.overview.wau)}</div>
          </CardContent>
        </Card>
        <Card className="border-gray-100">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <Calendar className="size-4" /> MAU
            </div>
            <div className="text-2xl font-bold text-gray-900">{fmtNum(stats.overview.mau)}</div>
          </CardContent>
        </Card>
        <Card className="border-gray-100">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <TrendingUp className="size-4" /> 今日新帖
            </div>
            <div className="text-2xl font-bold text-gray-900">{stats.content.feedsToday}</div>
            <div className="text-xs text-gray-400 mt-1">
              评论 {stats.content.commentsToday}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Member & Content summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-gray-100">
          <CardContent className="p-4">
            <div className="text-sm text-gray-500">总成员</div>
            <div className="text-xl font-semibold text-gray-900">
              {fmtNum(stats.members.total)}
              <span className="text-sm font-normal text-gray-400 ml-1">
                ({stats.members.active} 活跃 · {stats.members.left} 已离开)
              </span>
            </div>
            <div className="text-xs text-gray-400 mt-1">
              本月新增 {stats.members.newThisMonth}
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-100">
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-sm text-gray-500 mb-1">
              <FileText className="size-4" /> 总发帖
            </div>
            <div className="text-xl font-semibold text-gray-900">{fmtNum(stats.content.totalFeeds)}</div>
          </CardContent>
        </Card>
        <Card className="border-gray-100">
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-sm text-gray-500 mb-1">
              <MessageCircle className="size-4" /> 总评论
            </div>
            <div className="text-xl font-semibold text-gray-900">{fmtNum(stats.content.totalComments)}</div>
          </CardContent>
        </Card>
        <Card className="border-gray-100">
          <CardContent className="p-4">
            <div className="text-sm text-gray-500 mb-1">人均发帖</div>
            <div className="text-xl font-semibold text-gray-900">
              {(stats.content.totalFeeds / Math.max(stats.members.active, 1)).toFixed(1)}
            </div>
            <div className="text-xs text-gray-400 mt-1">
              周活人均 {(stats.content.feedsThisWeek / Math.max(stats.overview.wau, 1)).toFixed(1)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Daily trend */}
      <Card className="border-gray-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">近30天 DAU 趋势（每柱 = 当日活跃人数）</CardTitle>
        </CardHeader>
        <CardContent className="min-h-[320px]">
          <div className="overflow-x-auto pb-2">
            <div className="flex items-end gap-px h-56 w-full min-w-[620px]">
              {stats.dailyTrend.map((d, i) => {
                const h = trendMax > 0 ? Math.round((d.authors / trendMax) * 100) : 0;
                return (
                  <div
                    key={i}
                    className="flex-1 h-full flex flex-col items-center justify-end group relative"
                    onMouseEnter={() => setSelectedDate(i)}
                    onMouseLeave={() => setSelectedDate(null)}
                  >
                    <div
                      className="w-full rounded-t bg-blue-400 hover:bg-blue-500 transition-colors"
                      style={{ height: Math.max(h, d.authors > 0 ? 2 : 0) + '%' }}
                    />
                    {selectedDate === i && (
                      <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-[10px] px-1.5 py-1 rounded whitespace-nowrap z-10 leading-relaxed text-center shadow-lg">
                        <div>{d.date.slice(5)}</div>
                        <div className="text-blue-300">DAU {d.authors}</div>
                        <div>帖{fmtNum(d.feeds)} 评{fmtNum(d.comments)}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex justify-between mt-2 text-[10px] text-gray-400">
            <span>{stats.dailyTrend[0]?.date?.slice(5)}</span>
            <span>{stats.dailyTrend[stats.dailyTrend.length - 1]?.date?.slice(5)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Hourly activity + Top authors */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card className="border-gray-100">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">时段活跃分布（近7天）</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {stats.hourlyActivity.map((h) => {
                const total = h.feeds + h.comments;
                const maxH = Math.max(...stats.hourlyActivity.map(x => x.feeds + x.comments), 1);
                const pct = Math.round((total / maxH) * 100);
                return (
                  <div key={h.hour} className="flex items-center gap-2 text-xs">
                    <span className="w-12 text-right text-gray-400">
                      {String(h.hour).padStart(2, '0')}:00
                    </span>
                    <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-300 to-blue-500"
                        style={{ width: pct + '%', minWidth: total > 0 ? '3px' : '0' }}
                      />
                    </div>
                    <span className="w-10 text-gray-500 text-right">{total}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-100">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top 发帖（近30天）</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats.topAuthors.map((a, i) => (
                <div key={a.tinyid} className="flex items-center gap-2 text-sm">
                  <span className="w-5 text-center text-xs font-mono text-gray-400">{i + 1}</span>
                  <span className="flex-1 text-gray-700 truncate">{a.nickname}</span>
                  <span className="text-xs text-gray-500 font-mono">{a.postCount}帖</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
